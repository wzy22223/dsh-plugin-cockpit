import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  applyMarks,
  computeDeltas,
  computeEtag,
  readWarehouseData,
  readWarehouseSummary,
  recordHistorySnapshot,
} from "./warehouse-data.js";

function makeTmpDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wh-data-test-"));
  return dir;
}

function writeDataJson(dir: string, obj: unknown): void {
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify(obj), "utf-8");
}

describe("warehouse-data computeEtag", () => {
  it("对相同内容产生稳定 etag（同输入多次调用一致）", () => {
    const input = { x: 1, y: [1, 2] };
    const a = computeEtag(input);
    const b = computeEtag(input);
    expect(a).toBe(b);
    expect(a).toMatch(/^"[0-9a-f]{16}"$/u);
  });

  it("不同内容 etag 不同", () => {
    expect(computeEtag({ x: 1 })).not.toBe(computeEtag({ x: 2 }));
  });
});

describe("warehouse-data applyMarks", () => {
  it("将标记的 SKU 排到末尾并保持未标记顺序", () => {
    const items = [
      { sku: "A", n: 1 },
      { sku: "B", n: 2 },
      { sku: "C", n: 3 },
    ];
    applyMarks(items, [
      { sku: "B", mark: "快需补货" },
      { sku: "C", mark: "超卖" },
    ]);
    expect(items.map((i) => i.sku)).toEqual(["A", "B", "C"]);
    expect(items[1]!["标记"]).toBe("快需补货");
    expect(items[2]!["标记"]).toBe("超卖");
  });

  it("无标记时原序不变", () => {
    const items = [{ sku: "A" }, { sku: "B" }];
    applyMarks(items, []);
    expect(items.map((i) => i.sku)).toEqual(["A", "B"]);
  });
});

describe("warehouse-data readWarehouseData / summary", () => {
  const dir = makeTmpDataDir();
  const sample = {
    data_date: "2026-08-06",
    generated_at: "2026-08-06T10:00:00Z",
    modules: {
      shipment: { summary: { 发货: 100 } },
      inventory: { summary: { 库存: 50 }, alerts: {} },
      returns: { summary: { 退货: 5 } },
    },
  };
  writeDataJson(dir, sample);

  beforeAll(() => {
    process.env.COCKPIT_WAREHOUSE_DATA_PATH = path.join(dir, "data.json");
  });
  afterAll(() => {
    delete process.env.COCKPIT_WAREHOUSE_DATA_PATH;
  });

  it("读取数据并打 _dev_fixture=false（真实路径不标 fixture）", () => {
    const d = readWarehouseData();
    expect(d).not.toBeNull();
    expect(d!.data_date).toBe("2026-08-06");
    expect(d!._dev_fixture).toBeUndefined();
  });

  it("摘要仅含 summary 字段且裁剪全量", () => {
    const s = readWarehouseSummary();
    expect(s).not.toBeNull();
    expect(s!.shipment).toEqual({ summary: { 发货: 100 } });
    expect(s!.inventory).toEqual({ summary: { 库存: 50 } });
    expect((s as Record<string, unknown>)["modules"]).toBeUndefined();
  });
});

describe("warehouse-data 环比历史快照（recordHistorySnapshot / computeDeltas）", () => {
  const dir = makeTmpDataDir();

  const day1 = {
    data_date: "2026-08-05",
    generated_at: "2026-08-05T10:00:00Z",
    modules: {
      shipment: { summary: { 发货: 80, 订单: 40 } },
      inventory: { summary: { 库存: 500 }, alerts: {} },
      returns: { summary: { 退货: 5 } },
    },
  };
  const day2 = {
    data_date: "2026-08-06",
    generated_at: "2026-08-06T10:00:00Z",
    modules: {
      shipment: { summary: { 发货: 100, 订单: 50 } },
      inventory: { summary: { 库存: 460 }, alerts: {} },
      returns: { summary: { 退货: 8 } },
    },
  };

  beforeAll(() => {
    process.env.COCKPIT_WAREHOUSE_DATA_PATH = path.join(dir, "data.json");
    writeDataJson(dir, day1);
    readWarehouseData(); // 触发 day1 快照
    writeDataJson(dir, day2);
    readWarehouseData(); // 触发 day2 快照
  });
  afterAll(() => {
    delete process.env.COCKPIT_WAREHOUSE_DATA_PATH;
  });

  it("两天数据后能算出环比 delta 与 pct", () => {
    const summary = readWarehouseSummary();
    expect(summary).not.toBeNull();
    const deltas = computeDeltas(summary!);
    expect(deltas).not.toBeNull();
    expect(deltas!["shipment:发货"]).toEqual({ delta: 20, pct: 25 });
    expect(deltas!["inventory:库存"]).toEqual({ delta: -40, pct: -8 });
    expect(deltas!["returns:退货"]).toEqual({ delta: 3, pct: 60 });
  });

  it("上一值为 0 时 pct 为 null 且 delta 仍给出", () => {
    const dir2 = makeTmpDataDir();
    process.env.COCKPIT_WAREHOUSE_DATA_PATH = path.join(dir2, "data.json");
    try {
      writeDataJson(dir2, { ...day1, modules: { shipment: { summary: { 发货: 0 } } } });
      readWarehouseData();
      writeDataJson(dir2, { ...day2, modules: { shipment: { summary: { 发货: 10 } } } });
      readWarehouseData();
      const summary = readWarehouseSummary();
      const deltas = computeDeltas(summary!);
      expect(deltas!["shipment:发货"]).toEqual({ delta: 10, pct: null });
    } finally {
      delete process.env.COCKPIT_WAREHOUSE_DATA_PATH;
    }
  });

  it("同日刷新（generated_at 变化）覆盖当日快照而非新增", () => {
    const dir3 = makeTmpDataDir();
    process.env.COCKPIT_WAREHOUSE_DATA_PATH = path.join(dir3, "data.json");
    try {
      writeDataJson(dir3, day1);
      readWarehouseData();
      writeDataJson(dir3, { ...day1, generated_at: "2026-08-05T18:00:00Z", modules: { shipment: { summary: { 发货: 90 } } } });
      readWarehouseData();
      writeDataJson(dir3, day2);
      readWarehouseData();
      const summary = readWarehouseSummary();
      const deltas = computeDeltas(summary!);
      // 当日快照被覆盖为 90，与 day2 对比：发货 100 - 90 = 10，pct = 10/90*100 ≈ 11.1
      expect(deltas!["shipment:发货"]).toEqual({ delta: 10, pct: 11.1 });
    } finally {
      delete process.env.COCKPIT_WAREHOUSE_DATA_PATH;
    }
  });

  it("历史不足两天时返回 null", () => {
    const dir4 = makeTmpDataDir();
    process.env.COCKPIT_WAREHOUSE_DATA_PATH = path.join(dir4, "data.json");
    try {
      writeDataJson(dir4, day1);
      readWarehouseData();
      const summary = readWarehouseSummary();
      expect(computeDeltas(summary!)).toBeNull();
    } finally {
      delete process.env.COCKPIT_WAREHOUSE_DATA_PATH;
    }
  });

  it("recordHistorySnapshot 对无日期数据静默跳过", () => {
    expect(() => recordHistorySnapshot({ modules: {} })).not.toThrow();
  });
});
