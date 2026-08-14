import type { FastifyInstance } from "fastify";

import { excludeStore } from "./exclude-store.js";
import { readWarehouseData, readWarehouseSummary, getWarehouseDataEtag, computeEtag, computeDeltas } from "./warehouse-data.js";
import { readErpExceptions, getErpExceptionsEtag } from "./warehouse-exceptions.js";

/**
 * 仓管数据路由（仅装配，不含业务逻辑）
 * 数据读取/ETag/标记合并 → warehouse-data.ts；排除清单 → exclude-store.ts（单例）
 */
export function registerWarehouseRoutes(app: FastifyInstance): void {
  // 获取仓管数据「摘要」视图（首页速览专用，体积 ~1-2KB，支持 ETag 304）
  app.get("/api/warehouse/summary", async (request, reply) => {
    const summary = readWarehouseSummary();
    if (!summary) {
      return reply.code(503).send({
        error: { code: "DATA_NOT_FOUND", message: "仓管数据尚未生成，请先运行聚合脚本" },
      });
    }

    // 环比：对比上一数据日期的同名数字指标（历史不足两天时为 null）
    const deltas = computeDeltas(summary);
    if (deltas !== null) {
      (summary as Record<string, unknown>).deltas = deltas;
    }

    const finalEtag = computeEtag(summary);
    const clientEtag = request.headers["if-none-match"] as string | undefined;
    if (clientEtag === finalEtag) {
      return reply.code(304).send();
    }

    return reply
      .header("etag", finalEtag)
      .header("cache-control", "no-cache")
      .send(summary);
  });

  // 获取仓管数据（全量 JSON，支持 ETag 304 缓存）
  app.get("/api/warehouse/data", async (request, reply) => {
    const data = readWarehouseData();
    if (!data) {
      return reply.code(503).send({
        error: { code: "DATA_NOT_FOUND", message: "仓管数据尚未生成，请先运行聚合脚本" },
      });
    }

    // ETag 来自缓存（mtime 命中时直接复用，避免每次对 4MB 对象重算）
    const finalEtag = getWarehouseDataEtag();
    if (!finalEtag) {
      return reply.code(500).send({ error: { code: "ETAG_FAILED", message: "ETag 计算失败" } });
    }
    const clientEtag = request.headers["if-none-match"] as string | undefined;
    if (clientEtag === finalEtag) {
      return reply.code(304).send();
    }

    return reply
      .header("etag", finalEtag)
      .header("cache-control", "no-cache")
      .send(data);
  });

  // 获取排除清单
  app.get("/api/warehouse/exclude", async (request, reply) => {
    const { data, error } = excludeStore.read();
    if (error) {
      return reply.code(500).send({ error: { code: "EXCLUDE_CORRUPT", message: error } });
    }
    return data;
  });

  // 获取 ERP 异常订单（发货失败 + 打单超2次），独立 JSON，不污染 data.json 管线
  app.get("/api/warehouse/exceptions", async (request, reply) => {
    const data = readErpExceptions();
    if (!data) {
      return reply.code(503).send({
        error: { code: "DATA_NOT_FOUND", message: "ERP异常数据尚未生成，请先运行 fetch_erp_exceptions.py" },
      });
    }
    const etag = getErpExceptionsEtag();
    const clientEtag = request.headers["if-none-match"] as string | undefined;
    if (clientEtag && etag && clientEtag === etag) {
      return reply.code(304).send();
    }
    if (etag) reply.header("etag", etag);
    reply.header("cache-control", "no-cache");
    return data;
  });

  // 添加 SKU 到清仓不补
  app.post<{ Body: { sku: string } }>("/api/warehouse/exclude/add", async (request, reply) => {
    const { sku } = request.body;
    const result = excludeStore.add(sku);
    if (result.code === "OK") return reply.code(201).send({ ok: true, sku: sku.trim() });
    const status = result.code === "SKU_EXISTS" ? 409 : result.code === "INVALID_SKU" ? 400 : 500;
    return reply.code(status).send({ error: { code: result.code, message: result.message } });
  });

  // 从清仓不补移除 SKU
  app.post<{ Body: { sku: string } }>("/api/warehouse/exclude/remove", async (request, reply) => {
    const { sku } = request.body;
    const result = excludeStore.remove(sku);
    if (result.code === "OK") return reply.code(200).send({ ok: true, sku: sku.trim() });
    const status = result.code === "SKU_NOT_FOUND" ? 404 : result.code === "INVALID_SKU" ? 400 : 500;
    return reply.code(status).send({ error: { code: result.code, message: result.message } });
  });
}
