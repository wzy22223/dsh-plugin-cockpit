import type { FastifyInstance } from "fastify";

import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskStatusSchema,
} from "./task-schema.js";
import type { TaskService } from "./task-service.js";

function validationMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "提交内容不符合要求。";
}

export function registerTaskRoutes(
  app: FastifyInstance,
  service: TaskService,
): void {
  app.get<{
    Querystring: {
      date?: string;
      from?: string;
      to?: string;
      status?: string;
    };
  }>(
    "/api/tasks",
    async (request, reply) => {
      const result = listTasksQuerySchema.safeParse(request.query);
      if (!result.success) {
        const isExactDateCompatibilityQuery =
          request.query.date !== undefined &&
          request.query.from === undefined &&
          request.query.to === undefined &&
          request.query.status === undefined &&
          Object.keys(request.query).length === 1;
        const errorCode =
          isExactDateCompatibilityQuery
            ? "INVALID_TASK_DATE"
            : "INVALID_TASK_QUERY";

        return reply.code(400).send({
          error: {
            code: errorCode,
            message: validationMessage(result.error),
          },
        });
      }

      return {
        items: service.list(result.data),
      };
    },
  );

  app.post("/api/tasks", async (request, reply) => {
    const result = createTaskSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_TASK",
          message: validationMessage(result.error),
        },
      });
    }

    return reply.code(201).send(service.create(result.data));
  });

  app.patch<{ Params: { id: string } }>(
    "/api/tasks/:id/status",
    async (request, reply) => {
      const result = updateTaskStatusSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_TASK_STATUS",
            message: validationMessage(result.error),
          },
        });
      }

      const task = service.updateStatus(request.params.id, result.data.status);
      if (task === null) {
        return reply.code(404).send({
          error: {
            code: "TASK_NOT_FOUND",
            message: "没有找到这个日程。",
          },
        });
      }

      return task;
    },
  );
}
