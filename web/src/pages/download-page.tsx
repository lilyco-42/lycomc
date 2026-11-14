import { useCallback, useMemo, useState } from "react";
import { Download, Layers, Loader2, RefreshCw, Search, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { BackendNotice } from "@/components/backend-notice";
import { ErrorAlert } from "@/components/error-alert";
import { JobProgressCard } from "@/components/job-progress-card";
import { useAppData } from "@/context/app-data-context";
import { api, errorMessage, type Job, type RemoteVersion } from "@/lib/api";
import { formatDate, versionTypeLabel } from "@/lib/format";
import { navigate } from "@/lib/router";
import { useJobTracker } from "@/lib/use-job";
import { cn } from "@/lib/utils";

type TypeFilter = "all" | "release" | "snapshot";

const PAGE_SIZE = 40;

/** 下载页：可下载版本列表 + 类型过滤 + 搜索 + 安装进度（实时显示）。 */
export function DownloadPage() {
  const { remote, remoteLoading, remoteError, reloadRemote, reload, versions, backendDown, loading } =
    useAppData();

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("release");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [withFabric, setWithFabric] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 安装完成：刷新已装列表 + 提示（回调里做，不在 effect 里同步 setState）
  const handleInstallFinished = useCallback(
    (finishedJob: Job) => {
      setInstallingId(null);
      reload();
      if (finishedJob.state === "done") {
        toast.success("安装完成", { description: finishedJob.title });
      } else {
        toast.error("安装失败", { description: finishedJob.message });
      }
    },
    [reload],
  );

  const { job, live, reset } = useJobTracker(jobId, { onFinished: handleInstallFinished });

  const installedIds = useMemo(() => new Set(versions.map((item) => item.id)), [versions]);

  const filtered = useMemo<RemoteVersion[]>(() => {
    const list = remote?.versions ?? [];
    const keyword = query.trim().toLowerCase();
    return list.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) {
        return false;
      }
      if (keyword !== "" && !item.id.toLowerCase().includes(keyword)) {
        return false;
      }
      return true;
    });
  }, [remote?.versions, typeFilter, query]);

  const visible = filtered.slice(0, limit);

  const handleInstall = useCallback(
    async (version: RemoteVersion) => {
      setSubmitError(null);
      setInstallingId(version.id);
      reset();
      try {
        const targetId = withFabric ? "fabric-" + version.id : version.id;
        const result = await api.installVersion(version.id, withFabric);
        setJobId(result.jobId);
        toast.info("开始安装 " + targetId, {
          description: withFabric ? "原版 + Fabric 会合并为一个实例" : undefined,
        });
      } catch (cause: unknown) {
        setInstallingId(null);
        setSubmitError(errorMessage(cause));
        toast.error("提交安装失败", { description: errorMessage(cause) });
      }
    },
    [withFabric, reset],
  );

  const counts = useMemo(() => {
    const list = remote?.versions ?? [];
    return {
      all: list.length,
      release: list.filter((item) => item.type === "release").length,
      snapshot: list.filter((item) => item.type === "snapshot").length,
    };
  }, [remote?.versions]);

  return (
    <div data-motion-root>
      <PageHeader
        title="下载"
        description="从 Mojang 版本清单拉取所有正式版与快照，安装后立即出现在「版本管理」。"
        action={
          <Button variant="outline" size="sm" onClick={() => { reloadRemote(true); }} disabled={remoteLoading}>
            <RefreshCw className={remoteLoading ? "animate-spin" : undefined} />
            刷新清单
          </Button>
        }
      />

      <div className="space-y-3">
        {backendDown ? <BackendNotice onRetry={reload} retrying={loading} /> : null}
        {remoteError !== null ? (
          <ErrorAlert
            title="获取远程版本失败"
            message={remoteError}
            onRetry={() => { reloadRemote(true); }}
            offline={backendDown}
          />
        ) : null}
        {submitError !== null ? <ErrorAlert title="提交安装失败" message={submitError} /> : null}

        <div className="card-soft rounded-2xl border border-border bg-card p-4">
          <SectionHeader
            icon={Sparkles}
            title="最新版本"
            description={"已获取 " + counts.all + " 个远程版本"}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-pcl-8/50 p-3 dark:bg-muted/40">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pcl-7 text-pcl-2 dark:bg-muted dark:text-pcl-5">
                <Sparkles className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">最新正式版</p>
                <p className="truncate font-mono text-sm font-semibold text-pcl-2">
                  {remote?.latest.release || "未知"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-pcl-8/50 p-3 dark:bg-muted/40">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pcl-7 text-pcl-3 dark:bg-muted dark:text-pcl-6">
                <Layers className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">最新快照</p>
                <p className="truncate font-mono text-sm font-semibold text-pcl-3">
                  {remote?.latest.snapshot || "未知"}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="card-soft rounded-2xl border border-border bg-card p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setLimit(PAGE_SIZE);
                }}
                placeholder="搜索版本号，例如 1.20.1 / 24w14a"
                className="h-9 bg-pcl-8/50 pl-8"
              />
            </div>
            <div className="grid w-full grid-cols-3 gap-1 rounded-lg bg-pcl-7 p-1 dark:bg-muted sm:w-auto">
              {(
                [
                  { key: "release", label: "正式版", count: counts.release },
                  { key: "snapshot", label: "快照", count: counts.snapshot },
                  { key: "all", label: "全部", count: counts.all },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setTypeFilter(item.key);
                    setLimit(PAGE_SIZE);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    typeFilter === item.key
                      ? "bg-card text-primary shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  <span className="font-mono text-[10px] opacity-70">{item.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-2.5">
              <Switch id="with-fabric" checked={withFabric} onCheckedChange={setWithFabric} />
              <Label htmlFor="with-fabric" className="gap-1.5 text-xs font-normal">
                <Layers className="size-3.5 text-primary" />
                同时安装 Fabric
              </Label>
              <span className="text-[11px] text-muted-foreground">
                装成 {withFabric ? "fabric-<版本>-<loader>" : "<版本>"} 实例
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {remote?.latest.release ? "最新正式版 " + remote.latest.release : "—"}
              {remote?.latest.snapshot ? " · 最新快照 " + remote.latest.snapshot : ""}
            </p>
          </div>
        </div>

        {jobId !== null ? (
          <JobProgressCard
            job={job}
            live={live}
            waiting={job === null}
            title={job?.title ?? "安装 " + (installingId ?? "")}
            onDismiss={() => {
              setJobId(null);
              reset();
            }}
            footer={
              job?.state === "done" ? (
                <Button variant="outline" size="sm" onClick={() => { navigate("/versions"); }}>
                  去版本管理看看
                </Button>
              ) : job?.state === "error" ? (
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="size-3.5" />
                  可以换一个下载源再试（设置 → 下载源）
                </span>
              ) : null
            }
          />
        ) : null}

        {remoteLoading && remote === null ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={remote === null ? Sparkles : Search}
            title={remote === null ? "还没有远程版本数据" : "没有匹配的版本"}
            description={
              remote === null
                ? "点右上角「刷新清单」从 Mojang 拉一次版本列表；后端未就绪时会一直为空。"
                : "换个关键词，或者把过滤切到「全部」再找找。"
            }
            action={
              remote === null ? (
                <Button onClick={() => { reloadRemote(true); }} disabled={remoteLoading}>
                  {remoteLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  拉取版本清单
                </Button>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    setTypeFilter("all");
                  }}
                >
                  清空筛选
                </Button>
              )
            }
          />
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {visible.map((version) => {
                const installed = installedIds.has(version.id);
                const busy = installingId === version.id;
                return (
                  <li
                    key={version.id}
                    className={cn(
                      "card-soft flex items-center gap-2.5 rounded-xl border bg-card px-3 py-2.5",
                      busy ? "border-primary/50" : "border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-semibold",
                        version.type === "release"
                          ? "bg-pcl-7 text-pcl-2 dark:bg-muted dark:text-pcl-6"
                          : "bg-pcl-8 text-pcl-3 dark:bg-muted dark:text-pcl-5",
                      )}
                    >
                      {version.type === "release" ? "R" : "S"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-mono text-sm font-medium">{version.id}</span>
                        {installed ? (
                          <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px] text-pcl-2 dark:text-pcl-5">
                            已安装
                          </Badge>
                        ) : null}
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {versionTypeLabel(version.type)} · {formatDate(version.releaseTime)}
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant={installed ? "outline" : "default"}
                      disabled={busy || installingId !== null}
                      onClick={() => { void handleInstall(version); }}
                    >
                      {busy ? <Loader2 className="animate-spin" /> : <Download />}
                      {busy ? "安装中" : installed ? "重装" : "安装"}
                    </Button>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <p className="text-[11px] text-muted-foreground">
                显示 {visible.length} / {filtered.length} 个版本
              </p>
              {visible.length < filtered.length ? (
                <Button variant="outline" size="xs" onClick={() => { setLimit((value) => value + PAGE_SIZE); }}>
                  加载更多
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
