import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { excludeStore } from "./exclude-store.js";

/**
 * 隔离测试：用临时 dataRoot 注入 COCKPIT_ 路径不安全（exclude-store 走 loadConfig.dataRoot），
 * 因此直接用临时目录覆盖 userdata/warehouse 不可行。改为：在临时目录构造旧路径并验证单例行为。
 * 简化策略：直接对单例调用 add/remove，断言结果码与幂等性，不依赖具体落盘路径。
 */
describe("exclude-store add/remove", () => {
  const dirty: string[] = [];

  afterEach(() => {
    // 清理刚加的 SKU，保持单例状态干净
    for (const sku of dirty.splice(0)) {
      excludeStore.remove(sku);
    }
  });

  it("空 SKU 拒绝", () => {
    const r = excludeStore.add("   ");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_SKU");
  });

  it("添加成功并可查重", () => {
    const sku = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const r1 = excludeStore.add(sku);
    expect(r1.ok).toBe(true);
    dirty.push(sku);
    const r2 = excludeStore.add(sku);
    expect(r2.ok).toBe(false);
    expect(r2.code).toBe("SKU_EXISTS");
  });

  it("移除不存在的 SKU 报错", () => {
    const r = excludeStore.remove("NONEXIST-SKU-XYZ");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("SKU_NOT_FOUND");
  });

  it("添加后移除成功", () => {
    const sku = `TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    expect(excludeStore.add(sku).ok).toBe(true);
    dirty.push(sku);
    const rm = excludeStore.remove(sku);
    expect(rm.ok).toBe(true);
    // 移除后不应留在 dirty，避免 afterEach 重复删
    const idx = dirty.indexOf(sku);
    if (idx >= 0) dirty.splice(idx, 1);
  });
});
