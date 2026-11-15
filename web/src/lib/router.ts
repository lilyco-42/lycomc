import { useEffect, useState } from "react";

/** 已知路由。新增页面只改这里 + 侧栏 NAV_ITEMS + App 的 switch。 */
export const ROUTES = ["/", "/versions", "/download", "/mods", "/settings", "/backup", "/guide", "/help"] as const;
export type RoutePath = (typeof ROUTES)[number];

/** "#/versions/" -> "/versions"；空 hash 视为首页。 */
export function normalizeHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "") {
    return "/";
  }
  const withSlash = raw.startsWith("/") ? raw : "/" + raw;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

export function hrefFor(to: string): string {
  const normalized = normalizeHash(to);
  return normalized === "/" ? "#/" : "#" + normalized;
}

/** 用 URL hash 做路由：可刷新、可前进后退、零额外依赖。 */
export function useRoutePath(): string {
  const [path, setPath] = useState<string>(() =>
    typeof window === "undefined" ? "/" : normalizeHash(window.location.hash),
  );

  useEffect(() => {
    const handleChange = () => {
      setPath(normalizeHash(window.location.hash));
    };
    window.addEventListener("hashchange", handleChange);
    if (window.location.hash === "") {
      window.location.replace(hrefFor("/"));
    }
    return () => {
      window.removeEventListener("hashchange", handleChange);
    };
  }, []);

  return path;
}

export function navigate(to: string): void {
  const next = hrefFor(to);
  if (window.location.hash === next) {
    return;
  }
  window.location.hash = next;
}
