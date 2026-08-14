import fastifyMultipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { Readable } from "node:stream";

import { ResourceFileTooLargeError } from "../../platform/resource-storage.js";
import {
  createResourceSchema,
  listResourcesQuerySchema,
  uploadResourceFieldsSchema,
} from "./resource-schema.js";
import {
  InvalidResourceFileError,
  type PendingResourceFile,
  type ResourceService,
} from "./resource-service.js";

class InvalidUploadError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidUploadError";
  }
}

function validationMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "提交内容不符合要求。";
}

function parseUploadTags(rawValue: string | undefined): unknown[] {
  if (rawValue === undefined || rawValue.trim() === "") {
    return [];
  }

  const trimmed = rawValue.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new InvalidUploadError("标签格式不正确。");
      }
      return parsed;
    } catch (error) {
      if (error instanceof InvalidUploadError) {
        throw error;
      }
      throw new InvalidUploadError("标签格式不正确。");
    }
  }

  return trimmed
    .split(/[,，\r\n]/u)
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function defaultFileTitle(filename: string): string {
  const extensionStart = filename.lastIndexOf(".");
  const withoutExtension =
    extensionStart > 0 ? filename.slice(0, extensionStart) : filename;
  const candidate = withoutExtension.trim() || filename;
  return Array.from(candidate).slice(0, 120).join("");
}

async function drain(stream: Readable): Promise<void> {
  if (stream.destroyed || stream.readableEnded) {
    return;
  }

  try {
    for await (const _chunk of stream) {
      // Consume rejected file parts so multipart parsing can finish safely.
    }
  } catch {
    // The original validation error is more useful than a secondary drain error.
  }
}

function contentDisposition(filename: string): string {
  const fallback =
    filename
      .replace(/[^\u0020-\u007e]/gu, "_")
      .replace(/["\\]/gu, "_")
      .trim() || "download";
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/gu,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function registerResourceRoutes(
  app: FastifyInstance,
  service: ResourceService,
): void {
  app.register(async (resourceApp) => {
    await resourceApp.register(fastifyMultipart, {
      throwFileSizeLimit: true,
      limits: {
        fieldNameSize: 32,
        fieldSize: 8 * 1024,
        fields: 2,
        fileSize: service.maxFileBytes,
        files: 1,
        headerPairs: 100,
        parts: 3,
      },
    });

    resourceApp.get<{
      Querystring: {
        query?: string;
        kind?: string;
        trash?: string;
      };
    }>("/api/resources", async (request, reply) => {
      const result = listResourcesQuerySchema.safeParse(request.query);
      if (!result.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_RESOURCE_QUERY",
            message: validationMessage(result.error),
          },
        });
      }

      return {
        items: service.list({
          query: result.data.query,
          kind: result.data.kind,
          trash: result.data.trash,
        }),
      };
    });

    resourceApp.post("/api/resources", async (request, reply) => {
      const result = createResourceSchema.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({
          error: {
            code: "INVALID_RESOURCE",
            message: validationMessage(result.error),
          },
        });
      }

      return reply.code(201).send(service.create(result.data));
    });

    resourceApp.post("/api/resources/upload", async (request, reply) => {
      let pendingFile: PendingResourceFile | null = null;
      const fields = new Map<string, string>();

      try {
        if (!request.isMultipart()) {
          throw new InvalidUploadError("请选择需要导入的文件。");
        }

        for await (const part of request.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "file") {
              await drain(part.file);
              throw new InvalidUploadError("文件字段必须命名为 file。");
            }
            if (pendingFile !== null) {
              await drain(part.file);
              throw new InvalidUploadError("每次只能上传一个文件。");
            }

            try {
              pendingFile = await service.stageFile(
                part.file,
                part.filename,
                part.mimetype,
              );
            } catch (error) {
              await drain(part.file);
              throw error;
            }

            if (part.file.truncated) {
              throw new ResourceFileTooLargeError(service.maxFileBytes);
            }
            continue;
          }

          if (!["title", "tags"].includes(part.fieldname)) {
            throw new InvalidUploadError(`不支持字段：${part.fieldname}`);
          }
          if (fields.has(part.fieldname)) {
            throw new InvalidUploadError(`字段不能重复：${part.fieldname}`);
          }
          if (part.valueTruncated || typeof part.value !== "string") {
            throw new InvalidUploadError(`字段内容无效：${part.fieldname}`);
          }
          fields.set(part.fieldname, part.value);
        }

        if (pendingFile === null) {
          throw new InvalidUploadError("请选择需要导入的文件。");
        }

        const fieldResult = uploadResourceFieldsSchema.safeParse({
          title:
            fields.get("title") ??
            defaultFileTitle(pendingFile.originalFilename),
          tags: parseUploadTags(fields.get("tags")),
        });
        if (!fieldResult.success) {
          throw new InvalidUploadError(validationMessage(fieldResult.error));
        }

        const created = await service.createFile(
          pendingFile,
          fieldResult.data,
        );
        pendingFile = null;
        return reply.code(201).send(created);
      } catch (error) {
        if (pendingFile !== null) {
          await service.discardFile(pendingFile);
        }

        if (
          error instanceof ResourceFileTooLargeError ||
          error instanceof resourceApp.multipartErrors.RequestFileTooLargeError
        ) {
          return reply.code(413).send({
            error: {
              code: "RESOURCE_FILE_TOO_LARGE",
              message: "单个文件不能超过 25 MB。",
            },
          });
        }

        if (
          error instanceof resourceApp.multipartErrors.FilesLimitError ||
          error instanceof resourceApp.multipartErrors.FieldsLimitError ||
          error instanceof resourceApp.multipartErrors.PartsLimitError
        ) {
          return reply.code(400).send({
            error: {
              code: "INVALID_RESOURCE_UPLOAD",
              message: "每次仅支持一个文件、一个标题和一组标签。",
            },
          });
        }

        if (
          error instanceof InvalidUploadError ||
          error instanceof InvalidResourceFileError
        ) {
          return reply.code(400).send({
            error: {
              code: "INVALID_RESOURCE_UPLOAD",
              message: error.message,
            },
          });
        }

        throw error;
      }
    });

    resourceApp.delete<{ Params: { id: string } }>(
      "/api/resources/:id",
      async (request, reply) => {
        if (!service.softDelete(request.params.id)) {
          return reply.code(404).send({
            error: {
              code: "RESOURCE_NOT_FOUND",
              message: "没有找到这条资料。",
            },
          });
        }

        return reply.code(204).send();
      },
    );

    resourceApp.post<{ Params: { id: string } }>(
      "/api/resources/:id/restore",
      async (request, reply) => {
        const restored = service.restore(request.params.id);
        if (restored === null) {
          return reply.code(404).send({
            error: {
              code: "RESOURCE_NOT_FOUND",
              message: "没有找到可恢复的资料。",
            },
          });
        }

        return restored;
      },
    );

    resourceApp.get<{ Params: { id: string } }>(
      "/api/resources/:id/file",
      async (request, reply) => {
        const download = await service.download(request.params.id);
        if (
          download === null ||
          download.item.originalFilename === null ||
          download.item.mimeType === null
        ) {
          return reply.code(404).send({
            error: {
              code: "RESOURCE_FILE_NOT_FOUND",
              message: "没有找到可下载的资料文件。",
            },
          });
        }

        return reply
          .header("cache-control", "private, no-store")
          .header(
            "content-disposition",
            contentDisposition(download.item.originalFilename),
          )
          .header("content-length", String(download.sizeBytes))
          .type(download.item.mimeType)
          .send(download.stream);
      },
    );
  });
}
