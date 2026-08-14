/**
 * DSH 加载器语义冒烟测试（非单元测试，独立脚本）
 *
 * 模拟 DSH 的 cordis loader 行为：按包名 "dsh-plugin-cockpit" 创建 loader entry，
 * 验证模块解析（node self-reference）、插件启动（Fastify + MCP）、卸载清理。
 *
 * 用法：npx tsx src/smoke.ts
 */
import { Context } from "@deepseek-ai/cordis";
import { Loader } from "@deepseek-ai/cordis-plugin-loader";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const root = new Context();
  // 与 DSH 相同：loader 的 baseUrl 指向 profile 目录（此处 = 插件 src 目录）
  await root.plugin(Loader, { baseUrl: here });

  const entryId = await root.loader.create({
    name: "dsh-plugin-cockpit", // 包名解析（node 自 node_modules 向上查找，同 DSH 的 profiles/node_modules 布局）
    config: {
      port: 7799,
      dataDir: path.join(here, "..", ".devdata"),
      mcpEnabled: true,
    },
  });
  await root.loader.await();

  // 等 apply 的异步启动完成
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const health = await fetch("http://127.0.0.1:7799/api/health");
  const body = await health.json() as { service: string; status: string };
  console.log(`[smoke] health: ${JSON.stringify(body)}`);
  if (body.service !== "dsh-plugin-cockpit" || body.status !== "ok") {
    throw new Error("health 校验失败");
  }

  const mcp = await fetch("http://127.0.0.1:7799/mcp", {
    method: "POST",
    headers: {
      "Accept": "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "tools/list", params: {},
    }),
  });
  const mcpText = await mcp.text();
  console.log(`[smoke] mcp tools/list status=${mcp.status}`);
  if (!mcpText.includes('"tools"')) {
    throw new Error("MCP tools/list 未返回工具列表");
  }

  // 卸载：disposer 应关闭 Fastify，端口释放
  console.log("[smoke] removing entry…");
  await root.loader.remove(entryId);
  console.log("[smoke] remove() resolved");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const after = await fetch("http://127.0.0.1:7799/api/health").catch(() => null);
  if (after !== null) {
    throw new Error("卸载后服务仍在响应");
  }
  console.log("[smoke] unload OK: Fastify 已关闭");

  console.log("[smoke] PASS — DSH loader 语义加载/卸载完整通过");
  process.exit(0);
}

main().catch((error) => {
  console.error("[smoke] FAIL:", error);
  process.exit(1);
});
