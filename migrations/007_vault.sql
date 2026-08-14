-- V8: 知识库（Obsidian vault 索引）— 笔记 / 链接 / 全文检索
-- vault 笔记以 .md 文件为唯一真源（Obsidian 双向编辑），此处仅为可检索镜像。
-- FTS5 trigram tokenizer：与 memory 模块一致，中文无需分词（>=3 字符可匹配）。

CREATE TABLE IF NOT EXISTS vault_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,            -- vault 内相对路径（正斜杠），如 wiki/entities/dewu.md
  title TEXT NOT NULL,                  -- 文件名（无扩展名）
  kind TEXT NOT NULL DEFAULT 'note',
  frontmatter TEXT,                     -- YAML frontmatter 原文（无则 NULL）
  content TEXT NOT NULL DEFAULT '',     -- 正文全文（不含 frontmatter）
  excerpt TEXT,                         -- 正文首段摘要（供列表展示）
  wikilinks TEXT NOT NULL DEFAULT '[]', -- JSON 数组 [{target, label, embed}]
  mtime INTEGER NOT NULL,               -- 文件修改时间（ms）
  size INTEGER NOT NULL DEFAULT 0,
  indexed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_notes_mtime ON vault_notes (mtime DESC);

CREATE TABLE IF NOT EXISTS vault_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,                 -- 出链笔记 path
  target TEXT NOT NULL,                 -- wikilink 原文目标（标题，未解析）
  target_path TEXT,                     -- 解析到的笔记 path（NULL = 悬空链接）
  embed INTEGER NOT NULL DEFAULT 0,     -- 1 = ![[ 嵌入链接
  UNIQUE (source, target, embed)
);

CREATE INDEX IF NOT EXISTS idx_vault_links_source ON vault_links (source);
CREATE INDEX IF NOT EXISTS idx_vault_links_target ON vault_links (target_path);

-- 全文检索镜像（trigram 中文友好；行数与 vault_notes 对齐，随增删重建）
CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts USING fts5(
  title,
  content,
  excerpt,
  tokenize = 'trigram'
);
