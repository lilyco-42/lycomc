/**
 * lycomc 后端 HTTP 契约（docs/CONTRACT.md）的类型定义与 fetch 封装。
 * 全部请求同源；错误体恒为 { "error": "..." }。
 */

export type WebMode = string;

export interface Health {
  ok: true;
  version: string;
  webMode: WebMode;
  dataDir: string;
}

export type DownloadSource = "mojang" | "bmcl";

export interface Settings {
  memoryMb: number;
  javaPath: string | null;
  extraJvmArgs: string[];
  selectVersion: string | null;
  downloadSource: DownloadSource;
  maxConcurrent: number;
  closeOnLaunch: boolean;
}

export type AccountKind = "offline";

export interface Account {
  name: string;
  uuid: string;
  kind: AccountKind;
}

export type VersionKind = "vanilla" | "fabric";

export interface VersionInfo {
  id: string;
  kind: VersionKind;
  baseVersion: string;
  installedAt: number | string;
  javaMajor: number;
}

export interface JavaInfo {
  path: string;
  version: number;
  source: "system" | "managed";
}

export interface RunningInstance {
  /** 后端进程号，kill 接口要用 */
  pid: number;
  versionId: string;
  accountName: string | null;
  startedAt: number | null;
}

export interface RemoteVersion {
  id: string;
  type: string;
  releaseTime: string;
}

export interface RemoteLatest {
  release: string;
  snapshot: string;
}

export interface RemoteData {
  latest: RemoteLatest;
  versions: RemoteVersion[];
}

export type JobState = "running" | "done" | "error";

export interface Job {
  id: string;
  kind: string;
  title: string;
  state: JobState;
  progress: number;
  message: string;
  logs: string[];
  result?: unknown;
  createdAt: number;
}

export interface StateResponse {
  settings: Settings;
  accounts: Account[];
  versions: VersionInfo[];
  running: RunningInstance[];
  javas: JavaInfo[];
  remote?: RemoteData | null;
}

export interface AccountsResponse {
  accounts: Account[];
}

export interface InstallResponse {
  jobId: string;
}

export interface LaunchResponse {
  jobId: string;
}

export interface OkResponse {
  ok: true;
}

/** Modrinth 搜索结果条目（字段按 Modrinth v2 search 语义，缺失字段容错） */
export interface ModrinthHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  follows?: number;
  project_type?: string;
  categories?: string[];
  versions?: string[];
  latest_version?: string;
  date_modified?: string;
}

export interface ModrinthSearchResponse {
  hits: ModrinthHit[];
  total_hits?: number;
  offset?: number;
  limit?: number;
}

export type ModrinthType = "mod" | "modpack" | "resourcepack" | "shader";

export interface ModFile {
  /** 磁盘上的 jar 文件名 */
  file: string;
  /** 展示名（项目名 / mod 名） */
  name: string;
  size: number;
}

export interface ModListResponse {
  mods: ModFile[];
}

export interface LogsResponse {
  lines: string[];
}

/** 非 2xx 或网络失败时抛出；message 即后端 error 原文。 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "未知错误";
}

/** status 为 0 表示请求根本没到达后端（服务没起 / 端口不通）。 */
export function isBackendDown(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readErrorPayload(response: Response): Promise<string> {
  const fallback =
    "HTTP " + response.status + (response.statusText ? " " + response.statusText : "");
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string" && body.error.trim() !== "") {
      return body.error;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (cause) {
    throw new ApiError(
      cause instanceof Error ? "网络请求失败：" + cause.message : "网络请求失败",
      0,
    );
  }

  if (!response.ok) {
    throw new ApiError(await readErrorPayload(response), response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json();
  return body as T;
}

function jsonBody(payload: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(payload) };
}

export const api = {
  health: () => request<Health>("/api/health"),

  state: () => request<StateResponse>("/api/state"),

  remoteVersions: (refresh = false) =>
    request<RemoteData>("/api/remote/versions" + (refresh ? "?refresh=1" : "")),

  installVersion: (versionId: string, fabric = false) =>
    request<InstallResponse>("/api/versions/install", jsonBody({ versionId, fabric })),

  deleteVersion: (id: string) =>
    request<OkResponse>("/api/versions/" + encodeURIComponent(id), { method: "DELETE" }),

  launch: (versionId: string, accountName: string, memoryMb?: number) =>
    request<LaunchResponse>(
      "/api/launch",
      jsonBody(memoryMb === undefined ? { versionId, accountName } : { versionId, accountName, memoryMb }),
    ),

  kill: (pid: number) =>
    request<OkResponse>("/api/launch/" + encodeURIComponent(String(pid)) + "/kill", jsonBody({})),

  job: (id: string) => request<Job>("/api/jobs/" + encodeURIComponent(id)),

  accounts: () => request<AccountsResponse>("/api/accounts"),

  createAccount: (name: string) => request<Account>("/api/accounts", jsonBody({ name })),

  deleteAccount: (name: string) =>
    request<OkResponse>("/api/accounts/" + encodeURIComponent(name), { method: "DELETE" }),

  modrinthSearch: (q: string, versionId?: string, type: ModrinthType = "mod") => {
    const params = new URLSearchParams({ q: q, type });
    if (versionId !== undefined && versionId !== "") {
      params.set("versionId", versionId);
    }
    return request<ModrinthSearchResponse>("/api/modrinth/search?" + params.toString());
  },

  installMod: (versionId: string, projectId: string) =>
    request<InstallResponse>("/api/mods/install", jsonBody({ versionId, projectId })),

  mods: (versionId: string) =>
    request<ModListResponse>("/api/mods?versionId=" + encodeURIComponent(versionId)),

  removeMod: (versionId: string, file: string) =>
    request<OkResponse>("/api/mods/remove", jsonBody({ versionId, file })),

  settings: () => request<Settings>("/api/settings"),

  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(patch) }),

  logs: (versionId: string) =>
    request<LogsResponse>("/api/logs/" + encodeURIComponent(versionId)),
};

/** 全局事件流（所有 Job 的 progress/done/error 都从这里下发）。 */
export const EVENTS_URL = "/api/events";
