import path from "node:path";

import fastifyHelmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { registerNavigationRoutes } from "./modules/navigation/navigation-routes.js";
import { NavigationRepository } from "./modules/navigation/navigation-repository.js";
import { registerResourceRoutes } from "./modules/resources/resource-routes.js";
import { ResourceRepository } from "./modules/resources/resource-repository.js";
import { ResourceService } from "./modules/resources/resource-service.js";
import { registerTaskRoutes } from "./modules/tasks/task-routes.js";
import { TaskRepository } from "./modules/tasks/task-repository.js";
import { TaskService } from "./modules/tasks/task-service.js";
import {
  openDatabase,
  type CockpitDatabase,
} from "./platform/database.js";
import type { AppConfig } from "./platform/config.js";
import { ResourceStorage } from "./platform/resource-storage.js";
import { registerWarehouseRoutes } from "./modules/warehouse/warehouse-routes.js";
import { registerVaultRoutes } from "./modules/vault/vault-routes.js";
import { VaultRepository } from "./modules/vault/vault-repository.js";
import { VaultService } from "./modules/vault/vault-service.js";
import { registerLocalRequestGuard } from "./security/local-request.js";
import { logger } from "./platform/logger.js";
import { migrationsDir, webDistDir } from "./platform/project-root.js";

/** Fastify 装饰器类型：业务数据库实例（MCP 工具面共用） */
declare module "fastify" {
  interface FastifyInstance {
    cockpitDatabase: CockpitDatabase;
  }
}

interface BuildAppOptions {
  config: AppConfig;
  database?: CockpitDatabase;
  /** 是否服务前端静态资源（web/dist）；DSH 插件形态默认 true */
  serveStaticWeb?: boolean;
}

export interface BuiltCockpitApp {
  app: FastifyInstance;
  /** 业务数据库实例（MCP 工具面共用，避免双连接锁） */
  database: CockpitDatabase;
  /** 是否由本应用持有并负责关闭 */
  ownsDatabase: boolean;
}

/**
 * 组装业务应用（DSH 插件版）：
 * 与 Personal Cockpit 独立版一致，但去掉 agent 模块（Pi/WS/审批/记忆/技能/角色），
 * 仅保留业务域：导航 / 日程 / 资料 / 仓管 / 知识库 + 静态前端。
 *
 * 返回 FastifyInstance（测试用 app.inject/app.close），数据库实例经
 * app.cockpitDatabase 暴露，供 MCP 工具面共用。
 */
export async function buildApp({
  config,
  database: providedDatabase,
  serveStaticWeb = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
  });

  const database =
    providedDatabase ??
    openDatabase(config.databasePath, migrationsDir(config.projectRoot));
  const ownsDatabase = providedDatabase === undefined;

  registerLocalRequestGuard(app, {
    allowedHostnames: [config.host],
    port: config.port,
    // MCP 端点：调用方为 DSH MCP client（本机进程），豁免写请求标识但保留本机来源校验
    exemptPaths: ["/mcp"],
  });

  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        // 插件形态：允许被 DSH Web GUI 的 iframe 嵌入（原独立版 frameAncestors: none）
        frameAncestors: ["'self'", "http://127.0.0.1:*", "http://localhost:*"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  app.get("/api/health", async () => ({
    service: "dsh-plugin-cockpit",
    status: "ok",
    storage: "local",
    schema: "ready",
  }));

  app.setErrorHandler((error, request, reply) => {
    const err = error instanceof Error ? error : new Error(String(error));
    const statusCode = (err as { statusCode?: number }).statusCode;
    const status = typeof statusCode === "number" && statusCode >= 400 && statusCode < 600
      ? statusCode
      : 500;
    const code = (err as { code?: string }).code ?? `HTTP_${status}`;
    logger.error(
      { err, url: request.url, method: request.method },
      "未捕获请求异常",
    );
    if (status === 500) {
      return reply.code(500).send({
        error: { code: "INTERNAL_ERROR", message: "服务器内部错误，请查看日志" },
      });
    }
    return reply.code(status).send({
      error: { code, message: err.message ?? "请求处理失败" },
    });
  });

  registerNavigationRoutes(app, new NavigationRepository(database), undefined, {
    allowLocalTargets: config.accessMode === "loopback",
  });
  registerTaskRoutes(
    app,
    new TaskService(new TaskRepository(database)),
  );
  registerResourceRoutes(
    app,
    new ResourceService(
      new ResourceRepository(database),
      new ResourceStorage(config.dataRoot),
    ),
  );
  registerWarehouseRoutes(app);

  const vaultRepository = new VaultRepository(database);
  const vaultService = new VaultService(config.vaultDir, vaultRepository);
  vaultService.ensureDirectory();
  vaultService.scan();
  vaultService.startWatching();
  registerVaultRoutes(app, vaultService, vaultRepository, config.accessMode);

  // 注意：agent 模块（Pi/WS/审批/记忆/技能/MCP 客户端）已按融合方案整体移除。

  if (serveStaticWeb) {
    const webDist = webDistDir(config.projectRoot);
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: "/",
      cacheControl: false,
      setHeaders: (reply) => {
        reply.raw.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        reply.raw.setHeader("Pragma", "no-cache");
        reply.raw.setHeader("Expires", "0");
      },
    });
  }

  app.setNotFoundHandler(async (request, reply) => {
    if (
      serveStaticWeb &&
      request.method === "GET" &&
      !request.url.startsWith("/api/")
    ) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "没有找到这个地址。",
      },
    });
  });

  // 无论数据库是否由本应用持有，都必须停掉 vault 文件监听
  app.addHook("onClose", async () => {
    vaultService.stopWatching();
  });

  if (ownsDatabase) {
    app.addHook("onClose", async () => {
      database.close();
    });
  }

  app.decorate("cockpitDatabase", database);
  return app;
}
