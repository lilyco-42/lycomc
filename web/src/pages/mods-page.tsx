import { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  Download,
  Loader2,
  Package,
  Puzzle,
  RefreshCw,
  Search,
  SearchX,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { BackendNotice } from "@/components/backend-notice";
import { ErrorAlert } from "@/components/error-alert";
import { SectionHeader } from "@/components/section-header";
import { JobProgressCard } from "@/components/job-progress-card";
import { useAppData } from "@/context/app-data-context";
import { api, errorMessage, type Job, type ModFile } from "@/lib/api";
import { formatBytes, formatDownloads } from "@/lib/format";
import { normalizeHits, type ModProject } from "@/lib/modrinth";
import { navigate } from "@/lib/router";
import { useJobTracker } from "@/lib/use-job";
import { useKeyedFetch } from "@/lib/use-keyed-fetch";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 400;

interface SearchPayload {
  hits: ModProject[];
}

/** Mod 管理：Modrinth 搜索安装 + 已装 Mod 列表（按实例）。 */
export function ModsPage() {
  const { versions, selectedVersion, loading, backendDown, error, reload, settings } = useAppData();

  // 用户没手动选实例时跟随全局当前版本（派生值，不用 effect 同步）
  const [pickedVersionId, setPickedVersionId] = useState<string | null>(null);
  const versionId = pickedVersionId ?? selectedVersion?.id ?? "";

  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [removingFile, setRemovingFile] = useState<string | null>(null);
  const [installingProject, setInstallingProject] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  // 搜索去抖（定时器里更新，不在 effect 里同步 setState）
  useEffect(() => {
    const keyword = query.trim();
    const timer = window.setTimeout(() => {
      setSubmitted(keyword);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  const searchLoader = useCallback(async (key: string): Promise<SearchPayload> => {
    const separator = key.indexOf("|");
    const keyword = separator === -1 ? key : key.slice(0, separator);
    const target = separator === -1 ? "" : key.slice(separator + 1);
    const data = await api.modrinthSearch(keyword, target === "" ? undefined : target, "mod");
    return { hits: normalizeHits(data) };
  }, []);

  const search = useKeyedFetch(submitted + "|" + versionId, searchLoader);

  const modsLoader = useCallback((id: string): Promise<ModFile[]> => {
    return api.mods(id).then((data) => data.mods);
  }, []);

  const mods = useKeyedFetch(versionId, modsLoader);

  const handleJobFinished = useCallback(
    (finishedJob: Job) => {
      setInstallingProject(null);
      if (finishedJob.state === "done") {
        toast.success("Mod 安装完成", { description: finishedJob.title });
        mods.reload();
      } else {
        toast.error("Mod 安装失败", { description: finishedJob.message });
      }
    },
    [mods],
  );

  const { job, live, reset } = useJobTracker(jobId, { onFinished: handleJobFinished });

  const handleInstall = useCallback(
    async (project: ModProject) => {
      if (versionId === "") {
        toast.error("先选一个实例", { description: "Mod 只能装到具体版本里。" });
        return;
      }
      setInstallingProject(project.id);
      reset();
      try {
        const result = await api.installMod(versionId, project.id);
        setJobId(result.jobId);
        toast.info("正在安装 " + project.title);
      } catch (cause: unknown) {
        setInstallingProject(null);
        toast.error("提交安装失败", { description: errorMessage(cause) });
      }
    },
    [versionId, reset],
  );

  const handleRemove = useCallback(
    async (file: ModFile) => {
      if (versionId === "") {
        return;
      }
      setRemovingFile(file.file);
      try {
        await api.removeMod(versionId, file.file);
        toast.success("已删除 " + file.name);
        mods.reload();
      } catch (cause: unknown) {
        toast.error("删除失败", { description: errorMessage(cause) });
      } finally {
        setRemovingFile(null);
      }
    },
    [versionId, mods],
  );

  const installed = mods.data ?? [];
  const totalSize = installed.reduce((sum, item) => sum + item.size, 0);
  const isFabric = versions.find((item) => item.id === versionId)?.kind === "fabric";
  const hits = search.data?.hits ?? [];

  return (
    <div data-motion-root>
      <PageHeader
        title="Mod 管理"
        description="从 Modrinth 搜索并安装 Mod，安装结果直接落到实例的 mods 目录。"
        action={
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : undefined} />
            刷新
          </Button>
        }
      />

      <div className="space-y-3">
        {backendDown ? <BackendNotice onRetry={reload} retrying={loading} /> : null}
        {error !== null && !backendDown ? (
          <ErrorAlert title="读取状态失败" message={error} onRetry={reload} />
        ) : null}

        <div className="card-soft flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3.5">
          <span className="text-xs text-muted-foreground">目标实例</span>
          {versions.length > 0 ? (
            <Select value={versionId} onValueChange={setPickedVersionId}>
              <SelectTrigger size="sm" className="min-w-44">
                <Boxes className="size-3.5 text-muted-foreground" />
                <SelectValue placeholder="选择实例" />
              </SelectTrigger>
              <SelectContent>
                {versions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Button variant="outline" size="sm" onClick={() => { navigate("/download"); }}>
              <Download />
              先装一个版本
            </Button>
          )}
          {isFabric ? (
            <Badge
              variant="outline"
              className="border-pcl-4/40 bg-pcl-8 text-pcl-3 dark:text-pcl-5"
            >
              Fabric 实例
            </Badge>
          ) : versionId !== "" ? (
            <Badge
              variant="outline"
              className="border-pcl-4/40 bg-pcl-7 text-pcl-2 dark:text-pcl-5"
            >
              原版实例，装 Mod 需先安装 Fabric
            </Badge>
          ) : null}
          <span className="ml-auto text-[11px] text-muted-foreground">
            下载源 {settings?.downloadSource === "bmcl" ? "BMCLAPI" : "Mojang"}
          </span>
        </div>

        <div className="card-soft rounded-2xl border border-border bg-card p-3.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => { setQuery(event.target.value); }}
              placeholder="搜索 Modrinth，例如 sodium / lithium / iris"
              className="h-9 pl-8"
            />
            {search.loading ? (
              <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            搜索结果按当前实例的游戏版本过滤；关键词留空时列出热门 Mod。
          </p>
        </div>

        {jobId !== null ? (
          <JobProgressCard
            job={job}
            live={live}
            waiting={job === null}
            title={job?.title ?? "安装 Mod"}
            onDismiss={() => {
              setJobId(null);
              reset();
            }}
          />
        ) : null}

        {search.error !== null ? (
          <ErrorAlert
            title="搜索失败"
            message={search.error}
            onRetry={search.reload}
            offline={backendDown}
          />
        ) : null}

        <div>
          <SectionHeader
            icon={Search}
            title="Modrinth 搜索结果"
            description={
              search.loading ? "正在搜索…" : hits.length > 0 ? hits.length + " 个结果" : undefined
            }
          />
          <div className="mt-2.5">
            {search.loading && hits.length === 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
            ) : hits.length === 0 ? (
              <EmptyState
                icon={SearchX}
                title={submitted === "" ? "还没有搜索结果" : "没搜到「" + submitted + "」"}
                description={
                  search.error !== null
                    ? "搜索接口暂时不可用，稍后重试；也可能是后端还没实现 /api/modrinth/search。"
                    : "换个关键词试试，Modrinth 上常见的优化 Mod 有 sodium、lithium、iris。"
                }
              />
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {hits.map((project) => (
                  <ModCard
                    key={project.id}
                    project={project}
                    installing={installingProject === project.id}
                    disabled={versionId === "" || installingProject !== null}
                    onInstall={() => { void handleInstall(project); }}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <SectionHeader
            icon={Package}
            title="已安装"
            description={
              versionId === ""
                ? "先选一个实例"
                : installed.length > 0
                  ? installed.length + " 个 Mod · 共 " + formatBytes(totalSize)
                  : "这个实例还没有 Mod"
            }
            action={
              <Button variant="ghost" size="xs" onClick={mods.reload} disabled={mods.loading}>
                <RefreshCw className={mods.loading ? "animate-spin" : undefined} />
                刷新
              </Button>
            }
          />
          <div className="mt-2.5">
            {mods.error !== null ? (
              <ErrorAlert
                title="读取已装 Mod 失败"
                message={mods.error}
                onRetry={mods.reload}
                offline={backendDown}
              />
            ) : mods.loading && installed.length === 0 ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full rounded-xl" />
                <Skeleton className="h-12 w-full rounded-xl" />
              </div>
            ) : installed.length === 0 ? (
              <EmptyState
                icon={Puzzle}
                title={versionId === "" ? "还没有选择实例" : "这个实例没有 Mod"}
                description={
                  versionId === ""
                    ? "选一个实例后就能看到它 mods 目录里的内容。"
                    : "在上面搜索并安装，Mod 会直接下载到该实例的 mods 目录。"
                }
              />
            ) : (
              <ul className="space-y-2">
                {installed.map((file) => (
                  <li
                    key={file.file}
                    className="card-soft flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-pcl-7 text-pcl-2 dark:text-pcl-5">
                      <Puzzle className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{file.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground" title={file.file}>
                        {file.file} · {formatBytes(file.size)}
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="icon-xs"
                      disabled={removingFile === file.file}
                      onClick={() => { void handleRemove(file); }}
                      aria-label={"删除 " + file.name}
                    >
                      {removingFile === file.file ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface ModCardProps {
  project: ModProject;
  installing: boolean;
  disabled: boolean;
  onInstall: () => void;
}

function ModCard({ project, installing, disabled, onInstall }: ModCardProps) {
  const [iconFailed, setIconFailed] = useState(false);
  const showIcon = project.iconUrl !== null && !iconFailed;

  return (
    <li className="card-soft flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-2.5">
        {showIcon ? (
          <img
            src={project.iconUrl ?? ""}
            alt=""
            loading="lazy"
            onError={() => { setIconFailed(true); }}
            className="size-10 shrink-0 rounded-lg object-cover ring-1 ring-border"
          />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Puzzle className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" title={project.title}>
            {project.title}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {project.author} · {formatDownloads(project.downloads)} 次下载
          </p>
        </div>
      </div>

      <p className="line-clamp-2 min-h-8 text-[11px] leading-relaxed text-muted-foreground">
        {project.description === "" ? "（没有简介）" : project.description}
      </p>

      <div className="mt-auto flex items-center gap-1.5">
        {project.categories.slice(0, 2).map((category) => (
          <Badge key={category} variant="secondary" className="h-4 px-1.5 text-[10px]">
            {category}
          </Badge>
        ))}
        <Button size="xs" className={cn("ml-auto shrink-0")} disabled={disabled} onClick={onInstall}>
          {installing ? <Loader2 className="animate-spin" /> : <Download />}
          {installing ? "安装中" : "安装"}
        </Button>
      </div>
    </li>
  );
}
