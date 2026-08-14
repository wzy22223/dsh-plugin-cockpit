CREATE TABLE IF NOT EXISTS feed_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  url TEXT NOT NULL UNIQUE CHECK (length(url) BETWEEN 1 AND 2048),
  last_refreshed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_feed_sources_active_created
ON feed_sources (deleted_at, created_at);

CREATE TABLE IF NOT EXISTS feed_items (
  id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES feed_sources(id),
  origin TEXT NOT NULL CHECK (origin IN ('rss', 'manual')),
  external_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  summary TEXT NOT NULL DEFAULT '' CHECK (length(summary) <= 4000),
  author TEXT NOT NULL DEFAULT '' CHECK (length(author) <= 200),
  published_at TEXT,
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK (status IN ('unread', 'read', 'later', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  CHECK (
    (origin = 'rss' AND source_id IS NOT NULL)
    OR (origin = 'manual' AND source_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_feed_items_active_status_published
ON feed_items (deleted_at, status, published_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feed_items_active_source
ON feed_items (source_id, deleted_at, published_at DESC, created_at DESC);
