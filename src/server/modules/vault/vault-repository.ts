import type {
  VaultGraph,
  VaultGraphLink,
  VaultGraphNode,
  VaultNoteDetail,
  VaultNoteSummary,
  VaultStats,
} from "../../../shared/contracts/vault.js";
import type { CockpitDatabase } from "../../platform/database.js";
import path from "node:path";
import { parseVaultNoteFile, type ParsedVaultNote } from "./vault-scanner.js";

interface NoteRow {
  id: number;
  path: string;
  title: string;
  kind: string;
  frontmatter: string | null;
  content: string;
  excerpt: string | null;
  wikilinks: string;
  mtime: number;
  size: number;
  indexed_at: number;
  out_links: number;
  in_links: number;
}

interface LinkRow {
  source: string;
  target: string;
  target_path: string | null;
  embed: number;
}

interface CountRow {
  count: number;
}

interface LastIndexedRow {
  last_indexed_at: number | null;
}

function toSummary(row: NoteRow): VaultNoteSummary {
  return {
    path: row.path,
    title: row.title,
    kind: row.kind,
    excerpt: row.excerpt,
    outLinkCount: row.out_links,
    inLinkCount: row.in_links,
    mtime: row.mtime,
    indexedAt: row.indexed_at,
  };
}

/** FTS5 trigram 查询串：中文需 >=3 字符，短词/数字回退 LIKE（小库全表扫毫秒级） */
function buildFtsQuery(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length >= 3) {
    return `"${trimmed.replace(/"/g, '""')}"`;
  }
  return "";
}

function normalizeLookupPath(value: string): string | null {
  const normalized = path.posix.normalize(
    value.trim().replace(/\\/gu, "/").replace(/^\/+/, ""),
  );
  if (
    normalized === "" ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return null;
  }
  return normalized.toLocaleLowerCase("zh-CN");
}

function withMarkdownExtension(value: string): string {
  return /\.md$/iu.test(value) ? value : `${value}.md`;
}

function resolveLinkPath(
  source: string,
  target: string,
  paths: ReadonlyMap<string, string>,
  uniqueBasenames: ReadonlyMap<string, string>,
): string | null {
  const normalizedTarget = target.trim().replace(/\\/gu, "/");
  if (normalizedTarget === "") {
    return null;
  }

  const explicitPath =
    normalizedTarget.includes("/") ||
    normalizedTarget.startsWith(".") ||
    /\.md$/iu.test(normalizedTarget);
  if (explicitPath) {
    const candidates: string[] = [];
    const relative = normalizedTarget.startsWith("./") || normalizedTarget.startsWith("../");
    if (!relative) {
      candidates.push(withMarkdownExtension(normalizedTarget));
    }
    candidates.push(
      withMarkdownExtension(path.posix.join(path.posix.dirname(source), normalizedTarget)),
    );

    for (const candidate of candidates) {
      const key = normalizeLookupPath(candidate);
      const resolved = key === null ? undefined : paths.get(key);
      if (resolved !== undefined) {
        return resolved;
      }
    }
  }

  const basename = path.posix
    .basename(normalizedTarget)
    .replace(/\.md$/iu, "")
    .toLocaleLowerCase("zh-CN");
  return uniqueBasenames.get(basename) ?? null;
}

function buildSearchPredicate(query: string): { sql: string; params: string[] } {
  const trimmed = query.trim();
  const needle = trimmed.toLocaleLowerCase("zh-CN");
  const fts = buildFtsQuery(trimmed);
  const ftsClause =
    fts !== ""
      ? `OR EXISTS (SELECT 1 FROM vault_fts WHERE vault_fts MATCH ? AND vault_fts.rowid = n.id)`
      : "";
  return {
    sql: `(instr(lower(n.title), lower(?)) > 0
       OR instr(lower(n.content), lower(?)) > 0
       ${ftsClause})`,
    params: fts === "" ? [trimmed, needle] : [trimmed, needle, fts],
  };
}

export class VaultRepository {
  public constructor(private readonly database: CockpitDatabase) {}

  public upsertNote(note: ParsedVaultNote): void {
    const sync = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO vault_notes (
             path, title, kind, frontmatter, content, excerpt, wikilinks,
             mtime, size, indexed_at
           ) VALUES (?, ?, 'note', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(path) DO UPDATE SET
             title = excluded.title,
             frontmatter = excluded.frontmatter,
             content = excluded.content,
             excerpt = excluded.excerpt,
             wikilinks = excluded.wikilinks,
             mtime = excluded.mtime,
             size = excluded.size,
             indexed_at = excluded.indexed_at`,
        )
        .run(
          note.relPath,
          note.title,
          note.frontmatter,
          note.content,
          note.excerpt,
          JSON.stringify(note.wikilinks),
          note.mtime,
          note.size,
          Date.now(),
        );

      this.database
        .prepare("DELETE FROM vault_links WHERE source = ?")
        .run(note.relPath);

      const insertLink = this.database.prepare(
        `INSERT INTO vault_links (source, target, target_path, embed)
         VALUES (?, ?, ?, ?)`,
      );
      for (const link of note.wikilinks) {
        insertLink.run(note.relPath, link.target, null, link.embed ? 1 : 0);
      }
    });
    sync();
  }

  /** 解析路径型/相对 wikilink；只在 basename 全库唯一时才回退匹配。 */
  public resolveLinks(): void {
    const notes = this.database
      .prepare("SELECT path FROM vault_notes")
      .all() as Array<{ path: string }>;
    const paths = new Map<string, string>();
    const basenameGroups = new Map<string, string[]>();
    for (const note of notes) {
      const pathKey = normalizeLookupPath(note.path);
      if (pathKey !== null) {
        paths.set(pathKey, note.path);
      }
      const basename = path.posix
        .basename(note.path)
        .replace(/\.md$/iu, "")
        .toLocaleLowerCase("zh-CN");
      const group = basenameGroups.get(basename) ?? [];
      group.push(note.path);
      basenameGroups.set(basename, group);
    }
    const uniqueBasenames = new Map<string, string>();
    for (const [basename, matches] of basenameGroups) {
      if (matches.length === 1) {
        uniqueBasenames.set(basename, matches[0]!);
      }
    }

    const links = this.database
      .prepare("SELECT id, source, target FROM vault_links")
      .all() as Array<{ id: number; source: string; target: string }>;
    const update = this.database.prepare(
      "UPDATE vault_links SET target_path = ? WHERE id = ?",
    );
    const apply = this.database.transaction(() => {
      for (const link of links) {
        update.run(
          resolveLinkPath(link.source, link.target, paths, uniqueBasenames),
          link.id,
        );
      }
    });
    apply();
  }

  /** 检查索引中是否已有该笔记且文件未变：true=新鲜，false=过期，null=未索引 */
  public isIndexedFresh(relPath: string, mtime: number, size: number): boolean | null {
    const row = this.database
      .prepare("SELECT mtime, size FROM vault_notes WHERE path = ?")
      .get(relPath) as { mtime: number; size: number } | undefined;
    if (row === undefined) {
      return null;
    }
    return row.mtime === mtime && row.size === size;
  }

  /** 删除索引中已不存在的文件，返回删除数量 */
  public removeStaleAndCount(existingPaths: Set<string>): number {
    const stale = this.database
      .prepare("SELECT path FROM vault_notes")
      .all() as Array<{ path: string }>;
    const remove = this.database.prepare("DELETE FROM vault_notes WHERE path = ?");
    const removeSourceLinks = this.database.prepare("DELETE FROM vault_links WHERE source = ?");
    const clearInboundLinks = this.database.prepare(
      "UPDATE vault_links SET target_path = NULL WHERE target_path = ?",
    );
    let removed = 0;
    const apply = this.database.transaction(() => {
      for (const row of stale) {
        if (!existingPaths.has(row.path)) {
          remove.run(row.path);
          removeSourceLinks.run(row.path);
          clearInboundLinks.run(row.path);
          removed += 1;
        }
      }
    });
    apply();
    return removed;
  }

  /** 单文件增量：文件仍存在且有变化 → upsert；文件消失 → 清索引 */
  public refreshFile(vaultDir: string, relPath: string): boolean {
    let parsed: ParsedVaultNote | null = null;
    try {
      parsed = parseVaultNoteFile(vaultDir, path.join(vaultDir, relPath));
    } catch {
      parsed = null;
    }
    if (parsed === null) {
      const stale = this.database
        .prepare("SELECT path FROM vault_notes WHERE path = ?")
        .get(relPath) as { path: string } | undefined;
      if (stale !== undefined) {
        this.removeNote(relPath);
        return true;
      }
      return false;
    }
    if (this.isIndexedFresh(parsed.relPath, parsed.mtime, parsed.size)) {
      return false;
    }
    this.upsertNote(parsed);
    return true;
  }

  public allPaths(): string[] {
    return (
      this.database
        .prepare("SELECT path FROM vault_notes")
        .all() as Array<{ path: string }>
    ).map((row) => row.path);
  }

  /** 删除索引中已不存在的文件（按 mtime 增量扫描后清理） */
  public removeStale(existingPaths: Set<string>): void {
    const stale = this.database
      .prepare("SELECT path FROM vault_notes")
      .all() as Array<{ path: string }>;
    const remove = this.database.prepare("DELETE FROM vault_notes WHERE path = ?");
    const removeSourceLinks = this.database.prepare("DELETE FROM vault_links WHERE source = ?");
    const clearInboundLinks = this.database.prepare(
      "UPDATE vault_links SET target_path = NULL WHERE target_path = ?",
    );
    const apply = this.database.transaction(() => {
      for (const row of stale) {
        if (!existingPaths.has(row.path)) {
          remove.run(row.path);
          removeSourceLinks.run(row.path);
          clearInboundLinks.run(row.path);
        }
      }
    });
    apply();
  }

  public count(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM vault_notes")
      .get() as CountRow;
    return row.count;
  }

  public list(limit: number, offset = 0): VaultNoteSummary[] {
    const rows = this.database
      .prepare(
        `SELECT n.*,
           (SELECT COUNT(*) FROM vault_links l WHERE l.source = n.path) AS out_links,
           (SELECT COUNT(*) FROM vault_links l WHERE l.target_path = n.path) AS in_links
         FROM vault_notes n
         ORDER BY n.mtime DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as NoteRow[];
    return rows.map(toSummary);
  }

  public countSearch(query: string): number {
    const predicate = buildSearchPredicate(query);
    const row = this.database
      .prepare(`SELECT COUNT(*) AS count FROM vault_notes n WHERE ${predicate.sql}`)
      .get(...predicate.params) as CountRow;
    return row.count;
  }

  public search(query: string, limit: number, offset = 0): VaultNoteSummary[] {
    const trimmed = query.trim();
    const predicate = buildSearchPredicate(trimmed);

    const rows = this.database
      .prepare(
        `SELECT n.*,
           (SELECT COUNT(*) FROM vault_links l WHERE l.source = n.path) AS out_links,
           (SELECT COUNT(*) FROM vault_links l WHERE l.target_path = n.path) AS in_links,
           CASE WHEN instr(lower(n.title), lower(?)) > 0 THEN 0 ELSE 1 END AS prio
         FROM vault_notes n
         WHERE ${predicate.sql}
         ORDER BY prio, n.mtime DESC
         LIMIT ? OFFSET ?`,
      )
      .all(trimmed, ...predicate.params, limit, offset) as Array<
      NoteRow & { prio: number }
    >;
    return rows.map(toSummary);
  }

  public findNote(path: string): VaultNoteDetail | null {
    const row = this.database
      .prepare(
        `SELECT n.*,
           (SELECT COUNT(*) FROM vault_links l WHERE l.source = n.path) AS out_links,
           (SELECT COUNT(*) FROM vault_links l WHERE l.target_path = n.path) AS in_links
         FROM vault_notes n
         WHERE n.path = ?`,
      )
      .get(path) as NoteRow | undefined;
    if (row === undefined) {
      return null;
    }

    const wikilinks = JSON.parse(row.wikilinks) as Array<{
      target: string;
      label: string | null;
      embed: boolean;
    }>;
    const resolved = new Map<string, string>();
    const dangling: string[] = [];
    const rows = this.database
      .prepare(
        `SELECT source, target, target_path, embed
         FROM vault_links WHERE source = ?`,
      )
      .all(path) as LinkRow[];
    for (const link of rows) {
      if (link.target_path === null) {
        dangling.push(link.target);
      } else {
        resolved.set(link.target, link.target_path);
      }
    }

    const backlinkRows = this.database
      .prepare(
        `SELECT n.path AS source, n.title, n.excerpt
         FROM vault_links l
         JOIN vault_notes n ON n.path = l.source
         WHERE l.target_path = ? AND n.path != ?
         ORDER BY n.mtime DESC
         LIMIT 50`,
      )
      .all(path, path) as Array<{ source: string; title: string; excerpt: string | null }>;

    return {
      path: row.path,
      title: row.title,
      kind: row.kind,
      excerpt: row.excerpt,
      outLinkCount: row.out_links,
      inLinkCount: row.in_links,
      mtime: row.mtime,
      indexedAt: row.indexed_at,
      frontmatter: row.frontmatter,
      content: row.content,
      wikilinks: wikilinks.map((link) => ({
        target: link.target,
        label: link.label,
        embed: link.embed,
        resolvedPath: resolved.get(link.target) ?? null,
      })),
      backlinks: backlinkRows,
      isDangling: dangling,
    };
  }

  public graph(): VaultGraph {
    const nodes = this.database
      .prepare("SELECT path, title, kind FROM vault_notes")
      .all() as Array<{ path: string; title: string; kind: string }>;
    const links = this.database
      .prepare(
        `SELECT source, target_path AS target
         FROM vault_links
         WHERE target_path IS NOT NULL AND source != target_path`,
      )
      .all() as Array<{ source: string; target: string }>;
    const danglingCount = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM vault_links WHERE target_path IS NULL",
      )
      .get() as CountRow;
    const lastIndexed = this.database
      .prepare("SELECT MAX(indexed_at) AS last_indexed_at FROM vault_notes")
      .get() as LastIndexedRow;

    const dedup = new Map<string, VaultGraphLink>();
    for (const link of links) {
      const key = link.source < link.target
        ? `${link.source}\u0000${link.target}`
        : `${link.target}\u0000${link.source}`;
      if (!dedup.has(key)) {
        dedup.set(key, link);
      }
    }
    const dedupLinks = Array.from(dedup.values());
    const degree = new Map<string, number>();
    for (const link of dedupLinks) {
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    }

    return {
      nodes: nodes.map((node) => ({
        path: node.path,
        title: node.title,
        kind: node.kind,
        degree: degree.get(node.path) ?? 0,
      })),
      links: dedupLinks.map((link) => ({
        source: link.source,
        target: link.target,
      })),
      stats: {
        noteCount: nodes.length,
        linkCount: dedupLinks.length,
        danglingLinkCount: danglingCount.count,
        lastIndexedAt: lastIndexed.last_indexed_at,
      },
    };
  }

  public stats(): VaultStats {
    const notes = this.database.prepare("SELECT COUNT(*) AS count FROM vault_notes").get() as CountRow;
    const links = this.database.prepare("SELECT COUNT(*) AS count FROM vault_links").get() as CountRow;
    const dangling = this.database
      .prepare("SELECT COUNT(*) AS count FROM vault_links WHERE target_path IS NULL")
      .get() as CountRow;
    const lastIndexed = this.database
      .prepare("SELECT MAX(indexed_at) AS last_indexed_at FROM vault_notes")
      .get() as LastIndexedRow;
    const size = this.database
      .prepare("SELECT COALESCE(SUM(size), 0) AS count FROM vault_notes")
      .get() as CountRow;

    return {
      noteCount: notes.count,
      linkCount: links.count,
      danglingLinkCount: dangling.count,
      lastIndexedAt: lastIndexed.last_indexed_at,
      totalSizeBytes: size.count,
    };
  }

  public removeNote(path: string): void {
    const remove = this.database.transaction(() => {
      this.database.prepare("DELETE FROM vault_notes WHERE path = ?").run(path);
      this.database.prepare("DELETE FROM vault_links WHERE source = ?").run(path);
      this.database
        .prepare("UPDATE vault_links SET target_path = NULL WHERE target_path = ?")
        .run(path);
    });
    remove();
  }

  public touchIndexedAt(): void {
    this.database
      .prepare("UPDATE vault_notes SET indexed_at = ? WHERE mtime = mtime")
      .run(Date.now());
  }

  /** 重建全文镜像（结构简单，全删全插即可） */
  public rebuildFts(): void {
    const rebuild = this.database.transaction(() => {
      this.database.prepare("DELETE FROM vault_fts").run();
      const insert = this.database.prepare(
        "INSERT INTO vault_fts (rowid, title, content, excerpt) VALUES (?, ?, ?, ?)",
      );
      const notes = this.database
        .prepare("SELECT id, title, content, excerpt FROM vault_notes")
        .all() as Array<{ id: number; title: string; content: string; excerpt: string | null }>;
      for (const note of notes) {
        insert.run(note.id, note.title, note.content, note.excerpt ?? "");
      }
    });
    rebuild();
  }
}
