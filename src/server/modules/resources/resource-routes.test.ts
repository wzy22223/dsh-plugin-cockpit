import {
  existsSync,
  readdirSync,
} from "node:fs";
import path from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type CockpitDatabase } from "../../platform/database.js";
import { ResourceStorage } from "../../platform/resource-storage.js";
import { registerLocalRequestGuard } from "../../security/local-request.js";
import { createTestWorkspace, type TestWorkspace } from "../../test-utils.js";
import { ResourceRepository } from "./resource-repository.js";
import { registerResourceRoutes } from "./resource-routes.js";
import { ResourceService } from "./resource-service.js";

const localHeaders = {
  host: "127.0.0.1:7778",
};

const jsonHeaders = {
  ...localHeaders,
  "content-type": "application/json",
  "x-cockpit-request": "1",
};

interface MultipartFixture {
  boundary: string;
  payload: Buffer;
}

function multipartFixture({
  filename,
  mimeType,
  contents,
  title,
  tags,
  fileFirst = false,
}: {
  filename: string;
  mimeType: string;
  contents: Buffer;
  title?: string;
  tags?: string;
  fileFirst?: boolean;
}): MultipartFixture {
  const boundary = `cockpit-test-${Date.now()}-${Math.random()}`;
  const fieldParts: Buffer[] = [];

  if (title !== undefined) {
    fieldParts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`,
      ),
    );
  }
  if (tags !== undefined) {
    fieldParts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${tags}\r\n`,
      ),
    );
  }

  const filePart = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    ),
    contents,
    Buffer.from("\r\n"),
  ]);
  const orderedParts = fileFirst
    ? [filePart, ...fieldParts]
    : [...fieldParts, filePart];

  return {
    boundary,
    payload: Buffer.concat([
      ...orderedParts,
      Buffer.from(`--${boundary}--\r\n`),
    ]),
  };
}

describe("local resource API", () => {
  let workspace: TestWorkspace;
  let database: CockpitDatabase;
  let app: FastifyInstance;

  beforeEach(async () => {
    workspace = createTestWorkspace();
    database = openDatabase(
      workspace.config.databasePath,
      path.join(workspace.config.projectRoot, "migrations"),
    );
    app = Fastify();
    registerLocalRequestGuard(app);
    registerResourceRoutes(
      app,
      new ResourceService(
        new ResourceRepository(database),
        new ResourceStorage(workspace.config.dataRoot, 1024),
      ),
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    database.close();
    workspace.cleanup();
  });

  it("applies metadata and tag tables through migration 004", () => {
    const migration = database
      .prepare("SELECT name FROM schema_migrations WHERE version = 4")
      .get() as { name: string } | undefined;
    const resourceColumns = database
      .prepare("PRAGMA table_info(resources)")
      .all() as { name: string }[];

    expect(migration?.name).toBe("004_resources.sql");
    expect(resourceColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "kind",
        "title",
        "storage_path",
        "original_filename",
        "deleted_at",
      ]),
    );
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'resource_tags'",
        )
        .get(),
    ).toBeDefined();
  });

  it("creates notes and links, then searches titles and tags", async () => {
    const note = await createJsonResource({
      kind: "note",
      title: "备货说明",
      content: "仅保存在资料正文中的敏感测试句",
      tags: ["生产", "Q3", "生产"],
    });
    const link = await createJsonResource({
      kind: "link",
      title: "供应商门户",
      url: "https://example.com/supplier#orders",
      tags: ["采购"],
    });

    expect(note.statusCode).toBe(201);
    expect(note.json()).toMatchObject({
      kind: "note",
      title: "备货说明",
      tags: ["生产", "Q3"],
      url: null,
    });
    expect(link.statusCode).toBe(201);

    const byTag = await app.inject({
      method: "GET",
      url: `/api/resources?query=${encodeURIComponent("生产")}`,
      headers: localHeaders,
    });
    const links = await app.inject({
      method: "GET",
      url: "/api/resources?kind=link&trash=false",
      headers: localHeaders,
    });

    expect(byTag.statusCode).toBe(200);
    expect(byTag.json().items.map((item: { title: string }) => item.title)).toEqual(
      ["备货说明"],
    );
    expect(links.json().items).toHaveLength(1);
    expect(links.json().items[0].url).toBe(
      "https://example.com/supplier#orders",
    );

    const auditRows = database
      .prepare(
        `SELECT action, target_type, target_id, outcome
         FROM audit_events
         WHERE target_type = 'resource'`,
      )
      .all();
    expect(JSON.stringify(auditRows)).not.toContain("敏感测试句");
  });

  it("rejects unsafe links and malformed list filters", async () => {
    const unsafe = await createJsonResource({
      kind: "link",
      title: "本机文件",
      url: "file:///C:/secret.txt",
      tags: [],
    });
    const invalidKind = await app.inject({
      method: "GET",
      url: "/api/resources?kind=all",
      headers: localHeaders,
    });

    expect(unsafe.statusCode).toBe(400);
    expect(unsafe.json().error.code).toBe("INVALID_RESOURCE");
    expect(invalidKind.statusCode).toBe(400);
    expect(invalidKind.json().error.code).toBe("INVALID_RESOURCE_QUERY");
  });

  it("soft deletes, lists trash and restores a resource", async () => {
    const created = await createJsonResource({
      kind: "note",
      title: "临时笔记",
      content: "稍后恢复",
      tags: [],
    });
    const id = created.json().id as string;

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/resources/${id}`,
      headers: jsonHeaders,
      payload: {},
    });
    const active = await app.inject({
      method: "GET",
      url: "/api/resources",
      headers: localHeaders,
    });
    const trash = await app.inject({
      method: "GET",
      url: "/api/resources?trash=true",
      headers: localHeaders,
    });

    expect(removed.statusCode).toBe(204);
    expect(active.json().items).toEqual([]);
    expect(trash.json().items).toHaveLength(1);
    expect(trash.json().items[0].deletedAt).not.toBeNull();

    const restored = await app.inject({
      method: "POST",
      url: `/api/resources/${id}/restore`,
      headers: jsonHeaders,
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().deletedAt).toBeNull();
  });

  it("streams a file into local storage and serves it through the controlled route", async () => {
    const contents = Buffer.from("%PDF-1.7\nfixture contents");
    const upload = multipartFixture({
      filename: "purchase-order.pdf",
      mimeType: "application/pdf",
      contents,
      tags: JSON.stringify(["采购", "待核对"]),
      fileFirst: true,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/resources/upload",
      headers: {
        ...localHeaders,
        "content-type": `multipart/form-data; boundary=${upload.boundary}`,
        "x-cockpit-request": "1",
      },
      payload: upload.payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      kind: "file",
      title: "purchase-order",
      tags: ["采购", "待核对"],
      originalFilename: "purchase-order.pdf",
      mimeType: "application/pdf",
      sizeBytes: contents.byteLength,
    });

    const id = response.json().id as string;
    const stored = database
      .prepare("SELECT storage_path FROM resources WHERE id = ?")
      .get(id) as { storage_path: string };
    expect(path.isAbsolute(stored.storage_path)).toBe(false);
    expect(stored.storage_path).toMatch(/^resources\/.+\.pdf$/u);
    expect(
      existsSync(
        path.join(
          workspace.config.dataRoot,
          ...stored.storage_path.split("/"),
        ),
      ),
    ).toBe(true);

    const download = await app.inject({
      method: "GET",
      url: `/api/resources/${id}/file`,
      headers: localHeaders,
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(contents);
    expect(download.headers["content-type"]).toBe("application/pdf");
    expect(download.headers["content-disposition"]).toContain(
      "purchase-order.pdf",
    );

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/resources/${id}`,
      headers: jsonHeaders,
      payload: {},
    });
    const unavailable = await app.inject({
      method: "GET",
      url: `/api/resources/${id}/file`,
      headers: localHeaders,
    });
    const restored = await app.inject({
      method: "POST",
      url: `/api/resources/${id}/restore`,
      headers: jsonHeaders,
      payload: {},
    });
    const availableAgain = await app.inject({
      method: "GET",
      url: `/api/resources/${id}/file`,
      headers: localHeaders,
    });

    expect(removed.statusCode).toBe(204);
    expect(unavailable.statusCode).toBe(404);
    expect(restored.statusCode).toBe(200);
    expect(availableAgain.rawPayload).toEqual(contents);

    database
      .prepare("UPDATE resources SET storage_path = '../secret.pdf' WHERE id = ?")
      .run(id);
    const traversal = await app.inject({
      method: "GET",
      url: `/api/resources/${id}/file`,
      headers: localHeaders,
    });
    expect(traversal.statusCode).toBe(404);
  });

  it("rejects unsupported, disguised and oversized uploads without leftovers", async () => {
    const cases = [
      multipartFixture({
        filename: "payload.exe",
        mimeType: "application/octet-stream",
        contents: Buffer.from("MZ executable"),
      }),
      multipartFixture({
        filename: "disguised.pdf",
        mimeType: "application/pdf",
        contents: Buffer.from("not a pdf"),
      }),
    ];

    for (const upload of cases) {
      const response = await uploadFile(upload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_RESOURCE_UPLOAD");
    }

    const oversized = multipartFixture({
      filename: "oversized.pdf",
      mimeType: "application/pdf",
      contents: Buffer.concat([
        Buffer.from("%PDF-1.7\n"),
        Buffer.alloc(2048, 1),
      ]),
    });
    const tooLarge = await uploadFile(oversized);
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error.code).toBe("RESOURCE_FILE_TOO_LARGE");

    const resourcesRoot = path.join(workspace.config.dataRoot, "resources");
    expect(
      readdirSync(resourcesRoot).filter((entry) => entry !== ".tmp"),
    ).toEqual([]);
    expect(readdirSync(path.join(resourcesRoot, ".tmp"))).toEqual([]);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM resources")
        .get(),
    ).toEqual({ count: 0 });
  });

  it("allows multipart only on the upload route with local request headers", async () => {
    const upload = multipartFixture({
      filename: "brief.pdf",
      mimeType: "application/pdf",
      contents: Buffer.from("%PDF-1.7\nbrief"),
    });
    const contentType = `multipart/form-data; boundary=${upload.boundary}`;

    const missingMarker = await app.inject({
      method: "POST",
      url: "/api/resources/upload",
      headers: {
        ...localHeaders,
        "content-type": contentType,
      },
      payload: upload.payload,
    });
    const remoteOrigin = await app.inject({
      method: "POST",
      url: "/api/resources/upload",
      headers: {
        ...localHeaders,
        "content-type": contentType,
        "x-cockpit-request": "1",
        origin: "https://attacker.example",
      },
      payload: upload.payload,
    });
    const multipartJsonRoute = await app.inject({
      method: "POST",
      url: "/api/resources",
      headers: {
        ...localHeaders,
        "content-type": contentType,
        "x-cockpit-request": "1",
      },
      payload: upload.payload,
    });

    expect(missingMarker.statusCode).toBe(403);
    expect(remoteOrigin.statusCode).toBe(403);
    expect(multipartJsonRoute.statusCode).toBe(415);
    expect(multipartJsonRoute.json().error.code).toBe("JSON_REQUIRED");
  });

  function createJsonResource(payload: object) {
    return app.inject({
      method: "POST",
      url: "/api/resources",
      headers: jsonHeaders,
      payload,
    });
  }

  function uploadFile(upload: MultipartFixture) {
    return app.inject({
      method: "POST",
      url: "/api/resources/upload",
      headers: {
        ...localHeaders,
        "content-type": `multipart/form-data; boundary=${upload.boundary}`,
        "x-cockpit-request": "1",
      },
      payload: upload.payload,
    });
  }
});
