CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  scheduled_date TEXT NOT NULL CHECK (
    scheduled_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  scheduled_time TEXT NOT NULL CHECK (
    scheduled_time GLOB '[0-9][0-9]:[0-9][0-9]'
    AND CAST(substr(scheduled_time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    AND CAST(substr(scheduled_time, 4, 2) AS INTEGER) BETWEEN 0 AND 59
  ),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_active_schedule
ON tasks (deleted_at, scheduled_date, scheduled_time, created_at);
