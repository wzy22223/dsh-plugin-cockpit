import { randomUUID } from "node:crypto";

import type {
  CreateNavigationItem,
  NavigationAccent,
  NavigationItem,
} from "../../../shared/contracts/navigation.js";
import type { CockpitDatabase } from "../../platform/database.js";

interface NavigationRow {
  id: string;
  name: string;
  url: string;
  description: string;
  category: string;
  accent: NavigationAccent;
  position: number;
  created_at: string;
  updated_at: string;
}

function toNavigationItem(row: NavigationRow): NavigationItem {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    description: row.description,
    category: row.category,
    accent: row.accent,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class NavigationRepository {
  /** P2-1：审计上下文，区分操作来源（user / agent / mcp）与模式 */
  public auditContext: { actor: string; mode: string } = { actor: "user", mode: "daily" };

  public constructor(private readonly database: CockpitDatabase) {}

  public list(): NavigationItem[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, url, description, category, accent, position, created_at, updated_at
         FROM navigation_items
         WHERE deleted_at IS NULL
         ORDER BY position ASC, created_at ASC`,
      )
      .all() as NavigationRow[];

    return rows.map(toNavigationItem);
  }

  public find(id: string): NavigationItem | null {
    const row = this.database
      .prepare(
        `SELECT id, name, url, description, category, accent, position, created_at, updated_at
         FROM navigation_items
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as NavigationRow | undefined;

    return row === undefined ? null : toNavigationItem(row);
  }

  public create(input: Required<CreateNavigationItem>): NavigationItem {
    const id = randomUUID();
    const now = new Date().toISOString();

    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO navigation_items (
             id, name, url, description, category, accent, position, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.url,
          input.description,
          input.category,
          input.accent,
          input.position,
          now,
          now,
        );

      this.writeAudit("navigation.create", id, "success");
    });

    create();
    return this.find(id) as NavigationItem;
  }

  public update(
    id: string,
    input: Required<CreateNavigationItem>,
  ): NavigationItem | null {
    if (this.find(id) === null) {
      return null;
    }

    const update = this.database.transaction(() => {
      this.database
        .prepare(
          `UPDATE navigation_items
           SET name = ?, url = ?, description = ?, category = ?, accent = ?,
               position = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(
          input.name,
          input.url,
          input.description,
          input.category,
          input.accent,
          input.position,
          new Date().toISOString(),
          id,
        );

      this.writeAudit("navigation.update", id, "success");
    });

    update();
    return this.find(id);
  }

  public softDelete(id: string): boolean {
    const remove = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE navigation_items
           SET deleted_at = ?, deleted_by = 'user', updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(new Date().toISOString(), new Date().toISOString(), id);

      if (result.changes > 0) {
        this.writeAudit("navigation.soft-delete", id, "success");
        return true;
      }

      return false;
    });

    return remove();
  }

  public restore(id: string): NavigationItem | null {
    const restore = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE navigation_items
           SET deleted_at = NULL, deleted_by = NULL, updated_at = ?
           WHERE id = ? AND deleted_at IS NOT NULL`,
        )
        .run(new Date().toISOString(), id);

      if (result.changes > 0) {
        this.writeAudit("navigation.restore", id, "success");
        return true;
      }

      return false;
    });

    return restore() ? this.find(id) : null;
  }

  public recordOpen(id: string, outcome: "success" | "failure"): void {
    this.writeAudit("navigation.open", id, outcome);
  }

  private writeAudit(action: string, targetId: string, outcome: string): void {
    const { actor, mode } = this.auditContext;
    this.database
      .prepare(
        `INSERT INTO audit_events (
           id, actor, mode, action, target_type, target_id, outcome, created_at
         ) VALUES (?, ?, ?, ?, 'navigation', ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        actor,
        mode,
        action,
        targetId,
        outcome,
        new Date().toISOString(),
      );
  }
}
