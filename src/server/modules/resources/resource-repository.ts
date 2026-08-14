import { randomUUID } from "node:crypto";

import type {
  CreateResourceInput,
  ResourceItem,
  ResourceKind,
} from "../../../shared/contracts/resources.js";
import type { CockpitDatabase } from "../../platform/database.js";

interface ResourceRow {
  id: string;
  kind: ResourceKind;
  title: string;
  url: string | null;
  content: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface TagRow {
  resource_id: string;
  tag: string;
}

export interface ResourceListFilter {
  query: string;
  kind: ResourceKind | undefined;
  trash: boolean;
}

export type NewResource =
  | (CreateResourceInput & { tags: string[] })
  | {
      kind: "file";
      title: string;
      tags: string[];
      storagePath: string;
      originalFilename: string;
      mimeType: string;
      sizeBytes: number;
    };

function toResourceItem(row: ResourceRow, tags: string[]): ResourceItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    tags,
    url: row.url,
    content: row.content,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

export class ResourceRepository {
  /** P2-1：审计上下文，区分操作来源（user / agent / mcp）与模式 */
  public auditContext: { actor: string; mode: string } = { actor: "user", mode: "daily" };

  public constructor(private readonly database: CockpitDatabase) {}

  public list(filter: ResourceListFilter): ResourceItem[] {
    const conditions = [
      filter.trash ? "r.deleted_at IS NOT NULL" : "r.deleted_at IS NULL",
    ];
    const parameters: string[] = [];

    if (filter.kind !== undefined) {
      conditions.push("r.kind = ?");
      parameters.push(filter.kind);
    }

    if (filter.query !== "") {
      conditions.push(
        `(instr(lower(r.title), lower(?)) > 0
          OR EXISTS (
            SELECT 1
            FROM resource_tags searched_tag
            WHERE searched_tag.resource_id = r.id
              AND instr(searched_tag.normalized_tag, ?) > 0
          ))`,
      );
      parameters.push(
        filter.query,
        filter.query.toLocaleLowerCase("zh-CN"),
      );
    }

    const rows = this.database
      .prepare(
        `SELECT
           r.id, r.kind, r.title, r.url, r.content, r.storage_path,
           r.original_filename, r.mime_type, r.size_bytes, r.created_at,
           r.updated_at, r.deleted_at
         FROM resources r
         WHERE ${conditions.join(" AND ")}
         ORDER BY r.updated_at DESC, r.created_at DESC`,
      )
      .all(...parameters) as ResourceRow[];

    return this.withTags(rows);
  }

  public findActive(id: string): ResourceItem | null {
    return this.findByDeletionState(id, false);
  }

  public create(input: NewResource): ResourceItem {
    const id = randomUUID();
    const now = new Date().toISOString();

    const create = this.database.transaction(() => {
      const fileValues =
        input.kind === "file"
          ? {
              storagePath: input.storagePath,
              originalFilename: input.originalFilename,
              mimeType: input.mimeType,
              sizeBytes: input.sizeBytes,
            }
          : {
              storagePath: null,
              originalFilename: null,
              mimeType: null,
              sizeBytes: null,
            };

      this.database
        .prepare(
          `INSERT INTO resources (
             id, kind, title, url, content, storage_path, original_filename,
             mime_type, size_bytes, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.kind,
          input.title,
          input.kind === "link" ? input.url : null,
          input.kind === "note" ? input.content : null,
          fileValues.storagePath,
          fileValues.originalFilename,
          fileValues.mimeType,
          fileValues.sizeBytes,
          now,
          now,
        );

      const insertTag = this.database.prepare(
        `INSERT INTO resource_tags (
           resource_id, tag, normalized_tag, position
         ) VALUES (?, ?, ?, ?)`,
      );
      input.tags.forEach((value, index) => {
        insertTag.run(
          id,
          value,
          value.toLocaleLowerCase("zh-CN"),
          index,
        );
      });

      this.writeAudit("resource.create", id, now);
    });

    create();
    return this.findActive(id) as ResourceItem;
  }

  public softDelete(id: string): boolean {
    const now = new Date().toISOString();
    const remove = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE resources
           SET deleted_at = ?, deleted_by = 'user', updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(now, now, id);

      if (result.changes === 0) {
        return false;
      }

      this.writeAudit("resource.soft-delete", id, now);
      return true;
    });

    return remove();
  }

  public restore(id: string): ResourceItem | null {
    const now = new Date().toISOString();
    const restore = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE resources
           SET deleted_at = NULL, deleted_by = NULL, updated_at = ?
           WHERE id = ? AND deleted_at IS NOT NULL`,
        )
        .run(now, id);

      if (result.changes === 0) {
        return false;
      }

      this.writeAudit("resource.restore", id, now);
      return true;
    });

    return restore() ? this.findActive(id) : null;
  }

  public findStoragePath(id: string): string | null {
    const row = this.database
      .prepare(
        `SELECT storage_path
         FROM resources
         WHERE id = ? AND kind = 'file' AND deleted_at IS NULL`,
      )
      .get(id) as { storage_path: string } | undefined;

    return row?.storage_path ?? null;
  }

  private findByDeletionState(
    id: string,
    deleted: boolean,
  ): ResourceItem | null {
    const row = this.database
      .prepare(
        `SELECT
           id, kind, title, url, content, storage_path, original_filename,
           mime_type, size_bytes, created_at, updated_at, deleted_at
         FROM resources
         WHERE id = ? AND deleted_at IS ${deleted ? "NOT NULL" : "NULL"}`,
      )
      .get(id) as ResourceRow | undefined;

    return row === undefined ? null : this.withTags([row])[0] ?? null;
  }

  private withTags(rows: ResourceRow[]): ResourceItem[] {
    if (rows.length === 0) {
      return [];
    }

    const placeholders = rows.map(() => "?").join(", ");
    const tags = this.database
      .prepare(
        `SELECT resource_id, tag
         FROM resource_tags
         WHERE resource_id IN (${placeholders})
         ORDER BY resource_id ASC, position ASC`,
      )
      .all(...rows.map((row) => row.id)) as TagRow[];
    const tagsByResource = new Map<string, string[]>();

    for (const tagRow of tags) {
      const resourceTags = tagsByResource.get(tagRow.resource_id) ?? [];
      resourceTags.push(tagRow.tag);
      tagsByResource.set(tagRow.resource_id, resourceTags);
    }

    return rows.map((row) =>
      toResourceItem(row, tagsByResource.get(row.id) ?? []),
    );
  }

  private writeAudit(
    action: string,
    targetId: string,
    createdAt: string,
  ): void {
    const { actor, mode } = this.auditContext;
    this.database
      .prepare(
        `INSERT INTO audit_events (
           id, actor, mode, action, target_type, target_id, outcome, created_at
         ) VALUES (?, ?, ?, ?, 'resource', ?, 'success', ?)`,
      )
      .run(randomUUID(), actor, mode, action, targetId, createdAt);
  }
}
