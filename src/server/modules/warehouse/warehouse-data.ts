/**
 * 仓管数据访问层（P1-3 / P1-2 / P2-3）
 *
 * 原 warehouse-routes.ts 把「读盘 + ETag + 标记合并 + 排除清单」全塞在一个文件。
 * 这里拆出纯数据访问：路径统一走 config.dataRoot，加 mtime 触发的内存缓存（P2-3）。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { loadConfig } from "../../platform/config.js";

interface MarkEntry {
  sku: string;
  mark: string;
}

interface MarksData {
  快需补货: MarkEntry[];
  超卖: MarkEntry[];
}

/** 合并后的仓库数据结构（仅声明使用到的字段，避免过度 any） */
export interface WarehouseData {
  _dev_fixture?: boolean;
  data_date?: string;
  generated_at?: string;
  modules?: {
    shipment?: { summary?: Record<string, unknown>; by_style?: unknown[] };
    returns?: { summary?: Record<string, unknown>; reason_distribution?: unknown[]; by_style?: unknown[] };
    inventory?: { summary?: Record<string, unknown>; alerts?: Record<string, unknown[]> };
    brief?: { kpi?: Record<string, unknown> };
    platforms?: unknown;
    regions?: unknown;
  };
  [key: string]: unknown;
}

interface CacheEntry {
  path: string;
  mtimeMs: number;
  data: WarehouseData;
  etag: string;
}

let cache: CacheEntry | null = null;

function getDataPath(): string {
  // 支持测试/隔离环境通过 env 注入自定义数据路径（P0-3 worker 巡检兼容）
  if (process.env.COCKPIT_WAREHOUSE_DATA_PATH) {
    return path.resolve(process.env.COCKPIT_WAREHOUSE_DATA_PATH);
  }
  const cfg = loadConfig();
  return path.join(cfg.dataRoot, "warehouse", "data.json");
}

function getFixturePath(): string {
  return path.join(loadConfig().projectRoot, "public", "warehouse-data.fixture.json");
}

function getMarksPath(): string {
  return path.join(loadConfig().dataRoot, "warehouse", "manual-marks.json");
}

function readMarks(): MarksData {
  const p = getMarksPath();
  if (!fs.existsSync(p)) return { 快需补货: [], 超卖: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<MarksData>;
    return {
      快需补货: Array.isArray(parsed.快需补货) ? parsed.快需补货 : [],
      超卖: Array.isArray(parsed.超卖) ? parsed.超卖 : [],
    };
  } catch {
    return { 快需补货: [], 超卖: [] };
  }
}

export function applyMarks(items: Array<Record<string, unknown>>, marks: MarkEntry[]): void {
  if (marks.length === 0) return;
  const markMap = new Map(marks.map((m) => [m.sku, m.mark]));
  const unmarked: typeof items = [];
  const marked: typeof items = [];
  for (const item of items) {
    const sku = String(item["sku"] ?? "");
    const mark = markMap.get(sku);
    if (mark) {
      item["标记"] = mark;
      marked.push(item);
    } else {
      unmarked.push(item);
    }
  }
  items.length = 0;
  items.push(...unmarked, ...marked);
}

/**
 * 读取仓库数据。mtime 不变直接返回缓存（P2-3），变更则重新读盘 + 合并标记。
 * fixture 回退：userdata 无数据时读 public fixture 并打 _dev_fixture 标记。
 */
export function readWarehouseData(): WarehouseData | null {
  const primary = getDataPath();
  const fixture = getFixturePath();
  const actualPath = fs.existsSync(primary) ? primary : (fs.existsSync(fixture) ? fixture : null);
  if (!actualPath) return null;

  const stat = fs.statSync(actualPath);
  if (cache && cache.path === actualPath && cache.mtimeMs === stat.mtimeMs) {
    return cache.data;
  }

  const raw = fs.readFileSync(actualPath, "utf-8");
  const data = JSON.parse(raw) as WarehouseData;
  if (actualPath === fixture) {
    data._dev_fixture = true;
  }

  // 合并手动标记（快需补货 + 超卖未下单），有标记的排末尾
  const marks = readMarks();
  const alerts = data.modules?.inventory?.alerts as
    | { 快需补货?: Array<Record<string, unknown>>; 超卖?: Array<Record<string, unknown>> }
    | undefined;
  if (alerts) {
    if (Array.isArray(alerts.快需补货)) applyMarks(alerts.快需补货, marks.快需补货);
    if (Array.isArray(alerts.超卖)) applyMarks(alerts.超卖, marks.超卖);
  }

  cache = { path: actualPath, mtimeMs: stat.mtimeMs, data, etag: computeEtag(data) };
  recordHistorySnapshot(data);
  return data;
}

/**
 * 返回当前缓存（或刚读取）数据的 ETag。
 * ETag 在 readWarehouseData 写入缓存时一并计算并存储，mtime 命中缓存时直接复用，
 * 避免每次请求都对 4MB 对象 JSON.stringify + sha256（P1 性能优化）。
 * 若尚无缓存（首次调用前）会触发一次读取以建立缓存。
 */
export function getWarehouseDataEtag(): string | null {
  if (!cache) {
    readWarehouseData();
  }
  return cache ? cache.etag : null;
}

/** 计算合并标记后的最终内容 ETag（供路由层 304 判断） */
export function computeEtag(data: unknown): string {
  const finalRaw = JSON.stringify(data);
  return `"${crypto.createHash("sha256").update(finalRaw).digest("hex").slice(0, 16)}"`;
}

/**
 * 读取仓库数据「摘要」视图（首页速览专用，P1 性能优化）。
 * 仅截取 data_date / generated_at / 各 module 的 summary 字段，体积约 1-2KB，
 * 避免首页无条件拉取 4MB 全量 data.json。复用 readWarehouseData 的内存缓存，零额外 IO。
 */
export interface WarehouseSummary {
  data_date?: string;
  generated_at?: string;
  shipment?: { summary?: Record<string, unknown> };
  inventory?: { summary?: Record<string, unknown> };
  returns?: { summary?: Record<string, unknown> };
  _dev_fixture?: boolean;
}

export function readWarehouseSummary(): WarehouseSummary | null {
  const data = readWarehouseData();
  if (!data) return null;
  const mods = data.modules;
  if (!mods) return null;
  const result: Record<string, unknown> = {};
  if (data.data_date !== undefined) result.data_date = data.data_date;
  if (data.generated_at !== undefined) result.generated_at = data.generated_at;
  if (mods.shipment) result.shipment = { summary: mods.shipment.summary };
  if (mods.inventory) result.inventory = { summary: mods.inventory.summary };
  if (mods.returns) result.returns = { summary: mods.returns.summary };
  if (data._dev_fixture) result._dev_fixture = true;
  return result as WarehouseSummary;
}

/* ═══ 环比历史快照（V0.9.10）：data.json 是单日快照，读盘时自动留存 summary 历史，跨日对比 ═══ */

const HISTORY_KEEP_DAYS = 90;

interface HistorySnapshot {
  _at?: string | null;
  shipment?: Record<string, unknown> | undefined;
  inventory?: Record<string, unknown> | undefined;
  returns?: Record<string, unknown> | undefined;
}

interface HistoryFile {
  snapshots: Record<string, HistorySnapshot>;
}

function getHistoryPath(): string {
  if (process.env.COCKPIT_WAREHOUSE_DATA_PATH) {
    return path.join(path.dirname(process.env.COCKPIT_WAREHOUSE_DATA_PATH), "history.json");
  }
  const cfg = loadConfig();
  return path.join(cfg.dataRoot, "warehouse", "history.json");
}

function readHistory(): HistoryFile {
  const p = getHistoryPath();
  if (!fs.existsSync(p)) return { snapshots: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as HistoryFile;
    if (
      parsed !== null
      && typeof parsed === "object"
      && parsed.snapshots !== null
      && typeof parsed.snapshots === "object"
    ) {
      return parsed;
    }
    return { snapshots: {} };
  } catch {
    return { snapshots: {} };
  }
}

/** 原子写 history.json（写唯一 tmp → rename，避免半截文件） */
function writeHistoryAtomic(history: HistoryFile): void {
  const p = getHistoryPath();
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(history), "utf-8");
  fs.renameSync(tmp, p);
}

/**
 * 数据日期变化（或当日数据刷新）时，把当前 summary 快照写入历史。
 * 只存 summary 数字字段，体积 ~1-2KB/天；保留最近 HISTORY_KEEP_DAYS 天。
 * 历史是增强能力：任何 IO 失败都静默降级，不拖垮主流程。
 */
export function recordHistorySnapshot(data: WarehouseData): void {
  try {
    const date = data.data_date;
    const mods = data.modules;
    if (!date || !mods) return;
    const generatedAt = data.generated_at ?? null;
    const history = readHistory();
    const existing = history.snapshots[date];
    if (existing !== undefined && existing._at === generatedAt) {
      return; // 同日且未刷新，跳过写入
    }
    history.snapshots[date] = {
      _at: generatedAt,
      shipment: mods.shipment?.summary,
      inventory: mods.inventory?.summary,
      returns: mods.returns?.summary,
    };
    const keys = Object.keys(history.snapshots).sort();
    if (keys.length > HISTORY_KEEP_DAYS) {
      for (const k of keys.slice(0, keys.length - HISTORY_KEEP_DAYS)) {
        delete history.snapshots[k];
      }
    }
    writeHistoryAtomic(history);
  } catch {
    /* 历史不可写时静默降级 */
  }
}

export interface WarehouseDelta {
  delta: number;
  /** 相对变化百分比（上一值为 0 时为 null），保留 1 位小数 */
  pct: number | null;
}

/**
 * 对比当前摘要与上一数据日期的同名数字指标。
 * 返回 `"<module>:<字段>"` → { delta, pct }；历史不足两天或无数字对比时返回 null。
 */
export function computeDeltas(summary: WarehouseSummary): Record<string, WarehouseDelta> | null {
  const history = readHistory();
  const dates = Object.keys(history.snapshots).sort();
  if (dates.length < 2) return null;

  const lastDate = dates[dates.length - 1]!;
  const prevDate = dates[dates.length - 2]!;
  const curDate = summary.data_date ?? lastDate;
  const current = history.snapshots[curDate] ?? history.snapshots[lastDate]!;
  const prev = history.snapshots[prevDate]!;

  const out: Record<string, WarehouseDelta> = {};
  for (const mod of ["shipment", "inventory", "returns"] as const) {
    const cur = current[mod] ?? {};
    const pv = prev[mod] ?? {};
    for (const [key, val] of Object.entries(cur)) {
      if (typeof val !== "number") continue;
      const prevVal = pv[key];
      if (typeof prevVal !== "number") continue;
      const delta = val - prevVal;
      const pct = prevVal === 0 ? null : Math.round((delta / prevVal) * 1000) / 10;
      out[`${mod}:${key}`] = { delta, pct };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}
