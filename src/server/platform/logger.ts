/**
 * 集中日志（P0-3）
 * pino 单例，分级写入 userdata/logs/app-YYYY-MM-DD.log。
 * 开发期同时输出到 stdout（便于实时排障），生产期仅落盘。
 */
import fs from "node:fs";
import path from "node:path";

import pino from "pino";
import { findProjectRoot } from "./project-root.js";

function todayFile(): string {
  const dir = path.join(findProjectRoot(), "userdata", "logs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  return path.join(dir, `app-${date}.log`);
}

const isProd = process.env.NODE_ENV === "production";

// 开发期只输出到 stdout，避免 userdata/logs 在受限环境下被拦导致进程崩溃
// 生产期：落盘 + 仅错误以上到 stdout
const targets = isProd
  ? [
      { target: "pino/file", options: { destination: todayFile() }, level: "info" },
      { target: "pino/file", options: { destination: 1, mkdir: false }, level: "error" },
    ]
  : [{ target: "pino/file", options: { destination: 1, mkdir: false }, level: "debug" }];

export const logger = pino(
  {
    level: isProd ? "info" : "debug",
    transport: { targets },
  },
);

export default logger;
