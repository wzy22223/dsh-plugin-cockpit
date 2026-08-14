import type {
  ApiError,
  CreateNavigationItem,
  NavigationItem,
  NavigationListResponse,
} from "../shared/contracts/navigation";
import type {
  CreateScheduledTask,
  ScheduledTask,
  TaskListQuery,
  TaskListResponse,
  TaskStatus,
} from "../shared/contracts/tasks";
import type {
  CreateResourceInput,
  ResourceItem,
  ResourceListResponse,
} from "../shared/contracts/resources";
import type {
  VaultGraph,
  VaultNoteDetail,
  VaultNoteSummary,
  VaultStats,
} from "../shared/contracts/vault";

class ApiRequestError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiError | { error?: string; message?: string };
    if (typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
    if (typeof (body as { message?: unknown }).message === "string") {
      return (body as { message: string }).message;
    }
    return (body as ApiError).error.message;
  } catch {
    return "请求没有完成，请稍后重试。";
  }
}

async function request<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const method = options.method?.toUpperCase() ?? "GET";
  let body = options.body;

  if (method !== "GET" && method !== "HEAD") {
    if (!(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
      body ??= "{}";
    }
    headers.set("X-Cockpit-Request", "1");
  }

  const requestOptions: RequestInit = {
    ...options,
    headers,
  };
  if (body !== undefined) {
    requestOptions.body = body;
  }

  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    throw new ApiRequestError(await parseError(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function listNavigation(): Promise<NavigationItem[]> {
  const response = await request<NavigationListResponse>("/api/navigation");
  return response.items;
}

export async function createNavigation(
  input: CreateNavigationItem,
): Promise<NavigationItem> {
  return request<NavigationItem>("/api/navigation", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteNavigation(id: string): Promise<void> {
  return request<void>(`/api/navigation/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function restoreNavigation(id: string): Promise<NavigationItem> {
  return request<NavigationItem>(
    `/api/navigation/${encodeURIComponent(id)}/restore`,
    {
      method: "POST",
    },
  );
}

export async function openNavigation(id: string): Promise<void> {
  return request<void>(`/api/navigation/${encodeURIComponent(id)}/open`, {
    method: "POST",
  });
}

export async function listScheduledTasks(
  scheduledDate: string,
): Promise<ScheduledTask[]> {
  const response = await request<TaskListResponse>(
    `/api/tasks?date=${encodeURIComponent(scheduledDate)}`,
  );
  return response.items;
}

export async function listScheduledTaskRange(
  query: TaskListQuery = {},
): Promise<ScheduledTask[]> {
  const parameters = new URLSearchParams();
  if (query.date !== undefined) {
    parameters.set("date", query.date);
  }
  if (query.from !== undefined) {
    parameters.set("from", query.from);
  }
  if (query.to !== undefined) {
    parameters.set("to", query.to);
  }
  if (query.status !== undefined) {
    parameters.set("status", query.status);
  }
  const suffix = parameters.size > 0 ? `?${parameters.toString()}` : "";
  const response = await request<TaskListResponse>(`/api/tasks${suffix}`);
  return response.items;
}

export async function createScheduledTask(
  input: CreateScheduledTask,
): Promise<ScheduledTask> {
  return request<ScheduledTask>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateScheduledTaskStatus(
  id: string,
  status: TaskStatus,
): Promise<ScheduledTask> {
  return request<ScheduledTask>(`/api/tasks/${encodeURIComponent(id)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function listResources({
  query = "",
  kind,
  trash = false,
}: {
  query?: string;
  kind?: ResourceItem["kind"];
  trash?: boolean;
} = {}): Promise<ResourceItem[]> {
  const parameters = new URLSearchParams();
  if (query !== "") {
    parameters.set("query", query);
  }
  if (kind !== undefined) {
    parameters.set("kind", kind);
  }
  parameters.set("trash", String(trash));
  const response = await request<ResourceListResponse>(
    `/api/resources?${parameters.toString()}`,
  );
  return response.items;
}

export async function createResource(
  input: CreateResourceInput,
): Promise<ResourceItem> {
  return request<ResourceItem>("/api/resources", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadResource(
  file: File,
  options: { title?: string; tags?: string[] } = {},
): Promise<ResourceItem> {
  const form = new FormData();
  form.set("file", file);
  if (options.title !== undefined) {
    form.set("title", options.title);
  }
  if (options.tags !== undefined && options.tags.length > 0) {
    form.set("tags", options.tags.join(","));
  }
  return request<ResourceItem>("/api/resources/upload", {
    method: "POST",
    body: form,
  });
}

export async function deleteResource(id: string): Promise<void> {
  return request<void>(`/api/resources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function restoreResource(id: string): Promise<ResourceItem> {
  return request<ResourceItem>(
    `/api/resources/${encodeURIComponent(id)}/restore`,
    {
      method: "POST",
    },
  );
}

// ── 仓库数据缓存（避免 App.tsx 和 WarehouseWorkspace.tsx 重复 fetch） ──

interface WarehouseDataCache {
  etag: string | null;
  data: unknown | null;
  fetchedAt: number;
}

const warehouseCache: WarehouseDataCache = { etag: null, data: null, fetchedAt: 0 };
const CACHE_TTL = 30_000; // 30 秒内复用缓存

export async function fetchWarehouseData(): Promise<unknown> {
  const now = Date.now();
  if (warehouseCache.data && (now - warehouseCache.fetchedAt) < CACHE_TTL) {
    return warehouseCache.data;
  }

  const headers: Record<string, string> = {};
  if (warehouseCache.etag) {
    headers["If-None-Match"] = warehouseCache.etag;
  }

  const response = await fetch("/api/warehouse/data", { headers });
  if (response.status === 304) {
    // 数据未变，更新获取时间
    warehouseCache.fetchedAt = now;
    return warehouseCache.data;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const etag = response.headers.get("etag");
  const data = await response.json();
  warehouseCache.etag = etag;
  warehouseCache.data = data;
  warehouseCache.fetchedAt = now;
  return data;
}

// 首页速览专用：只拉 summary 视图（~1-2KB），避免无条件拉 4MB 全量 data.json
interface WarehouseSummaryCache {
  etag: string | null;
  data: unknown | null;
  fetchedAt: number;
}

const summaryCache: WarehouseSummaryCache = { etag: null, data: null, fetchedAt: 0 };

export async function fetchWarehouseSummary(): Promise<unknown> {
  const now = Date.now();
  if (summaryCache.data && (now - summaryCache.fetchedAt) < CACHE_TTL) {
    return summaryCache.data;
  }

  const headers: Record<string, string> = {};
  if (summaryCache.etag) {
    headers["If-None-Match"] = summaryCache.etag;
  }

  const response = await fetch("/api/warehouse/summary", { headers });
  if (response.status === 304) {
    summaryCache.fetchedAt = now;
    return summaryCache.data;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const etag = response.headers.get("etag");
  const data = await response.json();
  summaryCache.etag = etag;
  summaryCache.data = data;
  summaryCache.fetchedAt = now;
  return data;
}

// ERP 异常订单（发货失败 + 打单超2次），独立端点，复用缓存+ETag 套路
interface ErpExceptionsCache {
  etag: string | null;
  data: unknown | null;
  fetchedAt: number;
}

const exceptionsCache: ErpExceptionsCache = { etag: null, data: null, fetchedAt: 0 };

export async function fetchErpExceptions(): Promise<unknown> {
  const now = Date.now();
  if (exceptionsCache.data && (now - exceptionsCache.fetchedAt) < CACHE_TTL) {
    return exceptionsCache.data;
  }

  const headers: Record<string, string> = {};
  if (exceptionsCache.etag) {
    headers["If-None-Match"] = exceptionsCache.etag;
  }

  const response = await fetch("/api/warehouse/exceptions", { headers });
  if (response.status === 304) {
    exceptionsCache.fetchedAt = now;
    return exceptionsCache.data;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const etag = response.headers.get("etag");
  const data = await response.json();
  exceptionsCache.etag = etag;
  exceptionsCache.data = data;
  exceptionsCache.fetchedAt = now;
  return data;
}

// ═══ 记忆管理（V0.9.2）═══

export type MemoryType = "fact" | "session" | "preference";

export interface MemoryItem {
  id: number;
  type: MemoryType;
  content: string;
  createdAt: string;
  /** 来源 Agent 名（null = 全局共享） */
  agent: string | null;
}

export interface MemoryListResponse {
  counts: { session: number; fact: number; preference: number };
  /** 当前可见范围的 Agent 名（null = 全局共享） */
  agent: string | null;
  items: MemoryItem[];
}

export async function listMemory(params: {
  type?: MemoryType | "all";
  q?: string;
  limit?: number;
  /** V0.9.3 per-agent：缺省 = 全局共享（pi）；传子 Agent 名 = 共享 + 该 Agent 私有 */
  agent?: string | null;
} = {}): Promise<MemoryListResponse> {
  const query = new URLSearchParams();
  if (params.type !== undefined) query.set("type", params.type);
  if (params.q) query.set("q", params.q);
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.agent) query.set("agent", params.agent);
  const qs = query.toString();
  return request<MemoryListResponse>(`/api/agent/memory${qs ? `?${qs}` : ""}`);
}

export async function addMemory(content: string, agent?: string | null): Promise<{ id: number }> {
  return request<{ id: number }>("/api/agent/memory", {
    method: "POST",
    body: JSON.stringify({ content, type: "fact", agent: agent ?? null }),
  });
}

export async function deleteMemory(id: number): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/agent/memory/${id}`, {
    method: "DELETE",
  });
}

// ═══ 技能管理（V0.9.2）═══

export interface SkillInfo {
  name: string;
  description: string;
  /** V0.9.3 配置中心：技能开关 */
  enabled: boolean;
  /** 可执行代码环境（python/node；null = 纯指令技能） */
  run: string | null;
  triggers: string[];
}

export interface SkillDetail extends SkillInfo {
  content: string;
  /** 可执行代码内容（run 声明 + code 文件存在时） */
  code: string | null;
}

export interface SkillListResponse {
  count: number;
  skills: SkillInfo[];
}

export interface SkillSaveInput {
  name: string;
  description: string;
  enabled: boolean;
  run: string | null;
  triggers: string[];
  content: string;
  code?: string | null;
}

export async function listSkills(): Promise<SkillListResponse> {
  return request<SkillListResponse>("/api/agent/skills");
}

export async function getSkill(name: string): Promise<SkillDetail> {
  return request<SkillDetail>(`/api/agent/skills/${encodeURIComponent(name)}`);
}

export async function createSkill(input: SkillSaveInput): Promise<{ ok: boolean; name: string }> {
  return request<{ ok: boolean; name: string }>("/api/agent/skills", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSkill(
  oldName: string,
  input: SkillSaveInput,
): Promise<{ ok: boolean; name: string }> {
  return request<{ ok: boolean; name: string }>(
    `/api/agent/skills/${encodeURIComponent(oldName)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export async function deleteSkill(name: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/agent/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
    body: "{}",
  });
}

/** 导入解析：只解析 SKILL.md 文本，不写入（前端预览确认后再保存） */
export async function parseSkillImport(raw: string): Promise<SkillDetail> {
  return request<SkillDetail>("/api/agent/skills/import", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
}

// ═══ Agent Profile 管理（V0.9.3 多 Agent）═══

export type AgentProfileToolMode = "inherit" | "none" | "custom";
export const AGENT_NO_TOOLS_SENTINEL = "__cockpit_no_tools__";

export interface AgentProfileInfo {
  name: string;
  description: string;
  /** V0.9.3 配置中心：角色开关 */
  enabled: boolean;
  /** 模型（null = 默认 MiniMax-M3） */
  model: string | null;
  /** 技能绑定（null = 全部已启用技能） */
  skills: string[] | null;
  /** 工具权限模式：继承当前模式、禁用全部、自定义白名单 */
  toolMode: AgentProfileToolMode;
  tools: string[];
  confirm: boolean;
}

export interface AgentProfileDetail extends AgentProfileInfo {
  content: string;
}

export interface AgentProfileListResponse {
  count: number;
  profiles: AgentProfileInfo[];
}

export interface AgentProfileSaveInput {
  name: string;
  description: string;
  enabled: boolean;
  model: string | null;
  skills: string[] | null;
  toolMode: AgentProfileToolMode;
  tools: string[];
  confirm: boolean;
  content: string;
}

/** 全局 Agent 配置（config.json，对齐 OpenClaw） */
export interface GlobalAgentConfig {
  tools: {
    allow: string[];
    deny: string[];
  };
  /** 全局默认对话模型（缺省 = 环境 PI_LLM_MODEL / MiniMax-M3） */
  model?: string;
  /** LLM 供应商（缺省 = MiniMax 官方端点 + PI_LLM_API_KEY）；key 只引用环境变量名 */
  llm?: {
    baseURL?: string;
    apiKeyEnv?: string;
  };
}

export interface GlobalAgentConfigView extends GlobalAgentConfig {
  health?: {
    status: "backup-degraded" | "degraded-lkg" | "invalid-fail-closed";
    source: "primary" | "memory" | "sidecar" | "deny-all";
    effectiveDenyAll: boolean;
    warning: string;
  };
}

/** 工具定义（前端勾选列表用，V0.9.3 加读写标志） */
export interface ToolDef {
  name: string;
  description: string;
  /** 是否为写入类工具（需用户确认） */
  write: boolean;
}

export interface ToolDefListResponse {
  count: number;
  tools: ToolDef[];
}

/** 内置主 Agent（全量权限，不作为 Profile 落盘） */
export const BUILTIN_AGENT = "pi";

function normalizeAgentProfile<T extends AgentProfileInfo>(profile: T): T {
  const rawTools = Array.isArray(profile.tools)
    ? profile.tools.filter((tool): tool is string => typeof tool === "string")
    : [];
  const explicitMode = profile.toolMode;
  const toolMode: AgentProfileToolMode = explicitMode === "inherit"
    || explicitMode === "none"
    || explicitMode === "custom"
    ? explicitMode
    : rawTools.length === 1 && rawTools[0] === AGENT_NO_TOOLS_SENTINEL
      ? "none"
      : rawTools.length > 0
        ? "custom"
        : "inherit";
  return {
    ...profile,
    toolMode,
    tools: toolMode === "custom" ? rawTools : [],
  };
}

function profileSavePayload(input: AgentProfileSaveInput): AgentProfileSaveInput {
  return {
    ...input,
    tools: input.toolMode === "none"
      ? [AGENT_NO_TOOLS_SENTINEL]
      : input.toolMode === "custom"
        ? input.tools
        : [],
  };
}

export async function listProfiles(): Promise<AgentProfileListResponse> {
  const response = await request<AgentProfileListResponse>("/api/agent/profiles");
  return { ...response, profiles: response.profiles.map(normalizeAgentProfile) };
}

export async function getProfile(name: string): Promise<AgentProfileDetail> {
  const profile = await request<AgentProfileDetail>(`/api/agent/profiles/${encodeURIComponent(name)}`);
  return normalizeAgentProfile(profile);
}

export async function createProfile(input: AgentProfileSaveInput): Promise<{ ok: boolean; name: string }> {
  return request<{ ok: boolean; name: string }>("/api/agent/profiles", {
    method: "POST",
    body: JSON.stringify(profileSavePayload(input)),
  });
}

export async function updateProfile(
  oldName: string,
  input: AgentProfileSaveInput,
): Promise<{ ok: boolean; name: string }> {
  return request<{ ok: boolean; name: string }>(
    `/api/agent/profiles/${encodeURIComponent(oldName)}`,
    { method: "PUT", body: JSON.stringify(profileSavePayload(input)) },
  );
}

export async function deleteProfile(name: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/agent/profiles/${encodeURIComponent(name)}`, {
    method: "DELETE",
    body: "{}",
  });
}

/** 导入解析：只解析 AGENT.md 文本，不写入（前端预览确认后再保存） */
export async function parseProfileImport(raw: string): Promise<AgentProfileDetail> {
  const profile = await request<AgentProfileDetail>("/api/agent/profiles/import", {
    method: "POST",
    body: JSON.stringify({ raw }),
  });
  return normalizeAgentProfile(profile);
}

// ═══ 全局配置 + 工具定义（V0.9.3 配置中心）═══

export async function getGlobalConfig(): Promise<GlobalAgentConfigView> {
  return request<GlobalAgentConfigView>("/api/agent/config");
}

export async function saveGlobalConfig(config: GlobalAgentConfig): Promise<{ ok: boolean; config: GlobalAgentConfigView; warning?: string }> {
  return request<{ ok: boolean; config: GlobalAgentConfigView; warning?: string }>("/api/agent/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function listToolDefs(): Promise<ToolDefListResponse> {
  return request<ToolDefListResponse>("/api/agent/tooldefs");
}

// ═══ 设置中心（V0.9.7）═══

export type McpTransport = "stdio" | "sse";

export interface McpServerConfig {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  apiKeyEnv?: string;
  enabled: boolean;
}

export type McpServerStatusState = "connected" | "disconnected" | "error";

export interface McpServerStatus {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  status: McpServerStatusState;
  toolCount: number;
  error?: string;
}

export interface AgentSettingsResponse {
  config: GlobalAgentConfigView;
  piPrompt: string | null;
  promptPath: string;
  mcp: {
    config: { servers: McpServerConfig[] };
    status: McpServerStatus[];
  };
}

export async function getAgentSettings(): Promise<AgentSettingsResponse> {
  return request<AgentSettingsResponse>("/api/agent/settings");
}

export async function savePiPrompt(content: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>("/api/agent/settings/prompt", {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function saveMcpServers(
  servers: McpServerConfig[],
): Promise<{ ok: boolean; servers: McpServerStatus[] }> {
  return request<{ ok: boolean; servers: McpServerStatus[] }>("/api/agent/mcp/servers", {
    method: "PUT",
    body: JSON.stringify({ servers }),
  });
}

export async function refreshMcpServers(): Promise<{ ok: boolean; servers: McpServerStatus[] }> {
  return request<{ ok: boolean; servers: McpServerStatus[] }>("/api/agent/mcp/refresh", {
    method: "POST",
  });
}

// ═══ 知识库（Obsidian vault，2026-08-12）═══

export async function fetchVaultNotes(params: {
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<{ query: string; total: number; items: VaultNoteSummary[] }> {
  const query = new URLSearchParams();
  if (params.query !== undefined && params.query !== "") {
    query.set("query", params.query);
  }
  if (params.limit !== undefined) {
    query.set("limit", String(params.limit));
  }
  if (params.offset !== undefined) {
    query.set("offset", String(params.offset));
  }
  const suffix = query.toString() === "" ? "" : `?${query.toString()}`;
  return request(`/api/vault/notes${suffix}`);
}

export async function fetchVaultNote(
  path: string,
): Promise<VaultNoteDetail & { raw: string }> {
  return request(`/api/vault/note?path=${encodeURIComponent(path)}`);
}

export async function fetchVaultGraph(): Promise<VaultGraph> {
  return request("/api/vault/graph");
}

export async function fetchVaultStats(): Promise<VaultStats> {
  return request("/api/vault/stats");
}

export async function refreshVault(): Promise<{
  ok: boolean;
  added: number;
  updated: number;
  removed: number;
}> {
  return request("/api/vault/refresh", { method: "POST" });
}

export async function saveVaultNote(
  path: string,
  content: string,
): Promise<{ path: string; mtime: number }> {
  return request("/api/vault/note", {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  });
}
