import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export type CockpitDatabase = Database.Database;

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function readMigrations(migrationsDirectory: string): Migration[] {
  if (!existsSync(migrationsDirectory)) {
    throw new Error(`找不到数据库迁移目录：${migrationsDirectory}`);
  }

  return readdirSync(migrationsDirectory)
    .filter((fileName) => /^\d{3}_.+\.sql$/u.test(fileName))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => {
      const version = Number(fileName.slice(0, 3));
      return {
        version,
        name: fileName,
        sql: readFileSync(path.join(migrationsDirectory, fileName), "utf8"),
      };
    });
}

function migrateDatabase(
  database: CockpitDatabase,
  migrationsDirectory: string,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const migrations = readMigrations(migrationsDirectory);
  const supportedVersion = migrations.at(-1)?.version ?? 0;
  const currentVersion =
    database
      .prepare(
        "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
      )
      .get() as { version: number };

  if (currentVersion.version > supportedVersion) {
    throw new Error(
      `数据版本 ${currentVersion.version} 高于当前应用支持的 ${supportedVersion}，已拒绝启动以保护数据。`,
    );
  }

  const applyMigration = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      )
      .run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (migration.version > currentVersion.version) {
      applyMigration(migration);
    }
  }
}

export function openDatabase(
  databasePath: string,
  migrationsDirectory: string,
): CockpitDatabase {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);

  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  // 单用户单进程优先保证“停服后整目录可搬走”的简单性。
  database.pragma("journal_mode = DELETE");

  try {
    migrateDatabase(database, migrationsDirectory);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
