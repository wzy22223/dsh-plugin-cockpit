/**
 * 统一工具执行器（P0-1）
 *
 * Agent（agent/index.ts 的 createToolExecutor）与 MCP（mcp/index.ts 的 handleToolCall）
 * 原先各写一份 ~300 行 switch，已出现行为不一致（笔记裁剪、nav_open 文案）。
 * 这里抽出唯一执行器，registry 既管定义也管实现。
 *
 * 行为基准：以 Agent 版为准（资源列表不裁剪笔记正文、nav_open 返回不含 url 的短文案）。
 * 如需裁剪（MCP 防云模型外发），由调用方在执行器外层包一层 trimResourceList，
 * 保持执行器单一职责。
 */
import { createReadStream } from "node:fs";
import { stat as statAsync } from "node:fs/promises";
import path from "node:path";

import type { CockpitDatabase } from "../platform/database.js";
import { NavigationRepository } from "../modules/navigation/navigation-repository.js";
import { TaskRepository } from "../modules/tasks/task-repository.js";
import { ResourceRepository } from "../modules/resources/resource-repository.js";
import { ResourceService } from "../modules/resources/resource-service.js";
import { ResourceStorage } from "../platform/resource-storage.js";
import { createSystemLauncher } from "../modules/navigation/navigation-launcher.js";
import { checkPathSafe } from "./tool-helpers.js";
import type { AppConfig } from "../platform/config.js";
import type { CreateNavigationItem } from "../../shared/contracts/navigation.js";
import type { ResourceKind } from "../../shared/contracts/resources.js";
import { readWarehouseData } from "../modules/warehouse/warehouse-data.js";
import { excludeStore } from "../modules/warehouse/exclude-store.js";
import { scriptRunner, ScriptCapabilityError } from "../scripts/runner.js";
import { getScriptAction } from "../scripts/registry.js";
import { VaultRepository } from "../modules/vault/vault-repository.js";
import { VaultService } from "../modules/vault/vault-service.js";

/** 工具结果截断上限（对齐原 agent/context-builder 的 DEFAULT_TOOL_RESULT_MAX_CHARS） */
export const DEFAULT_TOOL_RESULT_MAX_CHARS = 12_000;

/** 保留首尾并显式标注，避免静默裁剪造成错误理解（自 agent/context-builder 迁移） */
export function truncateContextText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 0) return "";
  const omitted = text.length - maxChars;
  const marker = `\n…[${label}已截断，省略约 ${omitted} 字符]…\n`;
  if (marker.length >= maxChars) return text.slice(0, maxChars);
  const available = maxChars - marker.length;
  const head = Math.ceil(available * 0.65);
  return text.slice(0, head) + marker + text.slice(text.length - (available - head));
}

export interface ExecutorDeps {
  database: CockpitDatabase;
  /** 运行配置（dataRoot / vaultDir / scriptsDir 等，由插件入口解析） */
  config: AppConfig;
  /** P2-1：操作来源，写入审计 actor 字段（agent / mcp） */
  actor?: string;
}

/**
 * 统一工具执行器签名（DSH 插件版）
 * agent 模块移除后不再有 per-agent 记忆与技能，第三个参数保留以兼容调用方。
 */
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  agentName?: string | null,
) => Promise<string>;

/**
 * 工具已被正确调用，但业务动作本身没有成功完成。
 *
 * 失败必须走 rejected Promise，调用方才能把 action 标成 failed；不能再用
 * 普通字符串伪装成一次成功的工具结果。
 */
export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

function getWarehouseData(): ReturnType<typeof readWarehouseData> {
  // readWarehouseData 内部已有 mtime 缓存
  return readWarehouseData();
}

/**
 * 创建统一工具执行器（DSH 插件版）
 * 仅保留业务工具：navigation / tasks / resources / warehouse / vault / scripts；
 * memory / skills / web 属原 agent 模块，已移除（DSH 宿主自带 web 与记忆体系）。
 */
export function createToolExecutor({ database, config: cfg, actor = "agent" }: ExecutorDeps): ToolExecutor {
  const dataRoot = cfg.dataRoot;
  const navRepo = new NavigationRepository(database);
  const taskRepo = new TaskRepository(database);
  const resourceRepo = new ResourceRepository(database);
  // P2-1：审计上下文区分来源
  navRepo.auditContext = { actor, mode: "daily" };
  taskRepo.auditContext = { actor, mode: "daily" };
  resourceRepo.auditContext = { actor, mode: "daily" };
  const resourceService = new ResourceService(resourceRepo, new ResourceStorage(dataRoot));
  const launcher = createSystemLauncher();
  // 知识库（2026-08-12）：只读检索，独立实例；文件监听由 app.ts 的 VaultService 持有
  const vaultRepository = new VaultRepository(database);
  const vaultService = new VaultService(cfg.vaultDir, vaultRepository);

  return async (name: string, args: Record<string, unknown>, agentName?: string | null): Promise<string> => {
    switch (name) {
      // ═══ Navigation ═══
      case "cockpit_nav_list": {
        return JSON.stringify(navRepo.list(), null, 2);
      }
      case "cockpit_nav_add": {
        const input: Required<CreateNavigationItem> = {
          name: args.name as string,
          url: args.url as string,
          description: (args.description as string) ?? "",
          category: (args.category as string) ?? "工作系统",
          accent: (args.accent as CreateNavigationItem["accent"]) ?? "blue",
          position: 100,
        };
        return JSON.stringify(navRepo.create(input), null, 2);
      }
      case "cockpit_nav_remove": {
        const id = args.id as string;
        if (!navRepo.softDelete(id)) throw new ToolExecutionError(`未找到入口 ${id}`);
        return `已删除入口 ${id}`;
      }
      case "cockpit_nav_open": {
        const id = args.id as string;
        const item = navRepo.find(id);
        if (!item) throw new ToolExecutionError(`未找到入口 ${id}`);
        try {
          await launcher(item.url);
          navRepo.recordOpen(id, "success");
          return `已打开：${item.name}`;
        } catch (error) {
          navRepo.recordOpen(id, "failure");
          throw new ToolExecutionError(`打开失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // ═══ Tasks ═══
      case "cockpit_task_list": {
        const query: Record<string, unknown> = {};
        if (args.date) query.date = args.date;
        if (args.from) query.from = args.from;
        if (args.to) query.to = args.to;
        if (args.status) query.status = args.status;
        // TaskRepository.list 接受已校验的查询对象；用 unknown 收窄避免 any
        return JSON.stringify(taskRepo.list(query as Parameters<TaskRepository["list"]>[0]), null, 2);
      }
      case "cockpit_task_create": {
        return JSON.stringify(
          taskRepo.create({
            title: args.title as string,
            scheduledDate: args.scheduledDate as string,
            scheduledTime: args.scheduledTime as string,
          }),
          null,
          2,
        );
      }
      case "cockpit_task_complete": {
        const id = args.id as string;
        const item = taskRepo.updateStatus(id, "completed");
        if (!item) throw new ToolExecutionError(`未找到任务 ${id}`);
        return `已完成：${item.title}`;
      }
      case "cockpit_task_delete": {
        const id = args.id as string;
        if (!taskRepo.softDelete(id)) throw new ToolExecutionError(`未找到任务 ${id}`);
        return `已删除任务 ${id}`;
      }

      // ═══ Resources ═══
      case "cockpit_resource_list": {
        const items = resourceRepo.list({
          query: (args.query as string) ?? "",
          kind: args.kind ? (args.kind as ResourceKind) : undefined,
          trash: (args.trash as boolean) ?? false,
        });
        // 以 Agent 版为准：不裁剪笔记正文
        return JSON.stringify(items, null, 2);
      }
      case "cockpit_resource_add_url": {
        return JSON.stringify(
          resourceRepo.create({
            kind: "link",
            title: args.title as string,
            url: args.url as string,
            tags: (args.tags as string[]) ?? [],
          }),
          null,
          2,
        );
      }
      case "cockpit_resource_add_note": {
        return JSON.stringify(
          resourceRepo.create({
            kind: "note",
            title: args.title as string,
            content: args.content as string,
            tags: (args.tags as string[]) ?? [],
          }),
          null,
          2,
        );
      }
      case "cockpit_resource_add_file": {
        const filePath = args.filePath as string;
        const deniedSeg = checkPathSafe(filePath);
        if (deniedSeg) {
          throw new ToolExecutionError(`拒绝：文件路径包含受保护的目录 "${deniedSeg}"`);
        }
        const title = (args.title as string) || path.basename(filePath);
        const tags = (args.tags as string[]) ?? [];
        const fileStats = await statAsync(filePath);
        if (!fileStats.isFile()) {
          throw new ToolExecutionError(`${filePath} 不是一个有效文件`);
        }
        if (fileStats.size > resourceService.maxFileBytes) {
          throw new ToolExecutionError(`文件大小 ${fileStats.size} 超过上限`);
        }
        const stream = createReadStream(filePath);
        const pending = await resourceService.stageFile(stream, path.basename(filePath), "application/octet-stream");
        const item = await resourceService.createFile(pending, { title, tags });
        return JSON.stringify(item, null, 2);
      }
      case "cockpit_resource_delete": {
        const id = args.id as string;
        if (!resourceRepo.softDelete(id)) throw new ToolExecutionError(`未找到资料 ${id}`);
        return `已删除资料 ${id}`;
      }

      // ═══ Warehouse ═══
      case "cockpit_warehouse_summary": {
        const data = getWarehouseData();
        if (!data) return "仓管数据尚未生成，请先运行聚合脚本";
        const summary = {
          data_date: data.data_date,
          generated_at: data.generated_at,
          kpi: data.modules?.brief?.kpi ?? {},
          ...(data._dev_fixture ? { _dev_fixture: true } : {}),
        };
        return JSON.stringify(summary, null, 2);
      }
      case "cockpit_warehouse_shipping": {
        const data = getWarehouseData();
        if (!data) return "仓管数据尚未生成，请先运行聚合脚本";
        const mode = (args.mode as string) ?? "summary";
        const sm = data.modules?.shipment;
        if (!sm) return "无发货数据";
        switch (mode) {
          case "summary":
            return JSON.stringify(sm.summary, null, 2);
          case "by_style": {
            const styles = (sm.by_style ?? []) as Array<Record<string, unknown>>;
            const filtered = args.style
              ? styles.filter((s) => String(s["款式"] ?? "").includes(args.style as string))
              : styles;
            return JSON.stringify(filtered, null, 2);
          }
          case "by_platform":
            return JSON.stringify(data.modules?.platforms ?? {}, null, 2);
          case "by_region":
            return JSON.stringify(data.modules?.regions ?? {}, null, 2);
          default:
            return `未知查询模式: ${mode}，支持 summary/by_style/by_platform/by_region`;
        }
      }
      case "cockpit_warehouse_returns": {
        const data = getWarehouseData();
        if (!data) return "仓管数据尚未生成，请先运行聚合脚本";
        const mode = (args.mode as string) ?? "summary";
        const rm = data.modules?.returns;
        if (!rm) return "无退货数据";
        switch (mode) {
          case "summary":
            return JSON.stringify(rm.summary, null, 2);
          case "by_reason":
            return JSON.stringify(rm.reason_distribution ?? [], null, 2);
          case "by_style":
            return JSON.stringify(rm.by_style ?? [], null, 2);
          default:
            return `未知查询模式: ${mode}，支持 summary/by_reason/by_style`;
        }
      }
      case "cockpit_warehouse_inventory": {
        const data = getWarehouseData();
        if (!data) return "仓管数据尚未生成，请先运行聚合脚本";
        const inv = data.modules?.inventory;
        if (!inv) return "无库存数据";
        const alertType = (args.alert_type as string) ?? "all";
        const limit = (args.limit as number) ?? 20;
        const alerts = (inv.alerts ?? {}) as Record<string, unknown[]>;
        if (alertType === "all") {
          return JSON.stringify(
            {
              summary: inv.summary,
              alerts: Object.fromEntries(
                Object.entries(alerts).map(([k, v]) => [k, v.slice(0, limit)]),
              ),
            },
            null,
            2,
          );
        }
        const entries = alerts[alertType];
        if (!entries) return `未知预警类型: ${alertType}，支持 缺货/低库存/滞销/超卖/快需补货/all`;
        return JSON.stringify(entries.slice(0, limit), null, 2);
      }
      case "cockpit_warehouse_exclude_list": {
        const { data } = excludeStore.read();
        return JSON.stringify(data, null, 2);
      }
      case "cockpit_warehouse_exclude_manage": {
        const action = args.action as string;
        const sku = (args.sku as string)?.trim();
        if (!sku) throw new ToolExecutionError("SKU 不能为空");
        if (action === "add") {
          const r = excludeStore.add(sku);
          if (!r.ok) throw new ToolExecutionError(`未添加：${r.message}`);
          return r.message;
        } else if (action === "remove") {
          const r = excludeStore.remove(sku);
          if (!r.ok) throw new ToolExecutionError(`未移除：${r.message}`);
          return r.message;
        }
        throw new ToolExecutionError(`未知操作: ${action}，支持 add/remove`);
      }

      // ═══ Vault 知识库检索（2026-08-12，只读）═══
      case "cockpit_vault_search": {
        const query = (args.query as string) ?? "";
        const limit = Number(args.limit) || 8;
        if (!query.trim()) throw new ToolExecutionError("检索关键词不能为空");
        if (!vaultService.isReady) {
          vaultService.scan();
        }
        const items = vaultRepository.search(query.trim(), limit);
        if (items.length === 0) {
          return `知识库中没有找到与「${query.trim()}」相关的笔记。`;
        }
        return JSON.stringify(
          items.map((item) => ({
            path: item.path,
            title: item.title,
            excerpt: item.excerpt,
            outLinkCount: item.outLinkCount,
            inLinkCount: item.inLinkCount,
            updatedAt: new Date(item.mtime).toISOString(),
          })),
          null,
          2,
        );
      }

      // ═══ Scripts (B1) ═══
      // 异步触发本地脚本：立即返回"已启动"，后台跑完结果推通知
      default: {
        if (name.startsWith("cockpit_run_")) {
          const actionId = name.slice("cockpit_run_".length);
          const action = getScriptAction(actionId);
          if (!action) throw new ToolExecutionError(`未知脚本动作：${actionId}`);
          try {
            const { taskId, label } = scriptRunner.run(actionId, args);
            return `已启动「${label}」（任务 ${taskId}）。脚本在后台运行，完成后结果将推送到通知区。`;
          } catch (err) {
            if (err instanceof ScriptCapabilityError) {
              throw new ToolExecutionError(`无法启动：${err.message}`);
            }
            throw new ToolExecutionError(`启动失败：${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // 融合方案：MCP 插件动态工具与技能声明式工具属原 agent 模块，已移除
        throw new ToolExecutionError(`未知工具：${name}`);
      }
    }
  };
}
