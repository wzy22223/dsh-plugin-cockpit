/**
 * dsh-plugin-cockpit — Personal Cockpit 工作台（DSH 插件版）
 *
 * 把个人工作台的业务层（导航 / 日程 / 资料 / 仓管 / 知识库 + SQLite + 前端视图）
 * 内嵌为 DSH 可加载的 Cordis 插件，并在进程内提供：
 *   - 业务 REST API（/api/*，loopback 仅本机）
 *   - 前端静态视图（web/dist，默认 /）
 *   - MCP 工具面（/mcp，供 DSH MCP client 连接调用业务工具）
 *
 * agent 模块（Pi/WS/审批/记忆/技能/角色）已按融合方案整体移除。
 *
 * 安装后在 DSH 的 cordis.patch.yml 增加一行：
 *   - id: cockpit
 *     name: dsh-plugin-cockpit
 *     config:
 *       dataDir: /path/to/your/userdata   # 可指向已有工作台数据，省略则用插件内 userdata/
 *       port: 7799
 */
import { buildApp, type BuiltCockpitApp } from "./server/cockpit-app.js";
import { registerMcpServer } from "./server/mcp-plugin.js";
import {
  resolveConfig,
  setActiveConfig,
  type CockpitRuntimeConfig,
} from "./server/platform/config.js";
import { logger } from "./server/platform/logger.js";
import type { CockpitDatabase } from "./server/platform/database.js";

export type { CockpitRuntimeConfig } from "./server/platform/config.js";

export interface CockpitPluginOptions extends CockpitRuntimeConfig {
  /** 是否挂 MCP 工具面（/mcp），默认 true */
  mcpEnabled?: boolean;
}

const DEFAULT_OPTIONS: Required<Pick<CockpitPluginOptions, "mcpEnabled" | "serveStaticWeb">> = {
  mcpEnabled: true,
  serveStaticWeb: true,
};

export function apply(
  ctx: import("@deepseek-ai/cordis").Context,
  rawOptions: CockpitPluginOptions = {},
): void {
  const options: CockpitPluginOptions & typeof DEFAULT_OPTIONS = {
    ...DEFAULT_OPTIONS,
    ...rawOptions,
  };

  let built: BuiltCockpitApp | null = null;

  // 注意：cordis-plugin-loader 的 entry 加载路径不收集 apply 返回值作为 disposer
  // （与直接 ctx.plugin() 不同），清理必须经 ctx.effect 注册 —— 与 DSH 官方插件一致。
  ctx.effect(() => {
    const start = async (): Promise<void> => {
      const config = resolveConfig(options);
      // 业务模块（warehouse/exclude-store/capabilities 等）经 loadConfig() 读取
      setActiveConfig(config);

      const app = await buildApp({
        config,
        serveStaticWeb: options.serveStaticWeb,
      });
      const database: CockpitDatabase = app.cockpitDatabase;
      built = { app, database, ownsDatabase: true };

      if (options.mcpEnabled) {
        registerMcpServer(app, { database, config });
      }

      await app.listen({ host: config.host, port: config.port });
      logger.info(
        { host: config.host, port: config.port, dataDir: config.dataRoot, mcp: options.mcpEnabled },
        "dsh-plugin-cockpit 工作台已启动",
      );
    };

    void start().catch((error) => {
      logger.error(error instanceof Error ? error : new Error(String(error)), "dsh-plugin-cockpit 启动失败");
    });

    // 插件卸载（含 loader entry 移除/更新）时关闭 Fastify
    return async () => {
      if (built) {
        try {
          await built.app.close();
          logger.info({}, "dsh-plugin-cockpit 工作台已关闭");
        } catch (error) {
          logger.error(error instanceof Error ? error : new Error(String(error)), "dsh-plugin-cockpit 关闭异常");
        }
        built = null;
      }
    };
  });
}

export const name = "dsh-plugin-cockpit";
