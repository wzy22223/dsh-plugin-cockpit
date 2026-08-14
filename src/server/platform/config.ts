import path from "node:path";

import { migrationsDir, pluginRoot } from "./project-root.js";

export interface AppConfig {
  host: string;
  port: number;
  /** 插件根目录（migrations / web 产物所在地） */
  projectRoot: string;
  /** 业务数据根目录（SQLite + 仓库 JSON 等），可配置指向已有 userdata */
  dataRoot: string;
  databasePath: string;
  scriptsDir: string;
  vaultDir: string;
  isProduction: boolean;
  accessMode: "loopback";
}

/** 插件运行配置（由 DSH 插件 config 传入，也可用 COCKPIT_* 环境变量覆盖） */
export interface CockpitRuntimeConfig {
  /** 监听地址，默认 127.0.0.1（插件形态不提供 pgy） */
  host?: string;
  /** 监听端口，默认 7799（避开 DSH 3080 与 Cockpit 原 7777/7778） */
  port?: number;
  /** 数据根目录：默认 <插件根>/userdata，可指向任意已有 userdata 目录 */
  dataDir?: string;
  /** 知识库（Obsidian vault）目录：默认 <dataDir>/vault */
  vaultDir?: string;
  /** B1 脚本目录：默认 <插件根>/scripts（外部脚本可指向任意本机目录） */
  scriptsDir?: string;
  /** 是否服务前端静态资源（web/dist），默认 true */
  serveStaticWeb?: boolean;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`端口必须是 1024 到 65535 之间的整数，收到：${value}`);
  }
  return port;
}

/**
 * 当前生效配置（由插件入口在启动时 setActiveConfig）。
 * 业务模块（warehouse/exclude-store/capabilities 等）沿用 loadConfig() 调用方式，
 * 在未设置时回退为默认配置（数据目录 = 插件根 userdata）。
 */
let activeConfig: AppConfig | null = null;

export function setActiveConfig(config: AppConfig): void {
  activeConfig = config;
}

/** 兼容原独立版的 loadConfig()：返回插件当前生效配置 */
export function loadConfig(): AppConfig {
  return activeConfig ?? resolveConfig();
}

/** 从插件配置构造 AppConfig（env COCKPIT_* 优先，兼容原工作台运维习惯） */
export function resolveConfig(runtime: CockpitRuntimeConfig = {}): AppConfig {
  const projectRoot = pluginRoot();
  const isProduction = process.env.NODE_ENV === "production";

  // 数据目录优先级：env COCKPIT_DATA_DIR > 插件 config.dataDir > 插件根 userdata
  const dataRoot = process.env.COCKPIT_DATA_DIR
    ? path.resolve(process.env.COCKPIT_DATA_DIR)
    : runtime.dataDir
      ? path.resolve(runtime.dataDir)
      : path.join(projectRoot, "userdata");

  const port = parsePort(
    process.env.COCKPIT_PORT ?? process.env.COCKPIT_DEV_API_PORT,
    runtime.port ?? 7799,
  );

  const scriptsDir = process.env.COCKPIT_SCRIPTS_DIR
    ? path.resolve(process.env.COCKPIT_SCRIPTS_DIR)
    : runtime.scriptsDir
      ? path.resolve(runtime.scriptsDir)
      : path.join(projectRoot, "scripts");

  const vaultDir = process.env.COCKPIT_VAULT_DIR
    ? path.resolve(process.env.COCKPIT_VAULT_DIR)
    : runtime.vaultDir
      ? path.resolve(runtime.vaultDir)
      : path.join(dataRoot, "vault");

  return {
    host: runtime.host ?? "127.0.0.1",
    port,
    projectRoot,
    dataRoot,
    databasePath: path.join(dataRoot, "cockpit.sqlite"),
    scriptsDir,
    vaultDir,
    isProduction,
    accessMode: "loopback",
  };
}
