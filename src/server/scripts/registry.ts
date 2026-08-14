/**
 * 脚本动作注册中心（B1 / S2 受限参数）
 *
 * 每个动作 = 预注册定义 + zod 校验的受限参数（枚举 / 日期白名单），
 * 禁止任何路径或命令注入（不接受自由字符串、不拼接 shell）。
 *
 * 路径不硬编码：脚本文件名在此声明，runner 用 config.projectRoot 拼接 scripts/ 目录。
 * 实际脚本文件由用户后续放入 D:\cockpit\scripts\（A4 决策：先搭框架，路径预留）。
 */
import { z } from "zod";
import path from "node:path";

import { loadConfig } from "../platform/config.js";
import type { CapabilityFlag } from "./capabilities.js";

export type ScriptInterpreter = "python" | "node" | "bash";

/** 受限参数 schema：仅允许 date（YYYY-MM-DD 可选），其余动作无参 */
const dateParamSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD")
    .optional(),
});

export interface ScriptAction {
  id: string;
  label: string;
  /** scripts/ 下的文件名（不含目录） */
  file: string;
  interpreter: ScriptInterpreter;
  /** zod schema（S2 受限参数） */
  argsSchema: z.ZodType;
  /** 依赖的能力（见 capabilities.ts） */
  requires: CapabilityFlag[];
  /** 超时毫秒，默认 5 分钟 */
  timeoutMs: number;
}

export const SCRIPT_ACTIONS: ScriptAction[] = [
  {
    id: "erp_workflow",
    label: "ERP 审单+面单",
    file: "erp_full_workflow.py",
    interpreter: "python",
    argsSchema: z.object({}),
    requires: ["python_bin", "chrome_cdp", "script_files"],
    timeoutMs: 5 * 60 * 1000,
  },
  {
    id: "taobao_daily",
    label: "淘宝日报",
    file: "taobao_daily_update.py",
    interpreter: "python",
    argsSchema: dateParamSchema,
    requires: ["python_bin", "chrome_cdp", "script_files"],
    timeoutMs: 5 * 60 * 1000,
  },
  {
    id: "dewu_aftersale",
    label: "得物售后导出",
    file: "erp_dewu_aftersale_export.py",
    interpreter: "python",
    argsSchema: dateParamSchema,
    requires: ["python_bin", "chrome_cdp", "script_files"],
    timeoutMs: 5 * 60 * 1000,
  },
];

const ACTION_MAP = new Map(SCRIPT_ACTIONS.map((a) => [a.id, a]));

export function getScriptAction(id: string): ScriptAction | undefined {
  return ACTION_MAP.get(id);
}

/** 解析并校验参数（S2：zod 校验，失败抛错） */
export function parseScriptArgs(
  action: ScriptAction,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return action.argsSchema.parse(raw) as Record<string, unknown>;
}

/** 拼接脚本绝对路径（scriptsDir + file；scriptsDir 默认项目内 scripts/，可经 COCKPIT_SCRIPTS_DIR 指向外部） */
export function resolveScriptPath(action: ScriptAction): string {
  const cfg = loadConfig();
  return path.join(cfg.scriptsDir, action.file);
}
