import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  CircleHelp,
  Compass,
  DatabaseBackup,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Globe2,
  Info,
  LifeBuoy,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Puzzle,
  RefreshCw,
  Scale,
  Search,
  SearchX,
  ServerCrash,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { BackendNotice } from "@/components/backend-notice";
import { useAppData } from "@/context/app-data-context";
import {
  api,
  DEFAULT_HELP_SEARCH_PATH,
  isRecord,
  type AboutInfo,
  type HelpLink,
  type HelpSearchResponse,
  type HelpTopic,
  type UpstreamInfo,
} from "@/lib/api";
import { hrefFor, navigate } from "@/lib/router";
import { useKeyedFetch } from "@/lib/use-keyed-fetch";
import { cn } from "@/lib/utils";

const ABOUT_KEY = "help-about-info";
const SEARCH_PREFIX = "help-search:";
const UNKNOWN = "未知";
const MAX_QUERY_CHARS = 128;
const SEARCH_DELAY_MS = 260;

interface HelpLinkItem {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

interface SearchKeyParts {
  q: string;
  path: string;
}

const QUICK_LINKS: HelpLinkItem[] = [
  {
    id: "download",
    label: "安装新版本",
    description: "选择原版或 Fabric，查看实时安装进度。",
    href: "#/download",
    icon: Download,
  },
  {
    id: "versions",
    label: "管理已装实例",
    description: "重命名、独立目录与实例级启动设置。",
    href: "#/versions",
    icon: Boxes,
  },
  {
    id: "mods",
    label: "Mod 管理",
    description: "搜索 Modrinth、启用或禁用本地 Mod。",
    href: "#/mods",
    icon: Puzzle,
  },
  {
    id: "settings",
    label: "账号与设置",
    description: "内存、Java、下载线路与账号都在这里。",
    href: "#/settings",
    icon: Settings2,
  },
  {
    id: "backup",
    label: "备份与清理",
    description: "导出设置、恢复备份，或只清理临时缓存。",
    href: "#/backup",
    icon: DatabaseBackup,
  },
];

function text(value: unknown, fallback = UNKNOWN): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function isExternalHref(href: string): boolean {
  return href.startsWith("https://") || href.startsWith("http://");
}

function hashHref(candidate: string): string | null {
  if (candidate.startsWith("/api/") || candidate.startsWith("//")) {
    return null;
  }
  if (candidate.startsWith("#/") || candidate.startsWith("/")) {
    return hrefFor(candidate);
  }
  return /^#[A-Za-z0-9/_?=&.-]+$/.test(candidate) ? candidate : null;
}

/** 只允许 http(s) 外部链接与站内 hash；拒绝 javascript: / data: / 任意站内 API 路径。 */
function safeHref(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const candidate = raw.trim();
  if (candidate === "") {
    return null;
  }
  if (candidate.startsWith("#") || (candidate.startsWith("/") && !candidate.startsWith("//"))) {
    return hashHref(candidate);
  }
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function linkKindDescription(href: string): string {
  return isExternalHref(href) ? "外部链接 · 新标签打开" : "站内页面 · 当前标签打开";
}

function toLinks(raw: unknown): HelpLink[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: unknown[] = raw;
  return entries.flatMap((entry: unknown): HelpLink[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const href = safeHref(entry["url"]);
    if (href === null) {
      return [];
    }
    return [{ title: text(entry["title"], "未命名链接"), url: href }];
  });
}

function toTopics(raw: unknown): HelpTopic[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const entries: unknown[] = raw;
  return entries.flatMap((entry: unknown, index: number): HelpTopic[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const title = text(entry["title"], "");
    if (title === "") {
      return [];
    }
    return [
      {
        id: text(entry["id"], "help-topic-" + String(index)),
        title,
        category: text(entry["category"], "帮助"),
        summary: text(entry["summary"], "暂无说明"),
        route: safeHref(entry["route"]),
        url: safeHref(entry["url"]),
      },
    ];
  });
}

/** 后端字段缺失时仍显示「未知」，不让页面白屏。 */
function normalizeAbout(raw: unknown): AboutInfo | null {
  if (!isRecord(raw)) {
    return null;
  }
  const upstreamValue: unknown = raw["upstream"];
  const upstreamRaw: Record<string, unknown> = isRecord(upstreamValue) ? upstreamValue : {};
  const upstream: UpstreamInfo = {
    name: text(upstreamRaw["name"]),
    version: text(upstreamRaw["version"]),
    url: text(upstreamRaw["url"], ""),
    licenseNote: text(upstreamRaw["licenseNote"], "上游许可边界说明暂未提供。"),
  };
  return {
    name: text(raw["name"]),
    product: text(raw["product"]),
    version: text(raw["version"]),
    webMode: text(raw["webMode"]),
    license: text(raw["license"]),
    licenseStatus: text(raw["licenseStatus"]),
    licenseNote: text(raw["licenseNote"], "项目所有者尚未提供正式许可说明；请以仓库最终 LICENSE 为准。"),
    repository: text(raw["repository"], ""),
    issues: text(raw["issues"], ""),
    upstream,
    guideUrl: text(raw["guideUrl"], "#/guide"),
    docs: toLinks(raw["docs"]),
    wiki: toLinks(raw["wiki"]),
    helpTopics: toTopics(raw["helpTopics"]),
    helpSearchPath: text(raw["helpSearchPath"], DEFAULT_HELP_SEARCH_PATH),
  };
}

function normalizeHelpSearch(raw: unknown): HelpSearchResponse | null {
  if (!isRecord(raw)) {
    return null;
  }
  const items = toTopics(raw["items"]);
  const rawCount: unknown = raw["count"];
  const count =
    typeof rawCount === "number" && Number.isFinite(rawCount) && rawCount >= 0
      ? rawCount
      : items.length;
  return { items, count };
}

function parseSearchKey(key: string): SearchKeyParts {
  const fallback: SearchKeyParts = { q: "", path: DEFAULT_HELP_SEARCH_PATH };
  if (!key.startsWith(SEARCH_PREFIX)) {
    return fallback;
  }
  try {
    const parsed: unknown = JSON.parse(key.slice(SEARCH_PREFIX.length));
    if (!Array.isArray(parsed)) {
      return fallback;
    }
    const values: unknown[] = parsed;
    const query: unknown = values[0];
    const path: unknown = values[1];
    return {
      q: typeof query === "string" ? query : "",
      path: typeof path === "string" ? path : DEFAULT_HELP_SEARCH_PATH,
    };
  } catch {
    return fallback;
  }
}

const loadAbout: (key: string) => Promise<AboutInfo | null> = async () => {
  const raw: unknown = await api.about();
  return normalizeAbout(raw);
};

const loadHelpSearch: (key: string) => Promise<HelpSearchResponse | null> = async (key: string) => {
  const parts = parseSearchKey(key);
  const q = Array.from(parts.q).slice(0, MAX_QUERY_CHARS).join("");
  const raw: unknown = await api.searchHelp(q, parts.path);
  return normalizeHelpSearch(raw);
};

function makeLink(
  id: string,
  label: string,
  description: string,
  rawHref: unknown,
  icon: LucideIcon,
): HelpLinkItem | null {
  const href = safeHref(rawHref);
  if (href === null) {
    return null;
  }
  return { id, label, description, href, icon };
}

function webModeLabel(mode: string): string {
  if (mode === "embedded") {
    return "内嵌页面";
  }
  if (mode === "missing") {
    return "未内嵌";
  }
  if (mode === "dev" || mode === "development") {
    return "开发模式";
  }
  return mode === UNKNOWN ? "未知" : mode;
}

function licenseStatusLabel(status: string): string {
  if (status === "unspecified") {
    return "尚未声明";
  }
  if (status === "apache-2.0") {
    return "Apache-2.0";
  }
  return status === UNKNOWN ? "未知" : status;
}

function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-2" aria-label="正在加载内容">
      {Array.from({ length: rows }, (_unused, index) => (
        <Skeleton key={index} className="h-12 w-full rounded-xl" />
      ))}
    </div>
  );
}

function InfoRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div data-help-info={label} className="rounded-xl border border-border bg-pcl-8/60 px-3 py-2.5 dark:bg-muted/30">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium text-foreground">{value}</p>
      {hint !== undefined ? (
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function LinkCard({ item }: { item: HelpLinkItem }) {
  const Icon = item.icon;
  const external = isExternalHref(item.href);
  return (
    <a
      data-help-link={item.id}
      href={item.href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="card-soft group flex items-center gap-3 rounded-2xl border border-border bg-card p-3 transition-colors hover:border-pcl-4 hover:bg-pcl-8/50 dark:hover:bg-muted/40"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-pcl-7 text-primary dark:bg-muted">
        <Icon className="size-4.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
          <span className="truncate">{item.label}</span>
          {external ? <ExternalLink className="size-3 shrink-0 text-muted-foreground" /> : <ArrowRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{item.description}</span>
      </span>
    </a>
  );
}

function LinkRow({ item }: { item: HelpLinkItem }) {
  const Icon = item.icon;
  const external = isExternalHref(item.href);
  return (
    <a
      data-help-link={item.id}
      href={item.href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="group flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 transition-colors hover:border-pcl-4 hover:bg-pcl-8/50 dark:hover:bg-muted/40"
    >
      <Icon className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-foreground">{item.label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{item.description}</span>
      </span>
      {external ? (
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </a>
  );
}

function HelpTopicCard({ topic }: { topic: HelpTopic }) {
  const href = safeHref(topic.url) ?? safeHref(topic.route);
  const external = href !== null && isExternalHref(href);
  return (
    <article
      data-help-topic={topic.id}
      className="card-soft flex flex-col gap-2 rounded-2xl border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px] text-pcl-2 dark:text-pcl-5">{topic.category}</Badge>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{topic.title}</h3>
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">{topic.summary}</p>
      <div className="mt-auto pt-1">
        {href !== null ? (
          <a
            data-help-link={"topic-" + topic.id}
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            {external ? "打开说明链接" : "打开相关页面"}
            {external ? <ExternalLink className="size-3" /> : <ArrowRight className="size-3" />}
          </a>
        ) : (
          <span className="text-[11px] text-muted-foreground">暂无可打开的链接</span>
        )}
      </div>
    </article>
  );
}

/** H39：内嵌使用帮助、关于、许可边界、反馈与 Wiki 索引。 */
export function HelpPage() {
  const { backendDown } = useAppData();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const timerRef = useRef<number | null>(null);

  const about = useKeyedFetch<AboutInfo | null>(ABOUT_KEY, loadAbout);
  const info = about.data;
  const searchPath = info?.helpSearchPath ?? DEFAULT_HELP_SEARCH_PATH;
  const searchKey = SEARCH_PREFIX + JSON.stringify([query, searchPath]);
  const search = useKeyedFetch<HelpSearchResponse | null>(searchKey, loadHelpSearch);
  const searchResults = search.data?.items ?? [];
  const searchCount = search.data?.count ?? searchResults.length;
  const fallbackTopics = info?.helpTopics.slice(0, 6) ?? [];
  const guideHref = safeHref(info?.guideUrl) ?? "#/guide";

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const scheduleQuery = (value: string) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setQuery(Array.from(value.trim()).slice(0, MAX_QUERY_CHARS).join(""));
    }, SEARCH_DELAY_MS);
  };

  const handleDraftChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setDraft(value);
    scheduleQuery(value);
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const next = Array.from(draft.trim()).slice(0, MAX_QUERY_CHARS).join("");
    setQuery(next);
    if (next === query) {
      search.reload();
    }
  };

  const handleClear = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setDraft("");
    setQuery("");
    if (query === "") {
      search.reload();
    }
  };

  const quickLinks: HelpLinkItem[] = [
    {
      id: "guide",
      label: "新手教程",
      description: "四步开始玩，第一次用先看这里。",
      href: guideHref,
      icon: BookOpen,
    },
    ...QUICK_LINKS,
  ];

  const primaryLinks: HelpLinkItem[] = [
    makeLink("issues", "问题反馈", "打开项目 Issues，不会在本页自动提交", info?.issues, MessageSquare),
    makeLink("repository", "项目仓库", "查看本项目源码与发布信息", info?.repository, GitBranch),
  ].filter((item): item is HelpLinkItem => item !== null);

  const docLinks: HelpLinkItem[] = (info?.docs ?? []).flatMap((link, index) => {
    const item = makeLink(
      "doc-" + String(index),
      link.title,
      linkKindDescription(link.url),
      link.url,
      FileText,
    );
    return item === null ? [] : [item];
  });

  const wikiLinks: HelpLinkItem[] = (info?.wiki ?? []).flatMap((link, index) => {
    const item = makeLink(
      "wiki-" + String(index),
      link.title,
      linkKindDescription(link.url),
      link.url,
      Globe2,
    );
    return item === null ? [] : [item];
  });

  const upstreamLink = makeLink(
    "upstream",
    "查看上游项目页面",
    "仅用于说明来源与许可边界",
    info?.upstream.url,
    ShieldCheck,
  );

  const allLinksEmpty = primaryLinks.length === 0 && docLinks.length === 0 && wikiLinks.length === 0;

  return (
    <div data-motion-root data-page="help" className="space-y-4">
      <PageHeader
        title="帮助与关于"
        description="内嵌使用说明、版本信息、许可来源与项目链接；不用离开启动器也能找到答案。"
        action={
          <Button variant="outline" size="sm" onClick={() => { navigate("/guide"); }}>
            <BookOpen />
            打开新手教程
          </Button>
        }
      />

      {backendDown ? (
        <BackendNotice
          onRetry={() => { about.reload(); search.reload(); }}
          retrying={about.loading || search.loading}
        />
      ) : null}

      <section className="card-soft rounded-2xl border border-border bg-card p-5" data-help-hero>
        <div className="flex flex-wrap items-start gap-4">
          <span className="brand-solid flex size-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md">
            <LifeBuoy className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight">有问题？先从这里找答案</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              下面的帮助主题由启动器本机提供，输入关键词即可查找；关于、许可和项目链接则直接读取本机信息，不会替你发送反馈。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 text-[11px]"><CircleHelp className="size-3 text-primary" />离线帮助索引</Badge>
              <Badge variant="outline" className="text-[11px]">不提交反馈</Badge>
              <Badge variant="outline" className="text-[11px]">仅安全链接</Badge>
            </div>
          </div>
        </div>
      </section>

      <section
        id="help-usage"
        data-help-section="usage"
        className="card-soft space-y-4 rounded-2xl border border-border bg-card p-4"
      >
        <SectionHeader
          icon={BookOpen}
          title="使用帮助"
          description="从教程开始，或直接打开常用页面；也可以搜索下面的内联帮助主题。"
        />

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map((item) => <LinkCard key={item.id} item={item} />)}
        </div>

        <div className="space-y-3 rounded-2xl border border-pcl-4/30 bg-pcl-8/50 p-3 dark:bg-muted/30">
          <div className="flex flex-wrap items-center gap-2">
            <Search className="size-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">搜索内联帮助</h3>
            <Badge variant="outline" className="text-[10px]">本机离线索引</Badge>
          </div>
          <form role="search" onSubmit={handleSearchSubmit} className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  data-help-search-input
                  aria-label="搜索帮助关键词"
                  aria-describedby="help-search-hint"
                  value={draft}
                  onChange={handleDraftChange}
                  placeholder="例如：备份、Java、Mod、启动、许可…"
                  maxLength={MAX_QUERY_CHARS}
                  className="pl-9"
                />
              </div>
              <Button data-help-search-submit type="submit" size="sm" aria-busy={search.loading}>
                {search.loading ? <Loader2 className="animate-spin" /> : <Search />}
                搜索
              </Button>
              <Button
                data-help-search-clear
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClear}
                disabled={draft === "" && query === ""}
              >
                清空
              </Button>
            </div>
            <p id="help-search-hint" className="text-[11px] leading-relaxed text-muted-foreground">
              输入关键词后会自动搜索，也可以按回车立即查找。搜索内容来自本机内联帮助，不会联网抓取 Wiki。
            </p>
          </form>

          <div data-help-search-results className="space-y-2">
            {search.loading ? (
              <LoadingRows rows={3} />
            ) : search.error !== null ? (
              <div className="space-y-3">
                <ErrorAlert
                  title="搜索帮助失败"
                  message={search.error}
                  onRetry={search.reload}
                  offline={backendDown}
                />
                {fallbackTopics.length > 0 ? (
                  <div data-help-fallback-topics className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">
                      搜索暂时不可用，先显示关于信息里的 {fallbackTopics.length} 条离线索引：
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {fallbackTopics.map((topic) => <HelpTopicCard key={topic.id} topic={topic} />)}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : searchResults.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title={query === "" ? "暂时没有帮助主题" : "没有找到相关帮助"}
                description={query === "" ? "启动器还没有提供内联帮助索引，可以先看上面的新手教程。" : "换个更短的词试试，例如「备份」「Mod」「账号」。"}
                action={
                  <Button variant="outline" size="sm" onClick={handleClear}>
                    <RefreshCw />
                    清空关键词
                  </Button>
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {query === "" ? "全部帮助主题" : "「" + query + "」的搜索结果"}
                  </p>
                  <Badge variant="secondary" className="text-[10px]">共 {searchCount} 条</Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {searchResults.map((topic) => <HelpTopicCard key={topic.id} topic={topic} />)}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section
        id="help-about"
        data-help-section="about"
        className="card-soft space-y-3 rounded-2xl border border-border bg-card p-4"
      >
        <SectionHeader
          icon={Info}
          title="关于 LilyCraft"
          description="名称、版本与运行信息由本机启动器提供，缺失字段会显示「未知」。"
        />
        {about.loading ? (
          <LoadingRows rows={4} />
        ) : about.error !== null ? (
          <ErrorAlert
            title="无法读取关于信息"
            message={about.error}
            onRetry={about.reload}
            offline={backendDown}
          />
        ) : info === null ? (
          <EmptyState
            icon={ServerCrash}
            title="暂时没有关于信息"
            description="启动器还没有返回项目信息，稍后重试即可；教程和帮助入口仍然可用。"
            action={
              <Button variant="outline" size="sm" onClick={about.reload}>
                <RefreshCw />
                重新加载
              </Button>
            }
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <InfoRow label="名称" value={info.name} />
            <InfoRow label="产品标识" value={info.product} />
            <InfoRow label="当前版本" value={info.version} />
            <InfoRow label="页面模式" value={webModeLabel(info.webMode)} hint="表示网页是否随启动器一起内嵌。" />
            <InfoRow label="许可" value={info.license} />
            <InfoRow label="许可状态" value={licenseStatusLabel(info.licenseStatus)} />
            <InfoRow label="帮助主题" value={String(info.helpTopics.length) + " 条"} />
            <InfoRow label="文档索引" value={String(info.docs.length) + " 条"} />
            <InfoRow label="Wiki 索引" value={String(info.wiki.length) + " 条"} />
          </div>
        )}
      </section>

      <section
        id="help-license"
        data-help-section="license"
        className="card-soft space-y-3 rounded-2xl border border-border bg-card p-4"
      >
        <SectionHeader
          icon={Scale}
          title="许可与来源"
          description="说明独立实现边界；这里不内嵌长篇第三方许可证全文。"
        />
        {about.loading ? (
          <LoadingRows rows={3} />
        ) : about.error !== null ? (
          <ErrorAlert
            title="无法读取许可说明"
            message={about.error}
            onRetry={about.reload}
            offline={backendDown}
          />
        ) : info === null ? (
          <EmptyState
            icon={Compass}
            title="暂时没有许可说明"
            description="启动器还没有返回项目许可与来源信息，稍后重试即可。"
            action={
              <Button variant="outline" size="sm" onClick={about.reload}>
                <RefreshCw />
                重新加载
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border border-pcl-4/30 bg-pcl-8/60 p-3 dark:bg-muted/30">
              <div className="flex flex-wrap items-center gap-3">
                <ShieldCheck className="size-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">本项目许可：{info.license}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    许可状态：{licenseStatusLabel(info.licenseStatus)} · 以项目所有者最终发布的 LICENSE 为准。
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">{licenseStatusLabel(info.licenseStatus)}</Badge>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{info.licenseNote}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-3">
                <p className="text-[13px] font-semibold text-foreground">我们怎样使用参考项目</p>
                <ul className="mt-2 space-y-2">
                  {[
                    "LilyCraft 是独立编写的启动器，不是 PCL / PCL-CE 官方版本，也没有官方关联。",
                    "界面、文案与图标均为本项目自研；只参考公开功能语义，不复制源码、自定义 LICENCE 文本、图标或品牌资产。",
                    "PCL-CE 不同目录的许可边界并不相同；这里只展示来源与边界说明，不内嵌长篇第三方许可证全文。",
                  ].map((line) => (
                    <li key={line} className="flex gap-2 text-[12px] leading-relaxed text-muted-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-pcl-3" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                <p className="text-[13px] font-semibold text-foreground">上游来源</p>
                <div className="rounded-lg bg-pcl-8/60 px-2.5 py-2 dark:bg-muted/30">
                  <p className="text-[12px] font-medium text-foreground">{info.upstream.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">参考版本：{info.upstream.version}</p>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">{info.upstream.licenseNote}</p>
                {upstreamLink !== null ? (
                  <LinkRow item={upstreamLink} />
                ) : (
                  <p className="text-[11px] text-muted-foreground">暂无可打开的上游链接</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <section
        id="help-feedback"
        data-help-section="feedback"
        className="card-soft space-y-3 rounded-2xl border border-border bg-card p-4"
      >
        <SectionHeader
          icon={MessagesSquare}
          title="反馈与 Wiki"
          description="打开项目仓库、问题反馈、文档与 Wiki 索引；本页不会替你提交反馈。"
        />
        {about.loading ? (
          <LoadingRows rows={3} />
        ) : about.error !== null ? (
          <ErrorAlert
            title="无法读取项目链接"
            message={about.error}
            onRetry={about.reload}
            offline={backendDown}
          />
        ) : info === null || allLinksEmpty ? (
          <EmptyState
            icon={Compass}
            title="暂无项目链接"
            description="启动器还没有提供仓库、反馈或文档入口，稍后重试即可。"
            action={
              <Button variant="outline" size="sm" onClick={about.reload}>
                <RefreshCw />
                重新加载
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            <p className="rounded-xl border-l-[3px] border-primary bg-pcl-8/70 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground dark:bg-muted/40">
              点击链接才会打开对应页面：外部链接在新标签打开，站内说明保持在当前标签。页面不会自动提交反馈，也不会联网抓取 Wiki 内容。
            </p>
            {primaryLinks.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {primaryLinks.map((item) => <LinkRow key={item.id} item={item} />)}
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <p className="pl-1 text-[12px] font-semibold text-primary">文档索引</p>
                {docLinks.length > 0 ? (
                  <div className="space-y-2">
                    {docLinks.map((item) => <LinkRow key={item.id} item={item} />)}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">暂无文档链接</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="pl-1 text-[12px] font-semibold text-primary">Wiki 索引</p>
                {wikiLinks.length > 0 ? (
                  <div className="space-y-2">
                    {wikiLinks.map((item) => <LinkRow key={item.id} item={item} />)}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">暂无 Wiki 链接</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4", "card-soft")}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pcl-7 text-primary dark:bg-muted">
          <CircleHelp className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">还没找到答案？</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            回「使用教程」重看四步引导，或打开项目 Issues 搜索已有问题；提交前记得附上复现步骤。
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { navigate("/guide"); }}>
          重看教程
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
