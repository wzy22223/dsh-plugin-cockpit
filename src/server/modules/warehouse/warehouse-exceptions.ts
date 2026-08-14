/**
 * ERP 异常订单数据访问层（独立薄层）
 *
 * 数据由 scripts/fetch_erp_exceptions.py 定时写入 userdata/warehouse/erp-exceptions.json，
 * 与 data.json 聚合管线完全解耦。仅直读 JSON + mtime 内存缓存 + ETag。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { loadConfig } from "../../platform/config.js";

export interface ErpExceptions {
  data_date?: string;
  generated_at?: string;
  发货上传失败?: number;
  打单超2次?: number;
  [key: string]: unknown;
}

interface CacheEntry {
  path: string;
  mtimeMs: number;
  etag: string;
  data: ErpExceptions | null;
}

let cache: CacheEntry | null = null;

function getDataPath(): string {
  if (process.env.COCKPIT_ERP_EXCEPTIONS_PATH) {
    return path.resolve(process.env.COCKPIT_ERP_EXCEPTIONS_PATH);
  }
  const cfg = loadConfig();
  return path.join(cfg.dataRoot, "warehouse", "erp-exceptions.json");
}

export function readErpExceptions(): ErpExceptions | null {
  const p = getDataPath();
  if (!fs.existsSync(p)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(p);
  } catch {
    return null;
  }
  if (cache && cache.path === p && cache.mtimeMs === stat.mtimeMs) {
    return cache.data;
  }
  let data: ErpExceptions | null = null;
  try {
    data = JSON.parse(fs.readFileSync(p, "utf-8")) as ErpExceptions;
  } catch {
    data = null;
  }
  const etag = `"${crypto.createHash("sha256").update(JSON.stringify(data ?? {})).digest("hex").slice(0, 16)}"`;
  cache = { path: p, mtimeMs: stat.mtimeMs, etag, data };
  return data;
}

export function getErpExceptionsEtag(): string | null {
  if (!cache) readErpExceptions();
  return cache ? cache.etag : null;
}
