/** 把后端返回的松散数据（尤其是契约未细化的 running[]）收敛成前端类型。 */
import { isRecord, type Account, type JavaInfo, type RemoteData, type RemoteVersion, type RunningInstance, type Settings, type StateResponse, type VersionInfo } from "@/lib/api";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalizeRunning(raw: unknown): RunningInstance[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: RunningInstance[] = [];
  for (const item of raw) {
    if (typeof item === "number" && Number.isFinite(item)) {
      result.push({ pid: item, versionId: "", accountName: null, startedAt: null });
      continue;
    }
    if (!isRecord(item)) {
      continue;
    }
    const pid = num(item["pid"], Number.NaN);
    if (!Number.isFinite(pid)) {
      continue;
    }
    result.push({
      pid,
      versionId: str(item["versionId"]) ?? str(item["version_id"]) ?? str(item["version"]) ?? "",
      accountName: str(item["accountName"]) ?? str(item["account"]) ?? null,
      startedAt: typeof item["startedAt"] === "number" ? item["startedAt"] : null,
    });
  }
  return result;
}

export function normalizeVersion(raw: unknown): VersionInfo | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw["id"]) ?? str(raw["versionId"]);
  if (id === null) {
    return null;
  }
  const kindRaw = str(raw["kind"]) ?? str(raw["type"]);
  const kind = kindRaw === "fabric" ? "fabric" : "vanilla";
  const installedAtRaw = raw["installedAt"];
  const installedAt =
    typeof installedAtRaw === "number" || typeof installedAtRaw === "string" ? installedAtRaw : 0;
  return {
    id,
    kind,
    baseVersion: str(raw["baseVersion"]) ?? str(raw["base"]) ?? id,
    installedAt,
    javaMajor: num(raw["javaMajor"], 0),
  };
}

export function normalizeVersions(raw: unknown): VersionInfo[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: VersionInfo[] = [];
  for (const item of raw) {
    const version = normalizeVersion(item);
    if (version !== null) {
      result.push(version);
    }
  }
  return result;
}

export function normalizeAccount(raw: unknown): Account | null {
  if (!isRecord(raw)) {
    return null;
  }
  const name = str(raw["name"]);
  if (name === null) {
    return null;
  }
  return { name, uuid: str(raw["uuid"]) ?? "", kind: "offline" };
}

export function normalizeAccounts(raw: unknown): Account[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: Account[] = [];
  for (const item of raw) {
    const account = normalizeAccount(item);
    if (account !== null) {
      result.push(account);
    }
  }
  return result;
}

export function normalizeJava(raw: unknown): JavaInfo[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: JavaInfo[] = [];
  for (const item of raw) {
    if (!isRecord(item)) {
      continue;
    }
    const p = str(item["path"]);
    if (p === null) {
      continue;
    }
    const source = item["source"] === "managed" ? "managed" : "system";
    result.push({ path: p, version: num(item["version"], 0), source });
  }
  return result;
}

export const DEFAULT_SETTINGS: Settings = {
  memoryMb: 4096,
  javaPath: null,
  extraJvmArgs: [],
  selectVersion: null,
  downloadSource: "mojang",
  maxConcurrent: 8,
  closeOnLaunch: false,
};

export function normalizeSettings(raw: unknown): Settings {
  if (!isRecord(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  const source = raw["downloadSource"];
  const extra = raw["extraJvmArgs"];
  return {
    memoryMb: num(raw["memoryMb"], DEFAULT_SETTINGS.memoryMb),
    javaPath: str(raw["javaPath"]),
    extraJvmArgs: Array.isArray(extra)
      ? extra.filter((item): item is string => typeof item === "string")
      : [],
    selectVersion: str(raw["selectVersion"]),
    downloadSource: source === "bmcl" ? "bmcl" : "mojang",
    maxConcurrent: num(raw["maxConcurrent"], DEFAULT_SETTINGS.maxConcurrent),
    closeOnLaunch: raw["closeOnLaunch"] === true,
  };
}

export function normalizeRemote(raw: unknown): RemoteData | null {
  if (!isRecord(raw)) {
    return null;
  }
  const latestRaw = raw["latest"];
  const versionsRaw = raw["versions"];
  if (!Array.isArray(versionsRaw)) {
    return null;
  }
  const versions: RemoteVersion[] = [];
  for (const item of versionsRaw) {
    if (!isRecord(item)) {
      continue;
    }
    const id = str(item["id"]);
    if (id === null) {
      continue;
    }
    versions.push({
      id,
      type: str(item["type"]) ?? "unknown",
      releaseTime: str(item["releaseTime"]) ?? "",
    });
  }
  const latest = isRecord(latestRaw)
    ? {
        release: str(latestRaw["release"]) ?? "",
        snapshot: str(latestRaw["snapshot"]) ?? "",
      }
    : { release: "", snapshot: "" };
  return { latest, versions };
}

/** /api/state 全量归一化，任何字段缺失都不抛错（后端半成品也能渲染）。 */
export function normalizeState(raw: unknown): StateResponse {
  const record = isRecord(raw) ? raw : {};
  return {
    settings: normalizeSettings(record["settings"]),
    accounts: normalizeAccounts(record["accounts"]),
    versions: normalizeVersions(record["versions"]),
    running: normalizeRunning(record["running"]),
    javas: normalizeJava(record["javas"]),
    remote: normalizeRemote(record["remote"]),
  };
}
