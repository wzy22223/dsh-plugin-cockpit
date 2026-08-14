CREATE TABLE IF NOT EXISTS navigation_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '工作系统',
  accent TEXT NOT NULL DEFAULT 'blue',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_navigation_active_position
ON navigation_items (deleted_at, position, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  mode TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  outcome TEXT NOT NULL,
  session_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at
ON audit_events (created_at DESC);
