/** 人类可读格式化：体积、速度、时间、下载量、版本类型。 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number | null | undefined, fractionDigits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  if (bytes === 0) {
    return "0 B";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : fractionDigits;
  return value.toFixed(digits) + " " + BYTE_UNITS[unit];
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (
    bytesPerSecond === null ||
    bytesPerSecond === undefined ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond <= 0
  ) {
    return "—";
  }
  return formatBytes(bytesPerSecond) + "/s";
}

/** 后端时间戳可能是秒、毫秒或 ISO 字符串，统一成毫秒。 */
export function toMillis(value: number | string | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return Number.NaN;
    }
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber) && trimmed.length <= 13) {
      return toMillis(asNumber);
    }
    return Date.parse(trimmed);
  }
  if (!Number.isFinite(value) || value <= 0) {
    return Number.NaN;
  }
  return value < 1_000_000_000_000 ? value * 1000 : value;
}

export function formatDateTime(value: number | string | null | undefined): string {
  const millis = toMillis(value);
  if (!Number.isFinite(millis)) {
    return "—";
  }
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDate(value: number | string | null | undefined): string {
  const millis = toMillis(value);
  if (!Number.isFinite(millis)) {
    return "—";
  }
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 相对时间：刚刚 / 3 小时前 / 2 天前。 */
export function formatSince(value: number | string | null | undefined): string {
  const millis = toMillis(value);
  if (!Number.isFinite(millis)) {
    return "—";
  }
  const diff = Date.now() - millis;
  if (diff < 0) {
    return "刚刚";
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return minutes + " 分钟前";
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours + " 小时前";
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return days + " 天前";
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return months + " 个月前";
  }
  return Math.floor(months / 12) + " 年前";
}

export function formatDownloads(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count) || count < 0) {
    return "—";
  }
  if (count < 10_000) {
    return count.toString();
  }
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(
    count,
  );
}

export function formatMemory(mb: number | null | undefined): string {
  if (mb === null || mb === undefined || !Number.isFinite(mb)) {
    return "—";
  }
  if (mb >= 1024) {
    const gb = mb / 1024;
    return (Number.isInteger(gb) ? gb.toString() : gb.toFixed(1)) + " GB";
  }
  return mb + " MB";
}

export function clampPercent(percent: number | null | undefined): number {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, percent));
}

export function formatPercent(percent: number | null | undefined): string {
  return Math.round(clampPercent(percent)).toString() + "%";
}

/** Mojang 版本类型 -> 中文标签 */
export function versionTypeLabel(type: string | null | undefined): string {
  switch ((type ?? "").toLowerCase()) {
    case "release":
      return "正式版";
    case "snapshot":
      return "快照";
    case "old_beta":
      return "远古 Beta";
    case "old_alpha":
      return "远古 Alpha";
    default:
      return type === null || type === undefined || type === "" ? "未知" : type;
  }
}

/** Java 主版本能否跑某个 MC 版本（只做粗略提示，真正的判断在后端） */
export function javaHintFor(javaMajor: number): string {
  if (!Number.isFinite(javaMajor) || javaMajor <= 0) {
    return "未知";
  }
  return "Java " + javaMajor;
}

export function shortenMiddle(text: string, max = 44): string {
  if (text.length <= max) {
    return text;
  }
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return text.slice(0, head) + "…" + text.slice(text.length - tail);
}

export function shortUuid(uuid: string | null | undefined): string {
  if (!uuid) {
    return "—";
  }
  return uuid.length > 13 ? uuid.slice(0, 8) + "…" + uuid.slice(-4) : uuid;
}

/** 游戏语言（options.txt 的 lang）可选值；设置页与版本页共用。 */
export interface GameLangOption {
  value: string;
  label: string;
}

export const GAME_LANGS: GameLangOption[] = [
  { value: "zh_cn", label: "简体中文" },
  { value: "zh_tw", label: "繁體中文" },
  { value: "en_us", label: "English（英文）" },
  { value: "ja_jp", label: "日本語" },
];

export function gameLangLabel(code: string | null | undefined): string {
  if (code === null || code === undefined || code.trim() === "") {
    return "未知";
  }
  const found = GAME_LANGS.find((item) => item.value === code);
  return found !== undefined ? found.label : code;
}
