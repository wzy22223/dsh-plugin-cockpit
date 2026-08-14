/**
 * 脚本运行能力预检（E2）
 *
 * Fastify 启动时做一次只读预检，得出"当前哪些脚本可跑"的能力声明，
 * 暴露给 Pi（决策是否触发）与前端（置灰不可用动作）。
 *
 * 设计原则（不破安全边界）：
 * - 只读检查：探活端口、检查文件/可执行存在，绝不启动/修改任何环境；
 * - 不自愈：检测失败只声明不可用，不自动起 Chrome / 不自动 login；
 * - 路径不硬编码：Python bin、Chrome CDP 地址、脚本目录均可通过 env 注入，
 *   源码不依赖本机绝对路径（符合 AGENTS.md）。
 */
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import { loadConfig } from "../platform/config.js";

/** 能力标志（与 scripts/registry.ts 的 ScriptAction.requires 对应） */
export type CapabilityFlag = "python_bin" | "chrome_cdp" | "script_files";

export interface Capabilities {
  python_bin: boolean;
  chrome_cdp: boolean;
  /** 首批脚本文件是否齐全（scripts/ 下 3 个 .py 均存在） */
  script_files: boolean;
  /** 供前端展示的明细（不涉密，仅状态） */
  details: {
    pythonBinPath: string | null;
    chromeCdpUrl: string;
    missingScripts: string[];
  };
}

let cached: Capabilities | null = null;

function getPythonBin(): string | null {
  // 优先 env 注入，避免源码硬编码本机绝对路径
  const fromEnv = process.env.COCKPIT_PYTHON_BIN;
  if (fromEnv) return fromEnv;
  return null;
}

function getChromeCdpUrl(): string {
  const host = process.env.COCKPIT_CHROME_CDP_HOST ?? "127.0.0.1";
  const port = process.env.COCKPIT_CHROME_CDP_PORT ?? "9222";
  return `${host}:${port}`;
}

/** TCP 探活（超时即失败，不抛错） */
function probeTcp(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port, timeout: timeoutMs });
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.once("timeout", () => done(false));
  });
}

/** 首批脚本文件名（与 registry 中定义保持一致） */
const SCRIPT_FILES = [
  "erp_full_workflow.py",
  "taobao_daily_update.py",
  "erp_dewu_aftersale_export.py",
] as const;

/**
 * 执行只读预检。幂等，结果缓存到模块级变量，
 * 同一进程生命周期内只探活一次（端口可能变化，但启动期探测足够）。
 */
export async function detectCapabilities(): Promise<Capabilities> {
  const cfg = loadConfig();
  const scriptsDir = cfg.scriptsDir;

  const pythonBin = getPythonBin();
  const python_bin = pythonBin ? existsSync(pythonBin) : false;

  const cdpUrl = getChromeCdpUrl();
  const [host, portStr] = cdpUrl.split(":");
  const chrome_cdp = await probeTcp(host!, Number(portStr));

  const missingScripts = SCRIPT_FILES.filter(
    (f) => !existsSync(path.join(scriptsDir, f)),
  );
  const script_files = missingScripts.length === 0;

  cached = {
    python_bin,
    chrome_cdp,
    script_files,
    details: {
      pythonBinPath: pythonBin,
      chromeCdpUrl: cdpUrl,
      missingScripts,
    },
  };
  return cached;
}

/** 读取缓存的能力声明（须先 detectCapabilities） */
export function getCapabilities(): Capabilities {
  if (!cached) {
    // 防御性：未预检时同步触发（理论上 registerAgent 已调）
    throw new Error("能力未预检，请先调用 detectCapabilities()");
  }
  return cached;
}

/** 判断某个能力集合是否满足（供 runner 触发前校验） */
export function satisfies(required: CapabilityFlag[]): boolean {
  const caps = getCapabilities();
  return required.every((flag) => {
    if (flag === "python_bin") return caps.python_bin;
    if (flag === "chrome_cdp") return caps.chrome_cdp;
    if (flag === "script_files") return caps.script_files;
    return false;
  });
}
