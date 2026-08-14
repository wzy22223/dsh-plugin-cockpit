import type { FastifyInstance } from "fastify";

import { VaultRepository } from "./vault-repository.js";
import { VaultService } from "./vault-service.js";

export function registerVaultRoutes(
  app: FastifyInstance,
  service: VaultService,
  repository: VaultRepository,
  accessMode: "loopback" | "pgy",
): void {
  app.get("/api/vault/stats", async () => {
    if (!service.isReady) {
      service.scan();
    }
    return { ...repository.stats(), readOnly: accessMode === "pgy" };
  });

  app.get("/api/vault/notes", async (request, reply) => {
    if (!service.isReady) {
      service.scan();
    }
    const params = request.query as { query?: string; limit?: string; offset?: string };
    const query = params.query ?? "";
    const limitRaw = Number(params.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 200)
      : 50;
    const offsetRaw = Number(params.offset);
    const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    if (query.trim() === "") {
      return { query: "", total: repository.count(), items: repository.list(limit, offset) };
    }
    const trimmed = query.trim();
    return {
      query: trimmed,
      total: repository.countSearch(trimmed),
      items: repository.search(trimmed, limit, offset),
    };
  });

  app.get("/api/vault/note", async (request, reply) => {
    if (!service.isReady) {
      service.scan();
    }
    const { path: notePath } = request.query as { path?: string };
    if (typeof notePath !== "string" || notePath === "") {
      return reply.code(400).send({
        error: { code: "VAULT_PATH_REQUIRED", message: "缺少笔记路径参数 path" },
      });
    }
    const note = repository.findNote(notePath);
    if (note === null) {
      return reply.code(404).send({
        error: { code: "VAULT_NOTE_NOT_FOUND", message: `笔记不存在：${notePath}` },
      });
    }
    const raw = service.readRaw(notePath);
    return { ...note, raw };
  });

  app.get("/api/vault/graph", async () => {
    if (!service.isReady) {
      service.scan();
    }
    return repository.graph();
  });

  app.post("/api/vault/refresh", async () => {
    const result = service.scan();
    return { ok: true, ...result };
  });

  app.put("/api/vault/note", async (request, reply) => {
    // pgy 模式只读：vault 笔记写回本地文件与 navigation file: 增删改同边界（红线 4）
    if (accessMode === "pgy") {
      return reply.code(403).send({
        error: { code: "VAULT_READONLY", message: "蒲公英模式下知识库为只读" },
      });
    }
    const { path: notePath, content: raw } = request.body as {
      path?: string;
      content?: string;
    };
    if (typeof notePath !== "string" || notePath === "") {
      return reply.code(400).send({
        error: { code: "VAULT_PATH_REQUIRED", message: "缺少笔记路径参数 path" },
      });
    }
    if (typeof raw !== "string") {
      return reply.code(400).send({
        error: { code: "VAULT_CONTENT_REQUIRED", message: "缺少笔记内容 content" },
      });
    }
    if (raw.length > 2_000_000) {
      return reply.code(413).send({
        error: { code: "VAULT_CONTENT_TOO_LARGE", message: "笔记内容过大（上限 2MB）" },
      });
    }
    try {
      return service.saveNote(notePath, raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存失败";
      if (
        message.includes("越界") ||
        message.includes("忽略") ||
        message.includes("仅支持")
      ) {
        return reply.code(400).send({ error: { code: "VAULT_SAVE_REJECTED", message } });
      }
      throw error;
    }
  });
}
