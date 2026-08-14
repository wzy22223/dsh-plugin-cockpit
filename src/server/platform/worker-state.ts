/**
 * 通知存储（DSH 插件版）
 * 脚本结果等业务通知队列，存于 <dataRoot>/notifications.json
 * 原子写：唯一 tmp + rename。自原 agent/worker/worker-state.ts 迁移（agent 模块移除后保留通知能力）。
 */
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.js";

export type NotificationKind = "warehouse_alert" | "task_reminder" | "script_result";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationState {
  notifications: NotificationItem[];
}

function getStatePath(): string {
  return process.env.COCKPIT_WORKER_STATE_PATH
    ? path.resolve(process.env.COCKPIT_WORKER_STATE_PATH)
    : path.join(loadConfig().dataRoot, "notifications.json");
}

/** 通知保留条数（超过则丢弃最旧的已读项） */
const NOTIFICATION_MAX = 100;

function emptyState(): NotificationState {
  return { notifications: [] };
}

export function loadState(): NotificationState {
  try {
    const STATE_PATH = getStatePath();
    if (!existsSync(STATE_PATH)) return emptyState();
    const raw = readFileSync(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<NotificationState>;
    return {
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
    };
  } catch {
    return emptyState();
  }
}

function persist(state: NotificationState): void {
  try {
    const STATE_PATH = getStatePath();
    const dir = path.dirname(STATE_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${STATE_PATH}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    renameSync(tmp, STATE_PATH);
  } catch (error) {
    console.error("[cockpit] 通知写入失败:", error);
  }
}

/** 新增一条通知（去重置顶，已读项保留） */
export function addNotification(
  kind: NotificationKind,
  title: string,
  body: string,
): NotificationItem {
  const state = loadState();
  const item: NotificationItem = {
    id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title,
    body,
    createdAt: new Date().toISOString(),
    read: false,
  };
  state.notifications.unshift(item);

  // 裁剪：超上限时移除最旧的已读项
  if (state.notifications.length > NOTIFICATION_MAX) {
    const excess = state.notifications.length - NOTIFICATION_MAX;
    let removed = 0;
    state.notifications = state.notifications.filter((n) => {
      if (removed >= excess) return true;
      if (n.read) {
        removed += 1;
        return false;
      }
      return true;
    });
  }
  persist(state);
  return item;
}

export function getNotifications(): NotificationItem[] {
  return loadState().notifications;
}

export function getUnreadCount(): number {
  return loadState().notifications.filter((n) => !n.read).length;
}

/** 标记某条通知为已读 */
export function markRead(id: string): boolean {
  const state = loadState();
  const target = state.notifications.find((n) => n.id === id);
  if (!target || target.read) return false;
  target.read = true;
  persist(state);
  return true;
}

/** 全部标记为已读 */
export function markAllRead(): void {
  const state = loadState();
  let changed = false;
  for (const n of state.notifications) {
    if (!n.read) {
      n.read = true;
      changed = true;
    }
  }
  if (changed) persist(state);
}
