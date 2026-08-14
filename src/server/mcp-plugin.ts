/**
 * MCP Server 面（DSH 插件版）
 *
 * 把工作台的业务工具（navigation / tasks / resources / warehouse / vault / scripts）
 * 暴露为 MCP Tools，供 DSH 的 MCP client（dsh-mcp-client）连接调用。
 *
 * ═══ 与独立版差异 ═══
 * - 传输：Streamable HTTP（挂插件进程内 Fastify 的 /mcp），不再是独立 stdio 进程；
 * - 鉴权：原 agent 四段鉴权（tool-guard）随 agent 模块移除。写操作的安全由 DSH 侧
 *   MCP 客户端权限配置承担（用户显式配置连接 = 授权）；插件内保留路径白名单等执行层防护。
 * - 裁剪：资源列表笔记正文截断（防云模型外发）保留，与原 stdio 版一致。
 */
import type { FastifyInstance } from "fastify";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { toolRegistry } from "./tools/registry.js";
import { createToolExecutor } from "./tools/executor.js";
import type { AppConfig } from "./platform/config.js";
import type { CockpitDatabase } from "./platform/database.js";

/** 裁剪资源列表中的笔记正文，防止完整内容泄露给 MCP 客户端 */
function trimResourceList(items: unknown[]): unknown[] {
  return items.map((item) => {
    if (
      typeof item === "object" && item !== null &&
      (item as Record<string, unknown>).kind === "note"
    ) {
      const note = item as Record<string, unknown>;
      const content = note.content;
      if (typeof content === "string" && content.length > 200) {
        return { ...note, content: content.slice(0, 200) + "…", _content_trimmed: true };
      }
    }
    return item;
  });
}

/** 在插件进程内 Fastify 上挂 MCP 端点（GET/POST /mcp，stateless streamable HTTP） */
export function registerMcpServer(
  app: FastifyInstance,
  deps: { database: CockpitDatabase; config: AppConfig },
): void {
  const executor = createToolExecutor({
    database: deps.database,
    config: deps.config,
    actor: "mcp",
  });
  const tools = toolRegistry.getAll();

  const server = new Server(
    { name: "personal-cockpit-plugin", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    try {
      let result = await executor(
        request.params.name,
        (request.params.arguments ?? {}) as Record<string, unknown>,
      );
      // MCP 边界：资源列表裁剪笔记正文，防云模型外发（执行器本身不裁剪）
      if (request.params.name === "cockpit_resource_list") {
        try {
          const parsed = JSON.parse(result) as unknown[];
          result = JSON.stringify(trimResourceList(parsed), null, 2);
        } catch {
          // 保留原结果
        }
      }
      return { content: [{ type: "text" as const, text: result }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: `错误：${message}` }],
        isError: true,
      };
    }
  });

  // stateless 模式：每个请求独立 transport，一次请求一次响应（无 SSE 长连接）
  // SDK 的 parsedBody 参数接受已解析的 JS 对象（Fastify 已消费 raw 流并解析 JSON）
  const handleRequest = async (
    request: import("fastify").FastifyRequest,
    reply: import("fastify").FastifyReply,
  ): Promise<void> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } finally {
      await server.close();
    }
  };

  app.get("/mcp", handleRequest);
  app.post("/mcp", handleRequest);
}
