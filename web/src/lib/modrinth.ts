/** Modrinth 搜索结果归一化：后端只承诺 { hits: [...] }，字段一律做容错。 */
import { isRecord } from "@/lib/api";

export interface ModProject {
  /** 装 Mod 时提交给后端的 projectId */
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  categories: string[];
  loaders: string[];
}

function pickString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function pickNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function pickStringList(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function pickAuthor(source: Record<string, unknown>): string {
  const direct = pickString(source, "author");
  if (direct !== null) {
    return direct;
  }
  const authors = source["authors"];
  if (Array.isArray(authors)) {
    for (const item of authors) {
      if (typeof item === "string" && item.trim() !== "") {
        return item.trim();
      }
      if (isRecord(item)) {
        const name = pickString(item, "name");
        if (name !== null) {
          return name;
        }
      }
    }
  }
  return "未知作者";
}

export function normalizeHits(raw: unknown): ModProject[] {
  const list = isRecord(raw) ? raw["hits"] : raw;
  if (!Array.isArray(list)) {
    return [];
  }
  const result: ModProject[] = [];
  for (const item of list) {
    if (!isRecord(item)) {
      continue;
    }
    const id =
      pickString(item, "project_id") ?? pickString(item, "projectId") ?? pickString(item, "id");
    const slug = pickString(item, "slug") ?? id;
    if (id === null || slug === null) {
      continue;
    }
    result.push({
      id,
      slug,
      title: pickString(item, "title") ?? slug,
      description: pickString(item, "description") ?? "",
      author: pickAuthor(item),
      iconUrl: pickString(item, "icon_url") ?? pickString(item, "iconUrl"),
      downloads: pickNumber(item, "downloads"),
      categories: pickStringList(item, "categories"),
      loaders: pickStringList(item, "versions").concat(pickStringList(item, "loaders")),
    });
  }
  return result;
}
