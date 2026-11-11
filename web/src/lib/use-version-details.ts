/**
 * 批量读取实例详情（GET /api/versions/:id）里的语言信息：
 * lang / resourcePacks / localized。后端未实现该接口时静默降级（不显示语言相关 UI）。
 */
import { useEffect, useRef, useState } from "react";
import { api, isRecord } from "@/lib/api";
import { normalizeVersion } from "@/lib/normalize";

export interface VersionDetail {
  /** options.txt 当前语言，如 zh_cn；未知为 null */
  lang: string | null;
  /** options.txt 里已启用的资源包 */
  resourcePacks: string[];
  /** 是否已装中文本地化资源包 */
  localized: boolean;
}

function readDetail(raw: unknown): VersionDetail | null {
  const source = isRecord(raw) && isRecord(raw["version"]) ? raw["version"] : raw;
  const version = normalizeVersion(source);
  if (version === null) {
    return null;
  }
  return {
    lang: version.lang ?? null,
    resourcePacks: version.resourcePacks ?? [],
    localized: version.localized === true,
  };
}

/**
 * ids 变化时按需拉取（已拉过的跳过）；nonce 变化代表强制刷新。
 * 结果以 Record 形式返回，缺失的 id 说明「未知」而不是「没有」。
 */
export function useVersionDetails(ids: string[], nonce = 0): Record<string, VersionDetail> {
  const [details, setDetails] = useState<Record<string, VersionDetail>>({});
  const fetchedRef = useRef<Set<string>>(new Set());
  const key = ids.join("|");

  useEffect(() => {
    if (key === "") {
      return;
    }
    let cancelled = false;
    const claimed: string[] = [];
    for (const id of key.split("|")) {
      const token = id + "@" + String(nonce);
      if (id === "" || fetchedRef.current.has(token)) {
        continue;
      }
      fetchedRef.current.add(token);
      claimed.push(token);
      api
        .version(id)
        .then((raw) => {
          const detail = readDetail(raw);
          if (cancelled || detail === null) {
            return;
          }
          setDetails((previous) => ({ ...previous, [id]: detail }));
        })
        .catch(() => {
          // 接口不存在 / 实例已删除 / 后端忙：保持「未知」，不打扰用户
        });
    }
    return () => {
      cancelled = true;
      for (const token of claimed) {
        fetchedRef.current.delete(token);
      }
    };
  }, [key, nonce]);

  return details;
}
