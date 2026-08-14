import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { logger } from "../../platform/logger.js";
import { VaultRepository } from "./vault-repository.js";
import { parseVaultNoteFile, scanVaultFiles } from "./vault-scanner.js";

export class VaultService {
  private watcher: FSWatcher | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private scanning = false;
  private pendingRefresh = false;
  private ready = false;
  private closed = false;

  public constructor(
    private readonly vaultDir: string,
    private readonly repository: VaultRepository,
  ) {}

  public get isReady(): boolean {
    return this.ready;
  }

  public get directory(): string {
    return this.vaultDir;
  }

  public ensureDirectory(): void {
    if (!existsSync(this.vaultDir)) {
      mkdirSync(this.vaultDir, { recursive: true });
    }
  }

  public static isIgnoredPath(relPath: string): boolean {
    const segments = relPath.split("/");
    return segments.some(
      (segment) =>
        segment === ".obsidian" ||
        segment === ".llm-wiki" ||
        segment === ".trash" ||
        segment === ".git" ||
        segment.startsWith("."),
    );
  }

  /** 全量/增量扫描：mtime 未变且已索引的文件跳过；消失的文件从索引清除 */
  public scan(): { added: number; updated: number; removed: number } {
    if (this.closed) {
      return { added: 0, updated: 0, removed: 0 };
    }
    if (this.scanning) {
      this.pendingRefresh = true;
      return { added: 0, updated: 0, removed: 0 };
    }
    this.scanning = true;
    try {
      const notes = scanVaultFiles(this.vaultDir);
      const existing = new Set(notes.map((note) => note.relPath));

      let added = 0;
      let updated = 0;
      for (const note of notes) {
        const indexed = this.repository.isIndexedFresh(note.relPath, note.mtime, note.size);
        if (indexed) {
          continue;
        }
        if (indexed === null) {
          added += 1;
        } else {
          updated += 1;
        }
        this.repository.upsertNote(note);
      }

      const removed = this.repository.removeStaleAndCount(existing);
      if (added + updated + removed > 0) {
        this.repository.resolveLinks();
        this.repository.rebuildFts();
      }

      this.ready = true;
      if (added + updated + removed > 0) {
        logger.info(
          { vault: this.vaultDir, added, updated, removed },
          "知识库扫描完成",
        );
      }
      return { added, updated, removed };
    } finally {
      this.scanning = false;
      if (this.pendingRefresh) {
        this.pendingRefresh = false;
        queueMicrotask(() => {
          this.scan();
        });
      }
    }
  }

  /** 单文件增量刷新（编辑保存 / watch 事件后调用） */
  public refreshFile(relPath: string): void {
    if (VaultService.isIgnoredPath(relPath)) {
      return;
    }
    let changed = false;
    if (relPath.endsWith(".md")) {
      changed = this.repository.refreshFile(this.vaultDir, relPath);
    } else {
      this.repository.removeStale(new Set(this.repository.allPaths().filter((p) => p !== relPath)));
    }
    if (changed) {
      this.repository.resolveLinks();
      this.repository.rebuildFts();
    }
  }

  /** 启动文件监听（Obsidian 外部编辑自动增量；失败则回退手动刷新） */
  public startWatching(): void {
    try {
      if (!existsSync(this.vaultDir)) {
        return;
      }
      this.watcher = watch(this.vaultDir, { recursive: true }, () => {
        if (this.closed) {
          return;
        }
        if (this.refreshTimer !== null) {
          clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
          this.scan();
        }, 600);
      });
      this.watcher.on("error", (error) => {
        logger.warn({ error }, "知识库文件监听失败，回退手动刷新");
        this.stopWatching();
      });
      logger.info({ vault: this.vaultDir }, "知识库文件监听已启动（Obsidian 外部编辑自动同步）");
    } catch (error) {
      logger.warn({ error }, "知识库文件监听不可用（可能为网络盘），请使用手动刷新");
    }
  }

  public stopWatching(): void {
    this.closed = true;
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** 保存笔记（写回 vault 文件，原子写 tmp+rename）；成功后同步索引 */
  public saveNote(relPath: string, raw: string): { path: string; mtime: number } {
    if (VaultService.isIgnoredPath(relPath)) {
      throw new Error("目标路径被忽略（Obsidian 内部目录），不允许写入");
    }
    const safe = this.resolveSafePath(relPath);
    if (!safe.startsWith(this.vaultDir + path.sep)) {
      throw new Error("路径越界：不允许写到 vault 目录之外");
    }
    if (path.extname(safe).toLowerCase() !== ".md") {
      throw new Error("仅支持保存 .md 笔记");
    }
    mkdirSync(path.dirname(safe), { recursive: true });
    const tmp = `${safe}.${randomUUID()}.tmp`;
    writeFileSync(tmp, raw, "utf8");
    renameSync(tmp, safe);
    const stat = new Date();
    const changed = this.repository.refreshFile(this.vaultDir, relPath);
    if (changed) {
      this.repository.resolveLinks();
      this.repository.rebuildFts();
    }
    return { path: relPath, mtime: stat.getTime() };
  }

  /** 读取笔记原文（前端编辑时直接编辑 .md 全文） */
  public readRaw(relPath: string): string | null {
    if (VaultService.isIgnoredPath(relPath)) {
      return null;
    }
    const safe = this.resolveSafePath(relPath);
    if (!safe.startsWith(this.vaultDir + path.sep)) {
      return null;
    }
    if (!existsSync(safe)) {
      return null;
    }
    return readFileSync(safe, "utf8");
  }

  private resolveSafePath(relPath: string): string {
    return path.resolve(this.vaultDir, relPath);
  }
}
