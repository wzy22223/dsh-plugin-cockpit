import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openDatabase, type CockpitDatabase } from "../../platform/database.js";
import { registerLocalRequestGuard } from "../../security/local-request.js";
import { createTestWorkspace, type TestWorkspace } from "../../test-utils.js";
import { VaultRepository } from "./vault-repository.js";
import { registerVaultRoutes } from "./vault-routes.js";
import { VaultService } from "./vault-service.js";

const localHeaders = {
  host: "127.0.0.1:7778",
};

const jsonHeaders = {
  ...localHeaders,
  "content-type": "application/json",
  "x-cockpit-request": "1",
};

function writeNote(vaultDir: string, relPath: string, raw: string): void {
  const abs = path.join(vaultDir, relPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, raw, "utf8");
}

describe("vault 模块", () => {
  let workspace: TestWorkspace;
  let database: CockpitDatabase;
  let app: FastifyInstance;
  let vaultDir: string;
  let repository: VaultRepository;
  let service: VaultService;

  beforeEach(() => {
    workspace = createTestWorkspace();
    vaultDir = path.join(workspace.root, "vault");
    mkdirSync(vaultDir, { recursive: true });
    database = openDatabase(workspace.config.databasePath, path.resolve("migrations"));

    writeNote(
      vaultDir,
      "wiki/entities/dewu.md",
      "---\ntype: entity\n---\n# 得物\n\n得物开放平台，公私钥签名认证。\n\n参见 [[taobao]] 和 [[jushuitan-erp|聚水潭]]。",
    );
    writeNote(
      vaultDir,
      "wiki/entities/taobao.md",
      "# 淘宝\n\n淘宝开放平台，全链路 API 支持。\n\n参考 [[dewu]]。",
    );
    writeNote(
      vaultDir,
      "wiki/concepts/openapi.md",
      "# 开放平台 API\n\n各电商平台通过开放接口对接。\n\n- [[dewu]]\n- [[taobao]]\n- 悬空链接 [[not-exist-note]]",
    );
    writeNote(vaultDir, "draft.md", "# 草稿\n\n这是一篇还没整理完的草稿。");

    repository = new VaultRepository(database);
    service = new VaultService(vaultDir, repository);
    service.scan();

    app = Fastify({ logger: false });
    registerLocalRequestGuard(app, {
      allowedHostnames: ["127.0.0.1"],
      port: 7778,
    });
    registerVaultRoutes(app, service, repository, "loopback");
  });

  afterEach(() => {
    database.close();
    workspace.cleanup();
  });

  it("扫描后列出全部笔记（含 stats）", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/vault/notes",
      headers: localHeaders,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { total: number; items: Array<{ path: string }> };
    expect(body.total).toBe(4);
    expect(body.items.length).toBe(4);
    const paths = body.items.map((item) => item.path);
    expect(paths).toContain("wiki/entities/dewu.md");
    expect(paths).toContain("draft.md");

    const page = await app.inject({
      method: "GET",
      url: "/api/vault/notes?limit=2&offset=3",
      headers: localHeaders,
    });
    const pageBody = page.json() as { total: number; items: Array<{ path: string }> };
    expect(pageBody.total).toBe(4);
    expect(pageBody.items).toHaveLength(1);

    const stats = await app.inject({
      method: "GET",
      url: "/api/vault/stats",
      headers: localHeaders,
    });
    expect((stats.json() as { readOnly: boolean }).readOnly).toBe(false);
  });

  it("搜索分页返回不受 limit 影响的准确 total", async () => {
    writeNote(vaultDir, "search/one.md", "# One\n\nexact-pagination-marker");
    writeNote(vaultDir, "search/two.md", "# Two\n\nexact-pagination-marker");
    writeNote(vaultDir, "search/three.md", "# Three\n\nexact-pagination-marker");
    service.scan();

    const response = await app.inject({
      method: "GET",
      url: "/api/vault/notes?query=exact-pagination-marker&limit=1&offset=1",
      headers: localHeaders,
    });
    const body = response.json() as { total: number; items: Array<{ path: string }> };
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(1);
  });

  it("检索：正文命中可见，标题命中优先排序", async () => {
    const contentHit = await app.inject({
      method: "GET",
      url: "/api/vault/notes?query=得物",
      headers: localHeaders,
    });
    const contentBody = contentHit.json() as { items: Array<{ path: string }> };
    const contentPaths = contentBody.items.map((item) => item.path);
    expect(contentPaths).toContain("wiki/entities/dewu.md");

    const titleHit = await app.inject({
      method: "GET",
      url: "/api/vault/notes?query=taobao",
      headers: localHeaders,
    });
    const titleBody = titleHit.json() as { items: Array<{ path: string }> };
    expect(titleBody.items[0]?.path).toBe("wiki/entities/taobao.md");
  });

  it("短查询（2 字）也能命中正文（trigram 兜底）", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/vault/notes?query=开放",
      headers: localHeaders,
    });
    const body = response.json() as { items: Array<{ path: string }> };
    const paths = body.items.map((item) => item.path);
    expect(paths).toContain("wiki/concepts/openapi.md");
  });

  it("单篇详情：出链解析、反链、悬空链接", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/vault/note?path=wiki/entities/dewu.md",
      headers: localHeaders,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      title: string;
      wikilinks: Array<{ target: string; resolvedPath: string | null }>;
      backlinks: Array<{ source: string }>;
      isDangling: string[];
      raw: string;
    };
    expect(body.title).toBe("dewu");
    expect(body.wikilinks.map((link) => link.target)).toEqual(
      expect.arrayContaining(["taobao", "jushuitan-erp"]),
    );
    expect(body.wikilinks.find((link) => link.target === "taobao")?.resolvedPath).toBe(
      "wiki/entities/taobao.md",
    );
    expect(body.wikilinks.find((link) => link.target === "jushuitan-erp")?.resolvedPath).toBeNull();
    const backlinkSources = body.backlinks.map((link) => link.source);
    expect(backlinkSources).toContain("wiki/entities/taobao.md");
    expect(backlinkSources).toContain("wiki/concepts/openapi.md");
    expect(body.isDangling).toEqual(["jushuitan-erp"]);
    expect(body.raw).toContain("# 得物");
  });

  it("路径型、相对与带 .md 的 wikilink 可解析，重名 basename 不猜测", async () => {
    writeNote(vaultDir, "a/shared.md", "# A");
    writeNote(vaultDir, "b/shared.md", "# B");
    writeNote(
      vaultDir,
      "refs/source.md",
      "# Source\n\n[[shared]]\n[[a/shared]]\n[[../b/shared.md]]",
    );
    service.scan();

    const response = await app.inject({
      method: "GET",
      url: "/api/vault/note?path=refs%2Fsource.md",
      headers: localHeaders,
    });
    const body = response.json() as {
      wikilinks: Array<{ target: string; resolvedPath: string | null }>;
      isDangling: string[];
    };
    expect(body.wikilinks.find((link) => link.target === "shared")?.resolvedPath).toBeNull();
    expect(body.wikilinks.find((link) => link.target === "a/shared")?.resolvedPath).toBe(
      "a/shared.md",
    );
    expect(body.wikilinks.find((link) => link.target === "../b/shared.md")?.resolvedPath).toBe(
      "b/shared.md",
    );
    expect(body.isDangling).toContain("shared");
  });

  it("目标笔记删除后保留源链接为悬空，重建目标后可再解析", async () => {
    writeNote(vaultDir, "links/source.md", "# Source\n\n[[target]]");
    writeNote(vaultDir, "links/target.md", "# Target");
    service.scan();

    unlinkSync(path.join(vaultDir, "links", "target.md"));
    service.scan();

    const danglingResponse = await app.inject({
      method: "GET",
      url: "/api/vault/note?path=links%2Fsource.md",
      headers: localHeaders,
    });
    const dangling = danglingResponse.json() as {
      wikilinks: Array<{ target: string; resolvedPath: string | null }>;
      isDangling: string[];
    };
    expect(dangling.wikilinks[0]?.resolvedPath).toBeNull();
    expect(dangling.isDangling).toContain("target");

    writeNote(vaultDir, "links/target.md", "# Target restored");
    service.scan();
    const restoredResponse = await app.inject({
      method: "GET",
      url: "/api/vault/note?path=links%2Fsource.md",
      headers: localHeaders,
    });
    const restored = restoredResponse.json() as {
      wikilinks: Array<{ resolvedPath: string | null }>;
    };
    expect(restored.wikilinks[0]?.resolvedPath).toBe("links/target.md");
  });

  it("图谱：节点/边统计正确，悬空链接不计边", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/vault/graph",
      headers: localHeaders,
    });
    const body = response.json() as {
      nodes: Array<{ path: string; degree: number }>;
      links: Array<{ source: string; target: string }>;
      stats: { noteCount: number; linkCount: number; danglingLinkCount: number };
    };
    expect(body.stats.noteCount).toBe(4);
    // dewu↔taobao（无向去重 1 条）+ openapi→dewu + openapi→taobao = 3 条边
    expect(body.stats.linkCount).toBe(3);
    expect(body.stats.danglingLinkCount).toBe(2); // openapi→not-exist-note + dewu→jushuitan-erp
    // degree 按最终无向去重边计算，不包含悬空链接或双向重复边。
    expect(body.nodes.find((node) => node.path === "wiki/entities/dewu.md")?.degree).toBe(2);
    expect(body.nodes.find((node) => node.path === "wiki/entities/taobao.md")?.degree).toBe(2);
  });

  it("无文件变化的扫描不重建 FTS", () => {
    const rebuildFts = vi.spyOn(repository, "rebuildFts");
    expect(service.scan()).toEqual({ added: 0, updated: 0, removed: 0 });
    expect(rebuildFts).not.toHaveBeenCalled();
  });

  it("编辑保存：写回文件并更新索引（原子写）", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/vault/note",
      headers: jsonHeaders,
      payload: { path: "draft.md", content: "# 草稿已整理\n\n参考 [[dewu]]。" },
    });
    expect(response.statusCode).toBe(200);

    const detail = await app.inject({
      method: "GET",
      url: "/api/vault/note?path=draft.md",
      headers: localHeaders,
    });
    const body = detail.json() as { content: string; backlinks: Array<{ source: string }> };
    expect(body.content).toContain("草稿已整理");
    expect(body.backlinks.length).toBe(0); // dewu 的反链来自其他笔记
    const dewu = await app.inject({
      method: "GET",
      url: "/api/vault/note?path=wiki/entities/dewu.md",
      headers: localHeaders,
    });
    const dewuBody = dewu.json() as { backlinks: Array<{ source: string }> };
    expect(dewuBody.backlinks.map((link) => link.source)).toContain("draft.md");
  });

  it("pgy 模式拒绝写笔记", async () => {
    const appPgy = Fastify({ logger: false });
    registerLocalRequestGuard(appPgy, {
      allowedHostnames: ["127.0.0.1"],
      port: 7778,
    });
    const repository = new VaultRepository(database);
    const service = new VaultService(vaultDir, repository);
    registerVaultRoutes(appPgy, service, repository, "pgy");

    const response = await appPgy.inject({
      method: "PUT",
      url: "/api/vault/note",
      headers: jsonHeaders,
      payload: { path: "draft.md", content: "x" },
    });
    expect(response.statusCode).toBe(403);

    const stats = await appPgy.inject({
      method: "GET",
      url: "/api/vault/stats",
      headers: localHeaders,
    });
    expect((stats.json() as { readOnly: boolean }).readOnly).toBe(true);
    await appPgy.close();
  });
});
