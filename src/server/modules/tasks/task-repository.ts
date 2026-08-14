import { randomUUID } from "node:crypto";

import type {
  CreateScheduledTask,
  ScheduledTask,
  TaskListQuery,
  TaskStatus,
} from "../../../shared/contracts/tasks.js";
import type { CockpitDatabase } from "../../platform/database.js";

interface TaskRow {
  id: string;
  title: string;
  scheduled_date: string;
  scheduled_time: string;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

function toScheduledTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    title: row.title,
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TaskRepository {
  /** P2-1：审计上下文，区分操作来源（user / agent / mcp）与模式 */
  public auditContext: { actor: string; mode: string } = { actor: "user", mode: "daily" };

  public constructor(private readonly database: CockpitDatabase) {}

  public list(query: TaskListQuery): ScheduledTask[] {
    const conditions = ["deleted_at IS NULL"];
    const parameters: string[] = [];

    if (query.date !== undefined) {
      conditions.push("scheduled_date = ?");
      parameters.push(query.date);
    } else {
      if (query.from !== undefined) {
        conditions.push("scheduled_date >= ?");
        parameters.push(query.from);
      }

      if (query.to !== undefined) {
        conditions.push("scheduled_date <= ?");
        parameters.push(query.to);
      }
    }

    if (query.status !== undefined && query.status !== "all") {
      conditions.push("status = ?");
      parameters.push(query.status);
    }

    const rows = this.database
      .prepare(
        `SELECT id, title, scheduled_date, scheduled_time, status, created_at, updated_at
         FROM tasks
         WHERE ${conditions.join(" AND ")}
         ORDER BY scheduled_date ASC, scheduled_time ASC, created_at ASC`,
      )
      .all(...parameters) as TaskRow[];

    return rows.map(toScheduledTask);
  }

  public listByDate(scheduledDate: string): ScheduledTask[] {
    return this.list({ date: scheduledDate });
  }

  public find(id: string): ScheduledTask | null {
    const row = this.database
      .prepare(
        `SELECT id, title, scheduled_date, scheduled_time, status, created_at, updated_at
         FROM tasks
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as TaskRow | undefined;

    return row === undefined ? null : toScheduledTask(row);
  }

  public create(input: CreateScheduledTask): ScheduledTask {
    const id = randomUUID();
    const now = new Date().toISOString();

    const create = this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO tasks (
             id, title, scheduled_date, scheduled_time, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'todo', ?, ?)`,
        )
        .run(
          id,
          input.title,
          input.scheduledDate,
          input.scheduledTime,
          now,
          now,
        );

      this.writeAudit("task.create", id, "success", now);
    });

    create();
    return this.find(id) as ScheduledTask;
  }

  public updateStatus(
    id: string,
    status: TaskStatus,
  ): ScheduledTask | null {
    const now = new Date().toISOString();

    const update = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE tasks
           SET status = ?, updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(status, now, id);

      if (result.changes === 0) {
        return false;
      }

      this.writeAudit("task.status-update", id, "success", now);
      return true;
    });

    return update() ? this.find(id) : null;
  }

  public softDelete(id: string): boolean {
    const now = new Date().toISOString();

    const remove = this.database.transaction(() => {
      const result = this.database
        .prepare(
          `UPDATE tasks
           SET deleted_at = ?, deleted_by = 'user', updated_at = ?
           WHERE id = ? AND deleted_at IS NULL`,
        )
        .run(now, now, id);

      if (result.changes === 0) {
        return false;
      }

      this.writeAudit("task.soft-delete", id, "success", now);
      return true;
    });

    return remove();
  }

  private writeAudit(
    action: string,
    targetId: string,
    outcome: string,
    createdAt: string,
  ): void {
    const { actor, mode } = this.auditContext;
    this.database
      .prepare(
        `INSERT INTO audit_events (
           id, actor, mode, action, target_type, target_id, outcome, created_at
         ) VALUES (?, ?, ?, ?, 'task', ?, ?, ?)`,
      )
      .run(randomUUID(), actor, mode, action, targetId, outcome, createdAt);
  }
}
