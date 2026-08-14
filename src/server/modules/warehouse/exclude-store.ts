/**
 * 排除清单单例存储（P0-2）
 *
 * 统一 Agent / MCP / warehouse-routes 三处重复的 readExclude/writeExclude/
 * logExcludeAudit 逻辑。所有读写经此单例，路径统一走 config.dataRoot，
 * 并支持从旧路径 warehouse/exclude.json 自动迁移到 userdata/warehouse/exclude.json（P2-2）。
 *
 * 行为约定（对齐 warehouse-routes 加固版）：
 * - 结构非法（清仓不补非数组）或解析失败 → 返回 error，阻止写操作，不静默返回空
 * - 原子写：tmp + rename
 * - 审计日志追加写，失败不影响主流程
 */
import fs from "node:fs";
import path from "node:path";

import { findProjectRoot } from "../../platform/project-root.js";
import { loadConfig } from "../../platform/config.js";

export interface ExcludeSku {
  sku: string;
  reason?: string;
  added?: string;
}

export interface ExcludeData {
  清仓不补: ExcludeSku[];
}

export interface ReadExcludeResult {
  data: ExcludeData;
  error: string | null;
}

/** 新路径（userdata/warehouse/exclude.json），与审计日志同目录 */
function getNewPath(): string {
  const cfg = loadConfig();
  return path.join(cfg.dataRoot, "warehouse", "exclude.json");
}

/** 旧路径（warehouse/exclude.json，项目根下随源码），仅用于迁移兜底 */
function getLegacyPath(): string {
  return path.join(findProjectRoot(), "warehouse", "exclude.json");
}

function getAuditPath(): string {
  const cfg = loadConfig();
  return path.join(cfg.dataRoot, "warehouse", "exclude-audit.log");
}

function ensureDir(p: string): void {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function logAudit(action: string, detail: string): void {
  try {
    const ap = getAuditPath();
    ensureDir(ap);
    const ts = new Date().toISOString();
    const line = `${ts} | ${action} | ${detail}\n`;
    fs.appendFileSync(ap, line, "utf-8");
  } catch {
    // 审计日志写入失败不应影响主流程
  }
}

/**
 * 自动迁移：若新路径不存在且旧路径存在，把旧文件搬过来。
 * 返回有效数据路径（新路径优先，其次旧路径，再无）。
 */
function resolveSourcePath(): string {
  const newPath = getNewPath();
  const legacyPath = getLegacyPath();
  if (!fs.existsSync(newPath) && fs.existsSync(legacyPath)) {
    try {
      ensureDir(newPath);
      const tmp = `${newPath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, fs.readFileSync(legacyPath, "utf-8"), "utf-8");
      fs.renameSync(tmp, newPath);
      logAudit("MIGRATE", `从 ${legacyPath} 迁移到 ${newPath}`);
    } catch (err) {
      logAudit("MIGRATE_FAIL", err instanceof Error ? err.message : String(err));
    }
  }
  if (fs.existsSync(newPath)) return newPath;
  if (fs.existsSync(legacyPath)) return legacyPath;
  return newPath;
}

function parse(raw: string): ReadExcludeResult {
  try {
    const parsed = JSON.parse(raw) as ExcludeData;
    if (!Array.isArray(parsed.清仓不补)) {
      const msg = "排除清单结构异常（清仓不补 不是数组）";
      logAudit("STRUCT_ERROR", msg);
      console.error(`[exclude-store] ${msg}`);
      return { data: { 清仓不补: [] }, error: msg };
    }
    return { data: parsed, error: null };
  } catch (err) {
    const msg = `排除清单读取/解析失败: ${err instanceof Error ? err.message : String(err)}`;
    logAudit("PARSE_ERROR", msg);
    console.error(`[exclude-store] ${msg}`);
    return { data: { 清仓不补: [] }, error: msg };
  }
}

class ExcludeStore {
  /** 读取（带结构校验 + 错误返回，不静默吞错） */
  read(): ReadExcludeResult {
    const p = resolveSourcePath();
    if (!fs.existsSync(p)) {
      return { data: { 清仓不补: [] }, error: null };
    }
    return parse(fs.readFileSync(p, "utf-8"));
  }

  /** 原子写（调用方需先确保 data 结构合法） */
  write(data: ExcludeData): void {
    const p = getNewPath();
    ensureDir(p);
    const tmp = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, p);
  }

  /** 追加审计 */
  audit(action: string, detail: string): void {
    logAudit(action, detail);
  }

  /**
   * 添加 SKU（去重）。返回操作结果，供路由/工具层转成文案或 HTTP 状态。
   */
  add(sku: string): { ok: boolean; code: string; message: string } {
    const trimmed = sku.trim();
    if (!trimmed) return { ok: false, code: "INVALID_SKU", message: "SKU 不能为空" };
    const { data, error } = this.read();
    if (error) {
      return { ok: false, code: "EXCLUDE_CORRUPT", message: `排除清单损坏，拒绝写入。错误: ${error}` };
    }
    if (data.清仓不补.some((item) => item.sku === trimmed)) {
      return { ok: false, code: "SKU_EXISTS", message: `SKU "${trimmed}" 已在清仓不补列表中` };
    }
    data.清仓不补.push({ sku: trimmed, added: new Date().toISOString().slice(0, 10) });
    this.write(data);
    this.audit("ADD", `sku=${trimmed}`);
    return { ok: true, code: "OK", message: `已添加 SKU "${trimmed}" 到清仓不补清单` };
  }

  /**
   * 移除 SKU。返回操作结果。
   */
  remove(sku: string): { ok: boolean; code: string; message: string } {
    const trimmed = sku.trim();
    if (!trimmed) return { ok: false, code: "INVALID_SKU", message: "SKU 不能为空" };
    const { data, error } = this.read();
    if (error) {
      return { ok: false, code: "EXCLUDE_CORRUPT", message: `排除清单损坏，拒绝写入。错误: ${error}` };
    }
    const before = data.清仓不补.length;
    data.清仓不补 = data.清仓不补.filter((item) => item.sku !== trimmed);
    if (data.清仓不补.length === before) {
      return { ok: false, code: "SKU_NOT_FOUND", message: `SKU "${trimmed}" 不在清仓不补列表中` };
    }
    this.write(data);
    this.audit("REMOVE", `sku=${trimmed}`);
    return { ok: true, code: "OK", message: `已从清仓不补清单移除 SKU "${trimmed}"` };
  }
}

/** 全局单例 */
export const excludeStore = new ExcludeStore();
