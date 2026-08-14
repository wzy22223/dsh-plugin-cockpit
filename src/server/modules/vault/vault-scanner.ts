import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** 解析出的单篇笔记原始信息（尚未入库） */
export interface ParsedVaultNote {
  relPath: string;
  title: string;
  frontmatter: string | null;
  content: string;
  excerpt: string | null;
  wikilinks: Array<{ target: string; label: string | null; embed: boolean }>;
  mtime: number;
  size: number;
}

/** 扫描器忽略的目录（Obsidian 内部目录/旧工具残留/隐藏目录） */
const IGNORED_DIRS = new Set([".obsidian", ".llm-wiki", ".trash", ".git", ".cache", ".superpowers"]);

/** 仅索引 markdown 笔记 */
const NOTE_EXT = ".md";

/** 匹配 [[目标]]、[[目标|别名]]、[[目标#标题]]、![[嵌入]]（含 ![[文件.png]] 嵌入，保留 target） */
const WIKILINK_RE = /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]*?))?\]\]/g;

export function isIgnoredDir(name: string): boolean {
  return IGNORED_DIRS.has(name) || name.startsWith(".");
}

/** 解析 wikilink 目标为规范化标题（用于解析路径的键） */
export function normalizeLinkTarget(target: string): string {
  return target.trim();
}

/** 在文件树中解析 wikilink 目标 → 笔记路径（优先精确 basename，再按大小写不敏感匹配） */
export function resolveLinkTarget(
  target: string,
  pathByBasename: Map<string, string>,
): string | null {
  const name = normalizeLinkTarget(target).toLocaleLowerCase("zh-CN");
  return pathByBasename.get(name) ?? null;
}

/** 解析 frontmatter：---\n...\n---（YAML 简单行解析，保留原文） */
export function parseFrontmatter(raw: string): { frontmatter: string | null; body: string } {
  if (!raw.startsWith("---")) {
    return { frontmatter: null, body: raw };
  }
  const endMarker = raw.indexOf("\n---", 3);
  if (endMarker < 0) {
    return { frontmatter: null, body: raw };
  }
  const frontmatter = raw.slice(3, endMarker).replace(/^\n/, "").trim();
  const body = raw.slice(endMarker + 4).replace(/^\n/, "");
  return { frontmatter: frontmatter === "" ? null : frontmatter, body };
}

function extractExcerpt(body: string): string | null {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== "" &&
        !line.startsWith("#") &&
        !line.startsWith("-") &&
        !line.startsWith("|") &&
        !line.startsWith("![[") &&
        !line.startsWith("```") &&
        !line.startsWith("[["),
    );
  const first = lines[0];
  return first === undefined ? null : first.slice(0, 300);
}

export function parseWikilinks(body: string): Array<{ target: string; label: string | null; embed: boolean }> {
  const links: Array<{ target: string; label: string | null; embed: boolean }> = [];
  const seen = new Set<string>();
  WIKILINK_RE.lastIndex = 0;
  for (const match of body.matchAll(WIKILINK_RE)) {
    const target = normalizeLinkTarget(match[1] ?? "");
    if (target === "") continue;
    const key = `${match[0].startsWith("!") ? "!" : ""}${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      target,
      label: (match[2] ?? "").trim() || null,
      embed: match[0].startsWith("!"),
    });
  }
  return links;
}

/** 单文件解析（供增量扫描/单文件刷新复用） */
export function parseVaultNoteFile(vaultDir: string, absPath: string): ParsedVaultNote {
  const relPath = path.relative(vaultDir, absPath).split(path.sep).join("/");
  const raw = readFileSync(absPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const stat = statSync(absPath);
  return {
    relPath,
    title: path.basename(relPath, NOTE_EXT),
    frontmatter,
    content: body,
    excerpt: extractExcerpt(body),
    wikilinks: parseWikilinks(body),
    mtime: stat.mtimeMs,
    size: stat.size,
  };
}

/** 递归扫描 vault 目录，返回全部笔记（含目录不存在的容错） */
export function scanVaultFiles(vaultDir: string): ParsedVaultNote[] {
  const notes: ParsedVaultNote[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(NOTE_EXT)) {
        continue;
      }
      try {
        notes.push(parseVaultNoteFile(vaultDir, path.join(dir, entry.name)));
      } catch {
        // 单个文件解析失败不影响整体扫描
      }
    }
  };

  walk(vaultDir);
  return notes;
}
