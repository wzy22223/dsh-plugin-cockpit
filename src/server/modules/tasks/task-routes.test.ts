import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../cockpit-app.js";
import { openDatabase, type CockpitDatabase } from "../../platform/database.js";
import { createTestWorkspace, type TestWorkspace } from "../../test-utils.js";
import { TaskRepository } from "./task-repository.js";

const localHeaders = {
  host: "127.0.0.1:7778",
};

const mutationHeaders = {
  ...localHeaders,
  "content-type": "application/json",
  "x-cockpit-request": "1",
};

describe("local task API", () => {
  let workspace: TestWorkspace;
  let database: CockpitDatabase;
  let app: FastifyInstance;

  beforeEach(async () => {
    workspace = createTestWorkspace();
    database = openDatabase(
      workspace.config.databasePath,
      path.join(workspace.config.projectRoot, "migrations"),
    );
    app = await buildApp({ config: workspace.config, database });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    database.close();
    workspace.cleanup();
  });

  it("applies the task migration with soft-delete columns", () => {
    const migration = database
      .prepare("SELECT name FROM schema_migrations WHERE version = 3")
      .get() as { name: string } | undefined;
    const columns = database
      .prepare("PRAGMA table_info(tasks)")
      .all() as { name: string }[];

    expect(migration?.name).toBe("003_tasks.sql");
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "id",
        "title",
        "scheduled_date",
        "scheduled_time",
        "status",
        "created_at",
        "updated_at",
        "deleted_at",
        "deleted_by",
      ]),
    );
  });

  it("creates a todo and lists only the requested date in time order", async () => {
    const late = await createTask({
      title: "下午复盘",
      scheduledDate: "2026-07-30",
      scheduledTime: "15:30",
    });
    const early = await createTask({
      title: "晨会",
      scheduledDate: "2026-07-30",
      scheduledTime: "09:00",
    });
    await createTask({
      title: "明日事项",
      scheduledDate: "2026-07-31",
      scheduledTime: "08:00",
    });

    expect(late.statusCode).toBe(201);
    expect(late.json()).toMatchObject({
      title: "下午复盘",
      scheduledDate: "2026-07-30",
      scheduledTime: "15:30",
      status: "todo",
    });
    expect(early.statusCode).toBe(201);

    const response = await app.inject({
      method: "GET",
      url: "/api/tasks?date=2026-07-30",
      headers: localHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(
      (response.json().items as { title: string }[]).map((task) => task.title),
    ).toEqual(["晨会", "下午复盘"]);
  });

  it("lists an inclusive date range by status in date and time order", async () => {
    await createTask({
      title: "范围之前",
      scheduledDate: "2026-07-29",
      scheduledTime: "18:00",
    });
    const completed = await createTask({
      title: "已完成晨会",
      scheduledDate: "2026-07-30",
      scheduledTime: "09:00",
    });
    await updateTaskStatus(completed.json().id as string, "completed");
    await createTask({
      title: "当日复盘",
      scheduledDate: "2026-07-30",
      scheduledTime: "15:30",
    });
    await createTask({
      title: "次日订单",
      scheduledDate: "2026-07-31",
      scheduledTime: "08:00",
    });
    await createTask({
      title: "范围之后",
      scheduledDate: "2026-08-01",
      scheduledTime: "07:00",
    });

    const todoResponse = await app.inject({
      method: "GET",
      url: "/api/tasks?from=2026-07-30&to=2026-07-31&status=todo",
      headers: localHeaders,
    });
    const allResponse = await app.inject({
      method: "GET",
      url: "/api/tasks?from=2026-07-30&to=2026-07-31&status=all",
      headers: localHeaders,
    });

    expect(todoResponse.statusCode).toBe(200);
    expect(
      (
        todoResponse.json().items as {
          title: string;
          scheduledDate: string;
          scheduledTime: string;
          status: string;
        }[]
      ).map((task) => [
        task.title,
        task.scheduledDate,
        task.scheduledTime,
        task.status,
      ]),
    ).toEqual([
      ["当日复盘", "2026-07-30", "15:30", "todo"],
      ["次日订单", "2026-07-31", "08:00", "todo"],
    ]);
    expect(
      (allResponse.json().items as { title: string }[]).map(
        (task) => task.title,
      ),
    ).toEqual(["已完成晨会", "当日复盘", "次日订单"]);
  });

  it("supports open future and completed-list filters", async () => {
    const pastCompleted = await createTask({
      title: "历史已完成",
      scheduledDate: "2026-07-29",
      scheduledTime: "17:00",
    });
    await updateTaskStatus(pastCompleted.json().id as string, "completed");
    await createTask({
      title: "今日待办",
      scheduledDate: "2026-07-30",
      scheduledTime: "12:00",
    });
    await createTask({
      title: "未来待办",
      scheduledDate: "2026-07-31",
      scheduledTime: "09:00",
    });
    const futureCompleted = await createTask({
      title: "未来已完成",
      scheduledDate: "2026-08-02",
      scheduledTime: "10:00",
    });
    await updateTaskStatus(futureCompleted.json().id as string, "completed");

    const future = await app.inject({
      method: "GET",
      url: "/api/tasks?from=2026-07-31&status=todo",
      headers: localHeaders,
    });
    const completed = await app.inject({
      method: "GET",
      url: "/api/tasks?status=completed",
      headers: localHeaders,
    });

    expect(
      (future.json().items as { title: string }[]).map((task) => task.title),
    ).toEqual(["未来待办"]);
    expect(
      (completed.json().items as { title: string }[]).map(
        (task) => task.title,
      ),
    ).toEqual(["历史已完成", "未来已完成"]);
  });

  it("marks an active task completed and writes audit events", async () => {
    const created = await createTask({
      title: "核对订单",
      scheduledDate: "2026-07-30",
      scheduledTime: "10:15",
    });
    const taskId = created.json().id as string;

    const response = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}/status`,
      headers: mutationHeaders,
      payload: {
        status: "completed",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: taskId,
      status: "completed",
    });

    const auditActions = database
      .prepare(
        `SELECT action
         FROM audit_events
         WHERE target_type = 'task' AND target_id = ?
         ORDER BY created_at ASC`,
      )
      .all(taskId) as { action: string }[];
    expect(auditActions.map((event) => event.action)).toEqual([
      "task.create",
      "task.status-update",
    ]);
  });

  it("keeps soft-deleted tasks out of lists and status updates", async () => {
    const created = await createTask({
      title: "临时安排",
      scheduledDate: "2026-07-30",
      scheduledTime: "11:00",
    });
    const taskId = created.json().id as string;
    const repository = new TaskRepository(database);

    expect(repository.softDelete(taskId)).toBe(true);
    expect(repository.softDelete(taskId)).toBe(false);

    const list = await app.inject({
      method: "GET",
      url: "/api/tasks?date=2026-07-30",
      headers: localHeaders,
    });
    const update = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}/status`,
      headers: mutationHeaders,
      payload: {
        status: "completed",
      },
    });

    expect(list.json().items).toEqual([]);
    expect(update.statusCode).toBe(404);

    const deleted = database
      .prepare("SELECT deleted_at, deleted_by FROM tasks WHERE id = ?")
      .get(taskId) as { deleted_at: string | null; deleted_by: string | null };
    expect(deleted.deleted_at).not.toBeNull();
    expect(deleted.deleted_by).toBe("user");
  });

  it.each([
    {
      name: "blank title",
      payload: {
        title: "   ",
        scheduledDate: "2026-07-30",
        scheduledTime: "09:00",
      },
    },
    {
      name: "impossible date",
      payload: {
        title: "无效日期",
        scheduledDate: "2026-02-30",
        scheduledTime: "09:00",
      },
    },
    {
      name: "invalid time",
      payload: {
        title: "无效时间",
        scheduledDate: "2026-07-30",
        scheduledTime: "24:00",
      },
    },
  ])("rejects create input with $name", async ({ payload }) => {
    const response = await createTask(payload);

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_TASK");
  });

  it.each(["", "2026-2-03", "2026-02-30", "not-a-date"])(
    "rejects an invalid list date: %s",
    async (date) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/tasks?date=${encodeURIComponent(date)}`,
        headers: localHeaders,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_TASK_DATE");
    },
  );

  it.each([
    "from=not-a-date",
    "to=2026-02-30",
    "from=2026-08-01&to=2026-07-31",
    "date=2026-07-30&from=2026-07-30",
    "status=cancelled",
    "unknown=value",
  ])("rejects an invalid list query: %s", async (query) => {
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks?${query}`,
      headers: localHeaders,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_TASK_QUERY");
  });

  it("rejects invalid statuses and returns 404 for missing tasks", async () => {
    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/tasks/not-created/status",
      headers: mutationHeaders,
      payload: {
        status: "cancelled",
      },
    });
    const missing = await app.inject({
      method: "PATCH",
      url: "/api/tasks/not-created/status",
      headers: mutationHeaders,
      payload: {
        status: "completed",
      },
    });

    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("INVALID_TASK_STATUS");
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("TASK_NOT_FOUND");
  });

  function createTask(payload: {
    title: string;
    scheduledDate: string;
    scheduledTime: string;
  }) {
    return app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: mutationHeaders,
      payload,
    });
  }

  function updateTaskStatus(taskId: string, status: "todo" | "completed") {
    return app.inject({
      method: "PATCH",
      url: `/api/tasks/${taskId}/status`,
      headers: mutationHeaders,
      payload: {
        status,
      },
    });
  }
});
