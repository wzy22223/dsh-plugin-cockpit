CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'link', 'note')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  url TEXT CHECK (url IS NULL OR length(url) BETWEEN 1 AND 2048),
  content TEXT CHECK (content IS NULL OR length(content) BETWEEN 1 AND 50000),
  storage_path TEXT CHECK (
    storage_path IS NULL OR length(storage_path) BETWEEN 1 AND 512
  ),
  original_filename TEXT CHECK (
    original_filename IS NULL
    OR length(original_filename) BETWEEN 1 AND 255
  ),
  mime_type TEXT CHECK (
    mime_type IS NULL OR length(mime_type) BETWEEN 1 AND 160
  ),
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT,
  CHECK (
    (
      kind = 'note'
      AND content IS NOT NULL
      AND url IS NULL
      AND storage_path IS NULL
      AND original_filename IS NULL
      AND mime_type IS NULL
      AND size_bytes IS NULL
    )
    OR (
      kind = 'link'
      AND url IS NOT NULL
      AND content IS NULL
      AND storage_path IS NULL
      AND original_filename IS NULL
      AND mime_type IS NULL
      AND size_bytes IS NULL
    )
    OR (
      kind = 'file'
      AND storage_path IS NOT NULL
      AND original_filename IS NOT NULL
      AND mime_type IS NOT NULL
      AND size_bytes IS NOT NULL
      AND url IS NULL
      AND content IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_resources_list
ON resources (deleted_at, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS resource_tags (
  resource_id TEXT NOT NULL,
  tag TEXT NOT NULL CHECK (length(trim(tag)) BETWEEN 1 AND 32),
  normalized_tag TEXT NOT NULL CHECK (
    length(trim(normalized_tag)) BETWEEN 1 AND 32
  ),
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 11),
  PRIMARY KEY (resource_id, normalized_tag),
  FOREIGN KEY (resource_id) REFERENCES resources (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_resource_tags_search
ON resource_tags (normalized_tag, resource_id);
