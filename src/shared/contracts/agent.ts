/** Agent WebSocket 共享协议（前后端唯一来源）。 */

export const MAX_AGENT_MESSAGE_CHARS = 24_000;

export type AgentRunStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type AgentActionResultStatus =
  | "executing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentErrorCode =
  | "INVALID_MESSAGE"
  | "INVALID_SESSION"
  | "AGENT_NOT_FOUND"
  | "AGENT_DISABLED"
  | "SESSION_BUSY"
  | "RUN_NOT_ACTIVE"
  | "STOP_UNAVAILABLE"
  | "ACTION_NOT_PENDING"
  | "TOOL_DENIED"
  | "LLM_TIMEOUT"
  | "LLM_RATE_LIMIT"
  | "CONTEXT_OVERFLOW"
  | "LLM_PROVIDER_ERROR"
  | "RUN_FAILED"
  | "CONNECTION_LOST";

export type AgentNotificationKind =
  | "warehouse_alert"
  | "task_reminder"
  | "script_result";

export interface AgentNotificationItem {
  id: string;
  kind: AgentNotificationKind;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

interface SessionRequest {
  sessionId: string;
}

interface AcknowledgedRequest extends SessionRequest {
  requestId: string;
}

export type AgentClientMessage =
  | ({ type: "sync" } & SessionRequest)
  | ({ type: "chat"; content: string } & AcknowledgedRequest)
  | ({ type: "confirm"; runId: string; actionId: string; approved: boolean } & AcknowledgedRequest)
  | ({ type: "cancel"; runId: string; actionId: string } & AcknowledgedRequest)
  | ({ type: "stop"; runId: string } & AcknowledgedRequest)
  | ({ type: "clear" } & AcknowledgedRequest)
  | { type: "fetch_notifications" }
  | { type: "mark_read"; notificationId?: string };

interface ScopedEvent {
  agent: string;
  sessionId: string;
  runId?: string;
}

export interface AgentPendingActionSnapshot {
  actionId: string;
  summary: string;
  tool: string;
  args: Record<string, unknown>;
}

export type AgentServerMessage =
  | ({
      type: "ack";
      requestId: string;
      accepted: boolean;
      message?: string;
    } & ScopedEvent)
  | ({
      type: "session_state";
      status: AgentRunStatus;
      pendingAction?: AgentPendingActionSnapshot;
      /** 旧版单文件历史仍保留，但不会自动注入到新 Session。 */
      legacyHistoryAvailable?: boolean;
    } & ScopedEvent)
  | ({
      type: "run_status";
      status: Exclude<AgentRunStatus, "idle">;
      message?: string;
    } & Required<Pick<ScopedEvent, "runId">> & ScopedEvent)
  | ({
      type: "text";
      messageId: string;
      content: string;
      done: boolean;
    } & Required<Pick<ScopedEvent, "runId">> & ScopedEvent)
  | ({
      type: "tool_call";
      toolCallId: string;
      tool: string;
      args: Record<string, unknown>;
    } & Required<Pick<ScopedEvent, "runId">> & ScopedEvent)
  | ({
      type: "tool_result";
      toolCallId: string;
      tool: string;
      result: string;
    } & Required<Pick<ScopedEvent, "runId">> & ScopedEvent)
  | ({
      type: "action_confirm";
      actionId: string;
      summary: string;
      tool: string;
      args: Record<string, unknown>;
    } & Required<Pick<ScopedEvent, "runId">> & ScopedEvent)
  | ({
      type: "action_result";
      actionId: string;
      status: AgentActionResultStatus;
      message?: string;
    } & Required<Pick<ScopedEvent, "runId">> & ScopedEvent)
  | ({ type: "cleared"; requestId: string } & ScopedEvent)
  | ({
      type: "error";
      code: AgentErrorCode;
      message: string;
      retryable: boolean;
      requestId?: string;
    } & Partial<ScopedEvent>)
  | { type: "notifications"; notifications: AgentNotificationItem[] };

export const AGENT_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;

export function isValidAgentSessionId(value: unknown): value is string {
  return typeof value === "string" && AGENT_SESSION_ID_PATTERN.test(value);
}

export function isValidAgentRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
