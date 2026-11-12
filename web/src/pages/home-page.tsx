import { useCallback, useRef, useState } from "react";
import { Boxes, CircleAlert, Cpu, FileClock, Globe, Loader2, Play, Power, RotateCw, Settings2, ShieldCheck, Sparkles, Square, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { SkinAvatar } from "@/components/skin-avatar";
import { LaunchButton } from "@/components/launch-button";
import { VersionAvatar } from "@/components/version-avatar";
import { VersionKindBadge } from "@/components/version-badge";
import { JavaStatusCard } from "@/components/java-status-card";
import { RemoteLatestCard } from "@/components/remote-latest-card";
import { JobProgressCard } from "@/components/job-progress-card";
import { BackendNotice } from "@/components/backend-notice";
import { useAppData } from "@/context/app-data-context";
import { api, errorMessage, type AccountSkin, type Job, type VersionInfo } from "@/lib/api";
import { loadAccountSkinByKey, skinKeyFor } from "@/lib/account-skin";
import { formatMemory, formatSince } from "@/lib/format";
import { navigate } from "@/lib/router";
import { pickPid, tailLogs, useJobTracker } from "@/lib/use-job";
import { cn } from "@/lib/utils";
import { useKeyedFetch } from "@/lib/use-keyed-fetch";

const LOG_CACHE_KEY = "lycomc.home.logTail";

/** 读上次缓存的日志尾部（首屏直接初始化，避免 effect 里 setState）。 */
function readCachedLogTail(): string[] {
  try {
    const cached = window.sessionStorage.getItem(LOG_CACHE_KEY);
    if (cached === null) {
      return [];
    }
    const parsed: unknown = JSON.parse(cached);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((line): line is string => typeof line === "string");
  } catch {
    return [];
  }
}

/** 主页：当前版本 + 账号 + 巨型启动按钮 + 远程/Java 侧栏。 */
export function HomePage() {
  const {
    versions,
    accounts,
    settings,
    running,
    javas,
    remote,
    loading,
    error,
    backendDown,
    reload,
    reloadRemote,
    remoteLoading,
    remoteError,
    selectedVersion,
    currentAccount,
    saveSettings,
  } = useAppData();

  // 账号：用户没手动挑过就跟随全局第一个（派生，无需 effect）
  const [pickedAccount, setPickedAccount] = useState<string | null>(null);
  const accountName = pickedAccount ?? currentAccount?.name ?? "";
  const skinKey = currentAccount !== null ? skinKeyFor(currentAccount) : "";
  const { data: skin } = useKeyedFetch<AccountSkin>(skinKey, loadAccountSkinByKey);
  const skinUrl = skin?.skinUrl ?? currentAccount?.skinUrl ?? null;
  const skinModel = skin?.skinModel ?? currentAccount?.skinModel ?? "classic";
  const useBuiltinFallback = skin?.fallback === true;

  const [launching, setLaunching] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [killing, setKilling] = useState(false);
  const [logTail, setLogTail] = useState<string[]>(readCachedLogTail);
  const [logError, setLogError] = useState<string | null>(null);

  const version = selectedVersion;
  const hasVersion = version !== null;
  const isRunning = running.length > 0;
  const runningEntry = running[0] ?? null;

  // 供异步回调读到最新版本（回调里闭包可能是旧值）
  const versionRef = useRef<VersionInfo | null>(version);

  // 启动完成：刷新全局状态 + 拉日志尾部（回调里做事，不在 effect 里同步 setState）
  const handleLaunchFinished = useCallback(
    (finishedJob: Job) => {
      setLaunching(false);
      reload();
      if (finishedJob.state === "done") {
        toast.success("游戏已启动", { description: finishedJob.title });
      } else {
        toast.error("启动失败", { description: finishedJob.message });
      }
      const target = versionRef.current;
      if (target === null) {
        return;
      }
      api
        .logs(target.id)
        .then((data) => {
          const tail = data.lines.slice(-80);
          setLogTail(tail);
          setLogError(null);
          try {
            window.sessionStorage.setItem(LOG_CACHE_KEY, JSON.stringify(tail));
          } catch {
            // 存储不可用时忽略
          }
        })
        .catch((cause: unknown) => {
          setLogError(errorMessage(cause));
        });
    },
    [reload],
  );

  const { job, live, error: jobError, reset } = useJobTracker(jobId, {
    onFinished: handleLaunchFinished,
  });

  const pid = (runningEntry?.pid ?? pickPid(job?.result ?? null)) || null;
  const memoryMb = settings?.memoryMb;

  const handleLaunch = useCallback(async () => {
    if (version === null) {
      toast.error("先选一个版本", { description: "去「版本管理」装一个原版或 Fabric 实例。" });
      return;
    }
    if (accountName === "") {
      toast.error("还没有账号", { description: "去「设置 → 账号与皮肤」添加账号或进行微软正版登录。" });
      navigate("/settings");
      return;
    }
    setLaunching(true);
    setLogError(null);
    reset();
    try {
      const result = await api.launch(version.id, accountName, memoryMb);
      setJobId(result.jobId);
      toast.info("已提交启动任务", { description: "正在准备客户端…" });
    } catch (cause: unknown) {
      setLaunching(false);
      toast.error("提交启动失败", { description: errorMessage(cause) });
    }
  }, [version, accountName, memoryMb, reset]);

  const handleKill = useCallback(async () => {
    if (pid === null) {
      toast.error("找不到进程号", { description: "后端没有返回 pid，试试刷新页面。" });
      return;
    }
    setKilling(true);
    try {
      await api.kill(pid);
      toast.success("已结束进程 " + pid);
      reload();
    } catch (cause: unknown) {
      toast.error("结束进程失败", { description: errorMessage(cause) });
    } finally {
      setKilling(false);
    }
  }, [pid, reload]);

  const handleSelectVersion = useCallback(
    async (id: string) => {
      try {
        await saveSettings({ selectVersion: id });
        toast.success("已切换当前版本", { description: id });
      } catch (cause: unknown) {
        toast.error("切换失败", { description: errorMessage(cause) });
      }
    },
    [saveSettings],
  );

  const logLines = tailLogs(job, logTail);

  if (loading && !hasVersion && versions.length === 0) {
    return <HomeSkeleton />;
  }

  return (
    <div className="space-y-5">
      {backendDown ? <BackendNotice onRetry={reload} retrying={loading} /> : null}
      {error !== null && !backendDown ? (
        <div className="card-soft flex items-center gap-2 rounded-xl border border-destructive/30 bg-card px-3 py-2 text-sm text-destructive">
          <CircleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">读取状态失败：{error}</span>
          <Button variant="outline" size="xs" onClick={reload}>
            <RotateCw />
            重试
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-5 xl:flex-row">
        <aside className="w-full shrink-0 xl:w-[320px]">
          <div className="card-soft flex min-h-[560px] flex-col items-center rounded-2xl border border-border bg-card px-6 py-8">
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <SkinAvatar
                skinUrl={skinUrl}
                model={skinModel}
                size={96}
                fallback={useBuiltinFallback}
                title={"当前账号 " + accountName + " 的皮肤头像"}
                className="size-24 rounded-2xl ring-2 ring-pcl-6"
              />
              <p className="mt-5 text-xl font-semibold tracking-tight text-foreground">
                {accountName === "" ? "未登录" : accountName}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 text-primary" />
                {currentAccount?.kind === "microsoft" ? "正版验证" : "离线账号"}
              </p>

              <div className="mt-6 w-full space-y-2">
                {versions.length > 0 ? (
                  <Select
                    value={version?.id ?? ""}
                    onValueChange={(value) => { void handleSelectVersion(value); }}
                  >
                    <SelectTrigger size="sm" className="w-full justify-start bg-pcl-8/60 dark:bg-muted">
                      <Boxes className="size-3.5 text-primary" />
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
                ) : null}

                {accounts.length > 0 ? (
                  <Select value={accountName} onValueChange={setPickedAccount}>
                    <SelectTrigger size="sm" className="w-full justify-start bg-pcl-8/60 dark:bg-muted">
                      <UserRound className="size-3.5 text-primary" />
                      <SelectValue placeholder="选择账号" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((item) => (
                        <SelectItem key={item.name} value={item.name}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Button variant="outline" size="sm" className="w-full" onClick={() => { navigate("/settings"); }}>
                    <UserRound />
                    添加账号
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-7 w-full space-y-2.5">
              <LaunchButton
                onClick={() => { void handleLaunch(); }}
                disabled={!hasVersion || (isRunning && !launching)}
                launching={launching && (job === null || job.state === "running")}
                running={isRunning}
                label={isRunning ? "游戏正在运行" : "启动游戏"}
                hint={hasVersion ? version.id + " · " + formatMemory(settings?.memoryMb ?? null) : undefined}
              />
              <div className="grid grid-cols-2 gap-2.5">
                <Button variant="outline" size="lg" className="h-10" onClick={() => { navigate("/versions"); }}>
                  <Boxes />
                  实例选择
                </Button>
                <Button variant="outline" size="lg" className="h-10" onClick={() => { navigate("/settings"); }}>
                  <Settings2 />
                  实例设置
                </Button>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1 space-y-5">
          <WelcomeCard />
          <LaunchOverviewCard
            version={version}
            runningCount={running.length}
            memoryMb={settings?.memoryMb ?? null}
            downloadSource={settings?.downloadSource ?? "mojang"}
          />

          <div className="grid gap-5 lg:grid-cols-2">
            <RemoteLatestCard
              remote={remote}
              loading={remoteLoading}
              error={remoteError}
              onRefresh={() => { reloadRemote(true); }}
            />
            <JavaStatusCard
              javas={javas}
              loading={loading}
              requiredMajor={version?.javaMajor}
              javaPath={settings?.javaPath ?? null}
            />
          </div>

          <QuickSettingsCard
            memoryMb={settings?.memoryMb ?? null}
            downloadSource={settings?.downloadSource ?? "mojang"}
            closeOnLaunch={settings?.closeOnLaunch ?? false}
          />

          {isRunning || jobId !== null ? (
            <div className="card-soft rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex size-2.5 animate-ping rounded-full bg-pcl-3 opacity-70" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-pcl-3" />
                  </span>
                  <p className="text-sm font-semibold">
                    {isRunning ? "游戏运行中" : "启动中"}
                  </p>
                  {runningEntry !== null ? (
                    <Badge variant="outline" className="gap-1 font-mono text-[10px]">
                      PID {runningEntry.pid}
                    </Badge>
                  ) : null}
                  {runningEntry !== null && runningEntry.versionId !== "" ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {runningEntry.versionId}
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={reload}>
                    <RotateCw />
                    刷新状态
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => { void handleKill(); }}
                    disabled={killing || pid === null}
                  >
                    {killing ? <Loader2 className="animate-spin" /> : <Square />}
                    结束进程
                  </Button>
                </div>
              </div>
              {pid === null ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  后端暂未提供进程 pid（<code className="font-mono">running[]</code> 为空、job.result 也没带
                  pid），此时无法结束进程。
                </p>
              ) : null}
            </div>
          ) : null}

          {jobId !== null ? (
            <JobProgressCard
              job={job}
              logs={logLines}
              live={live}
              waiting={job === null}
              title={job?.title ?? "启动 " + (version?.id ?? "")}
              onDismiss={() => {
                setJobId(null);
                reset();
              }}
              footer={
                job?.state === "error" && jobError !== null ? (
                  <span className="text-xs text-destructive">{jobError}</span>
                ) : null
              }
            />
          ) : null}

          {logLines.length > 0 && jobId === null ? (
            <LogTailCard lines={logLines} versionId={version?.id ?? ""} error={logError} />
          ) : null}

          {versions.length === 0 && !loading ? (
            <EmptyState
              icon={Play}
              tone="brand"
              title="还没有安装任何版本"
              description="先去「下载」页装一个原版（推荐 1.20.1），也可以顺手勾上 Fabric。"
              action={
                <Button onClick={() => { navigate("/download"); }}>
                  <Play />
                  去下载
                </Button>
              }
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
interface LaunchOverviewCardProps {
  version: VersionInfo | null;
  runningCount: number;
  memoryMb: number | null;
  downloadSource: "mojang" | "bmcl";
}

/** 欢迎卡：对应 PCL.Proto 首页右上方的说明卡，文案与代码全自研。 */
function WelcomeCard() {
  return (
    <div className="card-soft rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-pcl-7 text-primary dark:bg-muted">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-primary">欢迎来到 LilyCraft!</h2>
          <div className="mt-2 rounded-lg border-l-[3px] border-primary bg-pcl-8/70 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground dark:bg-muted/60">
            选择实例与账号，一键启动 Minecraft；下载、Mod、Java 与设置都收纳在左侧导航中。
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            本项目使用 lilyco 内核与自研 shadcn 界面，视觉层级参考 PCL.Proto 的蓝色卡片布局，未复用其代码或资源。
          </p>
        </div>
      </div>
    </div>
  );
}

/** 右栏概览：把旧版大 Hero 拆成 PCL 风的双列信息卡。 */
function LaunchOverviewCard({
  version,
  runningCount,
  memoryMb,
  downloadSource,
}: LaunchOverviewCardProps) {
  return (
    <div className="card-soft rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="brand-gradient h-4 w-1 rounded-full" />
        <h2 className="text-sm font-semibold text-primary">启动选项</h2>
        {runningCount > 0 ? (
          <Badge variant="outline" className="gap-1 border-pcl-4/50 bg-pcl-7 text-pcl-2 dark:text-pcl-5">
            <span className="size-1.5 rounded-full bg-pcl-3" />
            运行中
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-pcl-8/50 p-3 dark:bg-pcl-8/50 dark:bg-muted/40">
          {version !== null ? (
            <VersionAvatar kind={version.kind} label={version.id} size="sm" />
          ) : (
            <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <CircleAlert className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">当前实例</p>
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-semibold">{version !== null ? version.id : "未选择版本"}</p>
              {version !== null ? <VersionKindBadge kind={version.kind} /> : null}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-pcl-8/50 p-3 dark:bg-pcl-8/50 dark:bg-muted/40">
          <span className="flex size-10 items-center justify-center rounded-xl bg-card text-primary ring-1 ring-border">
            <Cpu className="size-5" />
          </span>
          <div>
            <p className="text-[11px] text-muted-foreground">Java 主版本</p>
            <p className="text-sm font-semibold">
              {version !== null ? "Java " + (version.javaMajor || "?") : "未选择"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-pcl-8/50 p-3 dark:bg-pcl-8/50 dark:bg-muted/40">
          <span className="flex size-10 items-center justify-center rounded-xl bg-card text-primary ring-1 ring-border">
            <Sparkles className="size-5" />
          </span>
          <div>
            <p className="text-[11px] text-muted-foreground">分配内存</p>
            <p className="font-mono text-sm font-semibold">{formatMemory(memoryMb)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-border bg-pcl-8/50 p-3 dark:bg-pcl-8/50 dark:bg-muted/40">
          <span className="flex size-10 items-center justify-center rounded-xl bg-card text-primary ring-1 ring-border">
            <Globe className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">下载源</p>
            <p className="truncate text-sm font-semibold">
              {downloadSource === "bmcl" ? "BMCLAPI 国内镜像" : "Mojang 官方"}
            </p>
          </div>
        </div>
      </div>

      {version !== null ? (
        <p className="mt-3 text-xs text-muted-foreground">
          基础版本 {version.baseVersion}
          {version.installedAt ? " · 安装于 " + formatSince(version.installedAt) : ""}
        </p>
      ) : null}
    </div>
  );
}
interface LogTailCardProps {
  lines: string[];
  versionId: string;
  error: string | null;
}

/** 启动成功后的日志尾部（PCL 把日志放在主界面下方）。 */
function LogTailCard({ lines, versionId, error }: LogTailCardProps) {
  return (
    <div className="card-soft overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <FileClock className="size-4 text-muted-foreground" />
          最近日志
          <span className="font-mono text-[11px] text-muted-foreground">{versionId}</span>
        </div>
        <Badge variant="ghost" className="text-[10px] text-muted-foreground">
          尾 80 行
        </Badge>
      </div>
      {error !== null ? (
        <p className="px-4 py-3 text-xs text-destructive">读取日志失败：{error}</p>
      ) : (
        <div className="max-h-56 overflow-y-auto bg-pcl-8/50 dark:bg-muted/40 px-4 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {lines.slice(-80).map((line, index) => (
            <div key={index} className="break-all">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface QuickSettingsCardProps {
  memoryMb: number | null;
  downloadSource: "mojang" | "bmcl";
  closeOnLaunch: boolean;
}

function QuickSettingsCard({ memoryMb, downloadSource, closeOnLaunch }: QuickSettingsCardProps) {
  return (
    <div className="card-soft rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold text-primary">启动选项</p>
      <div className="mt-2.5 space-y-1.5 text-xs">
        <Row label="内存" value={formatMemory(memoryMb)} />
        <Separator />
        <Row label="下载源" value={downloadSource === "bmcl" ? "BMCLAPI（国内镜像）" : "Mojang 官方"} />
        <Separator />
        <Row label="启动后关闭启动器" value={closeOnLaunch ? "是" : "否"} />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="mt-3 w-full"
        onClick={() => { navigate("/settings"); }}
      >
        <Power />
        打开设置
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("truncate font-medium")}>{value}</span>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-5 xl:flex-row">
      <Skeleton className="h-[560px] w-full rounded-2xl xl:w-[320px]" />
      <div className="min-w-0 flex-1 space-y-5">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
      </div>
    </div>
  );
}
