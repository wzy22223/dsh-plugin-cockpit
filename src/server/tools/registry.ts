/**
 * 统一工具注册中心
 *
 * Agent 模块（agent/index.ts）和 MCP Server（mcp/index.ts）都从同一个 registry
 * 读取工具定义，新增工具只需在此注册，彻底消除双份定义的维护噩梦。
 *
 * 使用方式：
 *   import { toolRegistry } from "../tools/registry.js";
 *   const tools = toolRegistry.getAll();         // MCP ToolDef[]
 *   const names = toolRegistry.getModuleNames(); // string[]
 *   const tools = toolRegistry.getByModule("warehouse");
 */

import type { ResourceKind } from "../../shared/contracts/resources.js";
import { navigationAccents } from "../../shared/contracts/navigation.js";

/** 工具定义的规范类型 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** 模块名（用于分组管理） */
export type ModuleName = "navigation" | "tasks" | "resources" | "warehouse" | "scripts" | "memory" | "skills" | "vault" | "web" | "mcp";

/** 工具条目（含模块归属） */
export interface ToolEntry {
  module: ModuleName;
  def: ToolDef;
}

class ToolRegistry {
  private tools = new Map<string, ToolEntry>();
  /** 动态注册的工具名（MCP 插件等运行期注册，可被卸载） */
  private dynamicNames = new Set<string>();

  register(module: ModuleName, def: ToolDef): void {
    if (this.tools.has(def.name)) {
      throw new Error(`工具 "${def.name}" 已被注册，不能重复`);
    }
    this.tools.set(def.name, { module, def });
  }

  /**
   * 运行期动态注册（MCP 插件/技能声明式工具）。与静态注册同源进入 getAll，可被 unregister 卸载。
   * 与静态工具同名（含与其他动态工具重名）时抛错，避免歧义。
   */
  registerDynamic(def: ToolDef, module: ModuleName = "mcp"): void {
    if (this.tools.has(def.name)) {
      throw new Error(`工具 "${def.name}" 已被注册，不能重复`);
    }
    this.tools.set(def.name, { module, def });
    this.dynamicNames.add(def.name);
  }

  /** 卸载动态工具（MCP server 断开时清理）；静态工具不受影响 */
  unregisterDynamic(name: string): boolean {
    if (!this.dynamicNames.has(name)) return false;
    this.tools.delete(name);
    this.dynamicNames.delete(name);
    return true;
  }

  isDynamic(name: string): boolean {
    return this.dynamicNames.has(name);
  }

  /** 获取所有工具定义（按注册顺序，含动态工具） */
  getAll(): ToolDef[] {
    return Array.from(this.tools.values()).map((e) => e.def);
  }

  /** 按模块获取工具定义 */
  getByModule(module: ModuleName): ToolDef[] {
    return Array.from(this.tools.values())
      .filter((e) => e.module === module)
      .map((e) => e.def);
  }

  /** 获取已在 registry 注册的模块名列表 */
  getModuleNames(): ModuleName[] {
    const set = new Set<ModuleName>();
    for (const entry of this.tools.values()) {
      set.add(entry.module);
    }
    return Array.from(set);
  }

  /** 获取工具总数 */
  get count(): number {
    return this.tools.size;
  }
}

/** 全局唯一注册中心 */
export const toolRegistry = new ToolRegistry();

// ═══════════════════════════════════════════════════════════════
//  注册所有工具（加新工具在这里加）
// ═══════════════════════════════════════════════════════════════

// ── Navigation (4) ─────────────────────────────────────────────

toolRegistry.register("navigation", {
  name: "cockpit_nav_list",
  description: "列出工作台所有工作入口（导航项）",
  inputSchema: { type: "object", properties: {} },
});

toolRegistry.register("navigation", {
  name: "cockpit_nav_add",
  description: "添加一个新的工作入口，支持 http/https 网址和本机 file: 路径",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "入口显示名称，1-80 字符" },
      url: { type: "string", description: "完整 URL 或本机路径" },
      category: { type: "string", description: "分类名称，默认「工作系统」" },
      description: { type: "string", description: "简短描述，最多 200 字符" },
      accent: { type: "string", enum: [...navigationAccents], description: "强调色，默认 blue" },
    },
    required: ["name", "url"],
  },
});

toolRegistry.register("navigation", {
  name: "cockpit_nav_remove",
  description: "软删除一个工作入口",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "入口 ID" } },
    required: ["id"],
  },
});

toolRegistry.register("navigation", {
  name: "cockpit_nav_open",
  description: "用系统默认方式打开一个工作入口",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "入口 ID" } },
    required: ["id"],
  },
});

// ── Tasks (4) ──────────────────────────────────────────────────

toolRegistry.register("tasks", {
  name: "cockpit_task_list",
  description: "列出日程/待办，可按日期、状态筛选",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: "指定日期 YYYY-MM-DD" },
      from: { type: "string", description: "起始日期" },
      to: { type: "string", description: "结束日期" },
      status: { type: "string", enum: ["todo", "completed", "all"], description: "筛选状态" },
    },
  },
});

toolRegistry.register("tasks", {
  name: "cockpit_task_create",
  description: "创建一个新的日程待办",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "日程标题" },
      scheduledDate: { type: "string", description: "计划日期 YYYY-MM-DD" },
      scheduledTime: { type: "string", description: "计划时间 HH:mm" },
    },
    required: ["title", "scheduledDate", "scheduledTime"],
  },
});

toolRegistry.register("tasks", {
  name: "cockpit_task_complete",
  description: "将一个待办标记为已完成",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "任务 ID" } },
    required: ["id"],
  },
});

toolRegistry.register("tasks", {
  name: "cockpit_task_delete",
  description: "软删除一个日程待办",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "任务 ID" } },
    required: ["id"],
  },
});

// ── Resources (5) ──────────────────────────────────────────────

toolRegistry.register("resources", {
  name: "cockpit_resource_list",
  description: "列出或搜索资料（文件、网址、笔记）",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      kind: { type: "string", enum: ["file", "link", "note"] as ResourceKind[], description: "资料类型" },
      trash: { type: "boolean", description: "是否查看回收站" },
    },
  },
});

toolRegistry.register("resources", {
  name: "cockpit_resource_add_url",
  description: "保存一个网址到资料中心",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "资料标题" },
      url: { type: "string", description: "完整 URL" },
      tags: { type: "array", items: { type: "string" }, description: "标签列表" },
    },
    required: ["title", "url"],
  },
});

toolRegistry.register("resources", {
  name: "cockpit_resource_add_note",
  description: "保存一条笔记到资料中心",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "笔记标题" },
      content: { type: "string", description: "笔记正文" },
      tags: { type: "array", items: { type: "string" }, description: "标签列表" },
    },
    required: ["title", "content"],
  },
});

toolRegistry.register("resources", {
  name: "cockpit_resource_add_file",
  description: "上传本地文件到资料中心",
  inputSchema: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "本地文件的绝对路径" },
      title: { type: "string", description: "资料标题" },
      tags: { type: "array", items: { type: "string" }, description: "标签列表" },
    },
    required: ["filePath"],
  },
});

toolRegistry.register("resources", {
  name: "cockpit_resource_delete",
  description: "软删除一个资料",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "资料 ID" } },
    required: ["id"],
  },
});

// ── Warehouse (6) — V0.9 新增 ─────────────────────────────────

toolRegistry.register("warehouse", {
  name: "cockpit_warehouse_summary",
  description:
    "获取仓库经营核心指标总览。包含：发货量、退货量、库存总量、库存健康度、活跃款式数、缺货/滞销SKU数等 KPI 数据，以及需关注事项列表。适合作为每日经营快报入口。",
  inputSchema: {
    type: "object",
    properties: {
      date: { type: "string", description: "查询日期 YYYY-MM-DD，不传则用最新数据" },
    },
  },
});

toolRegistry.register("warehouse", {
  name: "cockpit_warehouse_shipping",
  description:
    "查询发货数据。包含昨日发货汇总（实发件数、销量、订单数、活跃款式）和按款式/平台/地域的明细。可按款式筛选。",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["summary", "by_style", "by_platform", "by_region"], description: "查询模式：summary=汇总 / by_style=按款式 / by_platform=按平台 / by_region=按地域" },
      style: { type: "string", description: "款式名（mode=by_style 时筛选，不传返回全部）" },
    },
  },
});

toolRegistry.register("warehouse", {
  name: "cockpit_warehouse_returns",
  description:
    "查询退货数据。包含退货量、退货率、仅退款量、售后单数，以及退货原因分布和按款式明细。",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["summary", "by_reason", "by_style"], description: "查询模式" },
    },
  },
});

toolRegistry.register("warehouse", {
  name: "cockpit_warehouse_inventory",
  description:
    "查询库存分析数据。包含库存总量、缺货预警、低库存警告、滞销清单（分 180/90/60/30 天四级）、超卖清单、快需补货清单。可按预警类型筛选。",
  inputSchema: {
    type: "object",
    properties: {
      alert_type: { type: "string", enum: ["缺货", "低库存", "滞销", "超卖", "快需补货", "all"], description: "预警类型，默认 all" },
      limit: { type: "number", description: "返回条数上限，默认 20" },
    },
  },
});

toolRegistry.register("warehouse", {
  name: "cockpit_warehouse_exclude_list",
  description: "查看清仓不补排除清单。这些 SKU 不参与滞销分析和补货建议。",
  inputSchema: {
    type: "object",
    properties: {},
  },
});

toolRegistry.register("warehouse", {
  name: "cockpit_warehouse_exclude_manage",
  description:
    "管理清仓不补清单：添加或移除 SKU。添加/移除均会写入审计日志。",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "remove"], description: "add=添加 / remove=移除" },
      sku: { type: "string", description: "款号（SKU），如 AC-J072-DD-黑色S" },
    },
    required: ["action", "sku"],
  },
});

// ── Vault 知识库 (1) — 2026-08-12：检索 Obsidian vault 笔记（只读） ──

toolRegistry.register("vault", {
  name: "cockpit_vault_search",
  description:
    "在知识库（Obsidian vault 笔记）中全文检索，返回匹配的笔记标题、摘要与链接数。适合用户问「知识库/笔记里关于 X 的内容」「查一下 wiki 里怎么写的」等场景。检索结果如需正文可再调用 cockpit_resource_list 之外的知识库接口（前端展示）。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "检索关键词（支持中文，2 字以上效果更好）" },
      limit: { type: "number", description: "返回条数上限，默认 8" },
    },
    required: ["query"],
  },
});

// ── Scripts (3) — B1 新增：触发用户已有本地脚本（异步执行，结果推送通知） ──

import { z } from "zod";
import { SCRIPT_ACTIONS } from "../scripts/registry.js";

for (const action of SCRIPT_ACTIONS) {
  // 将 zod schema 转为 JSON Schema（zod 4 内置）
  const jsonSchema = z.toJSONSchema(action.argsSchema) as {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  const inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  } = {
    type: "object",
    properties: jsonSchema.properties,
  };
  if (jsonSchema.required && jsonSchema.required.length > 0) {
    inputSchema.required = jsonSchema.required;
  }
  toolRegistry.register("scripts", {
    name: `cockpit_run_${action.id}`,
    description: `异步触发本地脚本「${action.label}」。脚本在后台运行，结果通过工作台通知推送，不阻塞对话。当前仅支持预注册动作。`,
    inputSchema,
  });
}
