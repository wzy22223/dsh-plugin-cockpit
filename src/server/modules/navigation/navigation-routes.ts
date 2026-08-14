import type { FastifyInstance, FastifyReply } from "fastify";

import type { CreateNavigationItem } from "../../../shared/contracts/navigation.js";
import {
  createSystemLauncher,
  fileUrlToOsPath,
  type OpenLauncher,
} from "./navigation-launcher.js";
import { createNavigationSchema, updateNavigationSchema } from "./navigation-schema.js";
import { NavigationRepository } from "./navigation-repository.js";

function validationMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "提交内容不符合要求。";
}

export interface NavigationRouteOptions {
  allowLocalTargets?: boolean;
}

function isLocalTarget(url: string): boolean {
  return url.startsWith("file:");
}

function localTargetForbidden(reply: FastifyReply) {
  return reply.code(403).send({
    error: {
      code: "LOCAL_TARGET_DISABLED",
      message: "蒲公英访问模式不允许查看、修改或打开本机路径入口。",
    },
  });
}

export function registerNavigationRoutes(
  app: FastifyInstance,
  repository: NavigationRepository,
  launcher: OpenLauncher = createSystemLauncher(),
  options: NavigationRouteOptions = {},
): void {
  const allowLocalTargets = options.allowLocalTargets ?? true;

  app.get("/api/navigation", async () => ({
    items: repository
      .list()
      .filter((item) => allowLocalTargets || !isLocalTarget(item.url)),
  }));

  app.post("/api/navigation", async (request, reply) => {
    const result = createNavigationSchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({
        error: {
          code: "INVALID_NAVIGATION",
          message: validationMessage(result.error),
        },
      });
    }

    if (!allowLocalTargets && isLocalTarget(result.data.url)) {
      return localTargetForbidden(reply);
    }

    return reply.code(201).send(repository.create(result.data));
  });

  app.patch<{ Params: { id: string } }>(
    "/api/navigation/:id",
    async (request, reply) => {
      const existing = repository.find(request.params.id);
      if (existing === null) {
        return reply.code(404).send({
          error: {
            code: "NAVIGATION_NOT_FOUND",
            message: "没有找到这个入口。",
          },
        });
      }

      if (!allowLocalTargets && isLocalTarget(existing.url)) {
        return localTargetForbidden(reply);
      }

      const result = updateNavigationSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_NAVIGATION",
            message: validationMessage(result.error),
          },
        });
      }

      const merged: Required<CreateNavigationItem> = {
        name: result.data.name ?? existing.name,
        url: result.data.url ?? existing.url,
        description: result.data.description ?? existing.description,
        category: result.data.category ?? existing.category,
        accent: result.data.accent ?? existing.accent,
        position: result.data.position ?? existing.position,
      };

      if (!allowLocalTargets && isLocalTarget(merged.url)) {
        return localTargetForbidden(reply);
      }

      return repository.update(request.params.id, merged);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/navigation/:id",
    async (request, reply) => {
      if (!allowLocalTargets) {
        const existing = repository.find(request.params.id);
        if (existing !== null && isLocalTarget(existing.url)) {
          return localTargetForbidden(reply);
        }
      }

      if (!repository.softDelete(request.params.id)) {
        return reply.code(404).send({
          error: {
            code: "NAVIGATION_NOT_FOUND",
            message: "没有找到这个入口。",
          },
        });
      }

      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/navigation/:id/restore",
    async (request, reply) => {
      const restored = repository.restore(request.params.id);
      if (restored === null) {
        return reply.code(404).send({
          error: {
            code: "NAVIGATION_NOT_FOUND",
            message: "没有找到可恢复的入口。",
          },
        });
      }

      return restored;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/navigation/:id/open",
    async (request, reply) => {
      if (!allowLocalTargets) {
        return localTargetForbidden(reply);
      }

      const existing = repository.find(request.params.id);
      if (existing === null) {
        return reply.code(404).send({
          error: {
            code: "NAVIGATION_NOT_FOUND",
            message: "没有找到这个入口。",
          },
        });
      }

      const osPath = fileUrlToOsPath(existing.url);
      if (osPath === null) {
        return reply.code(400).send({
          error: {
            code: "NAVIGATION_NOT_LOCAL",
            message: "只有本机路径入口需要通过服务器打开。",
          },
        });
      }

      try {
        await launcher(osPath);
      } catch {
        repository.recordOpen(existing.id, "failure");
        return reply.code(502).send({
          error: {
            code: "NAVIGATION_OPEN_FAILED",
            message: "本机打开失败，请确认路径仍然存在。",
          },
        });
      }

      repository.recordOpen(existing.id, "success");
      return reply.code(204).send();
    },
  );
}
