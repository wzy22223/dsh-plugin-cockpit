/**
 * 脚本异步执行器（B1 / M2）
 *
 * runScript 立即返回 taskId，不阻塞对话循环；脚本在后台子进程跑，
 * 结束/超时后把结果摘要写入通知队列（NotificationKind=script_result），
 * 复用现有 worker-state.json 存储 + Pi 面板铃铛红点通道。
 *
 * 安全约束（不破边界）：
 * - 脚本路径由 registry 锁定（resolveScriptPath），不接收客户端路径；
 * - 参数经 registry zod 校验（S2），仅允许枚举/日期，不拼接 shell；
 * - spawn 参数化调用，不经 shell；
 * - 超时 kill 子进程，避免挂死。
 */
import { spawn } from "node:child_process";
import path from "node:path";

import { addNotification } from "../platform/worker-state.js";
import {
  satisfies,
} from "./capabilities.js";
import {
  getScriptAction,
  parseScriptArgs,
  resolveScriptPath,
  type ScriptAction,
} from "./registry.js";

export interface ScriptRunResult {
  taskId: string;
  actionId: string;
  label: string;
}

export class ScriptRunner {
  /** Python 解释器路径（env 注入，缺省无法运行） */
  private readonly pythonBin: string | null;

  constructor() {
    this.pythonBin = process.env.COCKPIT_PYTHON_BIN ?? null;
  }

  /**
   * 触发脚本（异步）。校验能力 + 参数后 spawn，立即返回 taskId。
   * 任何前置校验失败直接抛错（由调用方转为工具返回值告知用户）。
   */
  run(actionId: string, rawArgs: Record<string, unknown>): ScriptRunResult {
    const action = getScriptAction(actionId);
    if (!action) {
      throw new Error(`未知脚本动作：${actionId}`);
    }

    // 能力预检（E2）：不满足则明确告知，不盲触发
    if (!satisfies(action.requires)) {
      throw new ScriptCapabilityError(action);
    }

    // 参数校验（S2）
    const args = parseScriptArgs(action, rawArgs);

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // 异步执行（不 await），结果写通知
    void this.execute(action, args, taskId);
    return { taskId, actionId, label: action.label };
  }

  private async execute(
    action: ScriptAction,
    args: Record<string, unknown>,
    taskId: string,
  ): Promise<void> {
    const scriptPath = resolveScriptPath(action);
    const cliArgs: string[] = [];
    if (typeof args.date === "string") cliArgs.push(args.date);

    const [cmd, spawnArgs] = this.buildCommand(action, scriptPath, cliArgs);

    const stdout: string[] = [];
    const stderr: string[] = [];
    let finished = false;

    const child = spawn(cmd, spawnArgs, {
      env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });

    child.stdout?.on("data", (d) => stdout.push(d.toString()));
    child.stderr?.on("data", (d) => stderr.push(d.toString()));

    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill("SIGKILL");
        this.notifyResult(action, taskId, false, "执行超时（超过设定时限）", stdout, stderr);
      }
    }, action.timeoutMs);

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      this.notifyResult(action, taskId, false, `启动失败：${err.message}`, stdout, stderr);
    });

    child.on("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const ok = code === 0;
      const tail = this.tailLines([...stdout, ...stderr]);
      this.notifyResult(
        action,
        taskId,
        ok,
        ok ? "执行完成" : `退出码 ${code}`,
        stdout,
        stderr,
        tail,
      );
    });
  }

  private buildCommand(
    action: ScriptAction,
    scriptPath: string,
    cliArgs: string[],
  ): [string, string[]] {
    if (action.interpreter === "python") {
      if (!this.pythonBin) {
        throw new Error("Python 解释器未配置（COCKPIT_PYTHON_BIN）");
      }
      return [this.pythonBin, [scriptPath, ...cliArgs]];
    }
    if (action.interpreter === "node") {
      return [process.execPath, [scriptPath, ...cliArgs]];
    }
    // bash
    return ["bash", [scriptPath, ...cliArgs]];
  }

  /** 取输出末尾若干行作为摘要（避免通知体过大） */
  private tailLines(bufs: string[], max = 15): string {
    const text = bufs.join("").trim();
    if (!text) return "";
    const lines = text.split(/\r?\n/);
    return lines.slice(-max).join("\n").slice(-800);
  }

  private notifyResult(
    action: ScriptAction,
    taskId: string,
    ok: boolean,
    status: string,
    stdout: string[],
    stderr: string[],
    summaryTail?: string,
  ): void {
    const tail = summaryTail ?? this.tailLines([...stdout, ...stderr]);
    const body = [
      `[${action.label}] ${status}`,
      tail ? `\n输出摘要：\n${tail}` : "",
      stderr.length ? `\n（详见 stderr，共 ${stderr.join("").length} 字符）` : "",
    ]
      .filter(Boolean)
      .join("");
    addNotification("script_result", `${action.label} ${ok ? "完成" : "失败"}`, body);
  }
}

/** 能力不满足时的错误（调用方转为友好提示） */
export class ScriptCapabilityError extends Error {
  constructor(action: ScriptAction) {
    super(
      `当前环境不满足「${action.label}」的运行条件（需 Chrome 已登录且脚本文件就位）。` +
        `请检查：Chrome CDP :9222 可达、Python 环境已配置、scripts/ 下脚本文件存在。`,
    );
    this.name = "ScriptCapabilityError";
  }
}

/** 单例（进程级复用） */
export const scriptRunner = new ScriptRunner();
