/**
 * 本地开发启动脚本（不经 DSH，直接加载插件 apply 验证业务面）
 * 用法：npm run dev 或 tsx src/dev.ts
 */
import { Context } from "@deepseek-ai/cordis";
import { apply } from "./index.js";

const root = new Context();

apply(root, {
  port: 7799,
  dataDir: process.env.COCKPIT_DATA_DIR ?? undefined,
  mcpEnabled: true,
});

const shutdown = async (): Promise<void> => {
  console.log("[dev] 关闭中…");
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

// 保持进程存活
setInterval(() => {}, 1 << 30);
