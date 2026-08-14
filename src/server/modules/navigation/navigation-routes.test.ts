import path from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type CockpitDatabase } from "../../platform/database.js";
import { registerLocalRequestGuard } from "../../security/local-request.js";
import { createTestWorkspace, type TestWorkspace } from "../../test-utils.js";
import { fileUrlToOsPath } from "./navigation-launcher.js";
import { NavigationRepository } from "./navigation-repository.js";
import { registerNavigationRoutes } from "./navigation-routes.js";

const localHeaders = {
  host: "127.0.0.1:7778",
};

const jsonHeaders = {
  ...localHeaders,
  "content-type": "application/json",
  "x-cockpit-request": "1",
};

describe("fileUrlToOsPath", () => {
  it("win32 盘符路径", () => {
    expect(fileUrlToOsPath("file:///C:/Users/demo", "win32")).toBe(
      "C:\\Users\\demo",
    );
  });

  it("win32 路径含空格与中文", () => {
    expect(
      fileUrlToOsPath("file:///D:/my%20folder/%E5%B7%A5%E5%85%B7", "win32"),
    ).toBe("D:\\my folder\\工具");
  });

  it("win32 UNC 路径", () => {
    expect(fileUrlToOsPath("file://nas/share/dir", "win32")).toBe(
      "\\\\nas\\share\\dir",
    );
  });

  it("win32 拒绝无盘符路径", () => {
    expect(fileUrlToOsPath("file:///etc/passwd", "win32")).toBeNull();
  });

  it("linux 路径", () => {
    expect(fileUrlToOsPath("file:///home/demo/tools", "linux")).toBe(
      "/home/demo/tools",
    );
  });

  it("非 file: 输入返回 null", () => {
    expect(fileUrlToOsPath("https://example.com", "win32")).toBeNull();
    expect(fileUrlToOsPath("not a url", "win32")).toBeNull();
  });
});

describe("navigation API", () => {
  let workspace: TestWorkspace;
  let database: CockpitDatabase;
  let app: FastifyInstance;
  let openedTargets: string[];

  beforeEach(async () => {
    workspace = createTestWorkspace();
    database = openDatabase(
      workspace.config.databasePath,
      path.join(workspace.config.projectRoot, "migrations"),
    );
    openedTargets = [];
    app = Fastify();
    registerLocalRequestGuard(app);
    registerNavigationRoutes(app, new NavigationRepository(database), (target) => {
      openedTargets.push(target);
      return Promise.resolve();
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    database.close();
    workspace.cleanup();
  });

  it("创建并列出 http 入口", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: jsonHeaders,
      payload: {
        name: "聚水潭",
        url: "https://www.erp321.com/epaas",
        description: "",
      },
    });
    expect(created.statusCode).toBe(201);

    const listed = await app.inject({
      method: "GET",
      url: "/api/navigation",
      headers: localHeaders,
    });
    const body = listed.json() as { items: { name: string }[] };
    expect(body.items.some((item) => item.name === "聚水潭")).toBe(true);
  });

  it("接受 file: 本地路径入口", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: jsonHeaders,
      payload: {
        name: "本机工具目录",
        url: "file:///C:/Users/demo/tools",
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { url: string };
    expect(body.url).toBe("file:///C:/Users/demo/tools");
  });

  it("拒绝不支持的协议与无盘符 file 路径", async () => {
    const ftp = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: jsonHeaders,
      payload: { name: "ftp", url: "ftp://example.com/file" },
    });
    expect(ftp.statusCode).toBe(400);

    const badFile = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: jsonHeaders,
      payload: { name: "bad", url: "file:///etc/passwd" },
    });
    // win32：无盘符的 file 路径拒绝（400）；linux：/etc/passwd 是合法本机路径（201）
    expect(badFile.statusCode).toBe(process.platform === "win32" ? 400 : 201);
  });

  it("open 端点用系统方式打开本机路径并写审计", async () => {
    const repository = new NavigationRepository(database);
    const entry = repository.create({
      name: "本机目录",
      url: "file:///C:/Users/demo/tools",
      description: "",
      category: "工作系统",
      accent: "violet",
      position: 100,
    });

    const opened = await app.inject({
      method: "POST",
      url: `/api/navigation/${entry.id}/open`,
      headers: jsonHeaders,
      payload: {},
    });
    expect(opened.statusCode).toBe(204);
    // 打开目标 = 当前平台的解析结果（win32: C:\Users\demo\tools；linux: /C:/Users/demo/tools）
    expect(openedTargets).toEqual([fileUrlToOsPath("file:///C:/Users/demo/tools", process.platform)]);

    const auditRows = database
      .prepare(
        `SELECT action, outcome FROM audit_events
         WHERE target_id = ? AND action = 'navigation.open'`,
      )
      .all(entry.id) as { action: string; outcome: string }[];
    expect(auditRows).toEqual([
      { action: "navigation.open", outcome: "success" },
    ]);
  });

  it("open 端点拒绝网页入口与缺失入口", async () => {
    const repository = new NavigationRepository(database);
    const webEntry = repository.create({
      name: "网页",
      url: "https://example.com",
      description: "",
      category: "工作系统",
      accent: "blue",
      position: 100,
    });

    const webOpen = await app.inject({
      method: "POST",
      url: `/api/navigation/${webEntry.id}/open`,
      headers: jsonHeaders,
      payload: {},
    });
    expect(webOpen.statusCode).toBe(400);
    expect(openedTargets).toEqual([]);

    const missing = await app.inject({
      method: "POST",
      url: "/api/navigation/nav-not-exist/open",
      headers: jsonHeaders,
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
  });

  it("删除与恢复入口", async () => {
    const repository = new NavigationRepository(database);
    const entry = repository.create({
      name: "待删除",
      url: "https://example.com",
      description: "",
      category: "工作系统",
      accent: "blue",
      position: 100,
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/navigation/${entry.id}`,
      headers: jsonHeaders,
      payload: {},
    });
    expect(deleted.statusCode).toBe(204);

    const restored = await app.inject({
      method: "POST",
      url: `/api/navigation/${entry.id}/restore`,
      headers: jsonHeaders,
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
  });
});

describe("navigation API in Pgy mode", () => {
  let workspace: TestWorkspace;
  let database: CockpitDatabase;
  let app: FastifyInstance;
  let openedTargets: string[];

  const pgyHeaders = {
    host: "172.16.2.243:7777",
    origin: "http://172.16.2.243:7777",
    "content-type": "application/json",
    "x-cockpit-request": "1",
  };

  beforeEach(async () => {
    workspace = createTestWorkspace();
    database = openDatabase(
      workspace.config.databasePath,
      path.join(workspace.config.projectRoot, "migrations"),
    );
    openedTargets = [];
    app = Fastify();
    registerLocalRequestGuard(app, {
      allowedHostnames: ["172.16.2.243"],
      port: 7777,
    });
    registerNavigationRoutes(
      app,
      new NavigationRepository(database),
      (target) => {
        openedTargets.push(target);
        return Promise.resolve();
      },
      { allowLocalTargets: false },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    database.close();
    workspace.cleanup();
  });

  it("hides local paths and blocks creating or opening them", async () => {
    const repository = new NavigationRepository(database);
    const localEntry = repository.create({
      name: "本机目录",
      url: "file:///C:/Users/demo/tools",
      description: "",
      category: "工作系统",
      accent: "violet",
      position: 100,
    });
    repository.create({
      name: "网页",
      url: "https://example.com",
      description: "",
      category: "工作系统",
      accent: "blue",
      position: 101,
    });

    const listed = await app.inject({
      method: "GET",
      url: "/api/navigation",
      headers: { host: "172.16.2.243:7777" },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: pgyHeaders,
      payload: { name: "远程本机路径", url: "file:///C:/Windows" },
    });
    const opened = await app.inject({
      method: "POST",
      url: `/api/navigation/${localEntry.id}/open`,
      headers: pgyHeaders,
      payload: {},
    });

    const body = listed.json() as { items: { url: string }[] };
    expect(body.items.every((item) => !item.url.startsWith("file:"))).toBe(true);
    expect(body.items.some((item) => item.url === "https://example.com")).toBe(true);
    expect(created.statusCode).toBe(403);
    expect(opened.statusCode).toBe(403);
    expect(openedTargets).toEqual([]);
  });
});
