import { useCallback, useMemo, useState } from "react";
import {
  Boxes,
  ChevronDown,
  Coffee,
  Download,
  FileClock,
  Loader2,
  Play,
  RotateCw,
  Star,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { BackendNotice } from "@/components/backend-notice";
import { ErrorAlert } from "@/components/error-alert";
import { VersionAvatar } from "@/components/version-avatar";
import { VersionKindBadge } from "@/components/version-badge";
import { useAppData } from "@/context/app-data-context";
import { api, errorMessage, type VersionInfo } from "@/lib/api";
import { formatDateTime, formatSince, shortenMiddle } from "@/lib/format";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

type SortKey = "installed" | "name" | "kind";

/** 版本管理：已装实例列表 + 展开详情 + 删除 + 设为当前。 */
export function VersionsPage() {
  const { versions, settings, running, loading, error, backendDown, reload, patchVersions, saveSettings } =
    useAppData();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<VersionInfo | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"delete" | "select" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("installed");

  const selectedId = settings?.selectVersion ?? versions[0]?.id ?? null;

  const sorted = useMemo(() => {
    const list = versions.slice();
    list.sort((a, b) => {
      if (sort === "name") {
        return a.id.localeCompare(b.id);
      }
      if (sort === "kind") {
        if (a.kind === b.kind) {
          return a.id.localeCompare(b.id);
        }
        return a.kind === "fabric" ? -1 : 1;
      }
      const at = typeof a.installedAt === "number" ? a.installedAt : 0;
      const bt = typeof b.installedAt === "number" ? b.installedAt : 0;
      return bt - at;
    });
    return list;
  }, [versions, sort]);

  const runningIds = useMemo(
    () => new Set(running.map((item) => item.versionId).filter((id) => id !== "")),
    [running],
  );

  const handleDelete = useCallback(
    async (target: VersionInfo) => {
      setBusyId(target.id);
      setBusyAction("delete");
      setActionError(null);
      try {
        await api.deleteVersion(target.id);
        patchVersions((list) => list.filter((item) => item.id !== target.id));
        toast.success("已删除 " + target.id);
        setDeleting(null);
      } catch (cause: unknown) {
        setActionError(errorMessage(cause));
        toast.error("删除失败", { description: errorMessage(cause) });
      } finally {
        setBusyId(null);
        setBusyAction(null);
      }
    },
    [patchVersions],
  );

  const handleSelect = useCallback(
    async (target: VersionInfo) => {
      setBusyId(target.id);
      setBusyAction("select");
      setActionError(null);
      try {
        await saveSettings({ selectVersion: target.id });
        toast.success("已设为当前版本", { description: target.id });
      } catch (cause: unknown) {
        setActionError(errorMessage(cause));
        toast.error("设置失败", { description: errorMessage(cause) });
      } finally {
        setBusyId(null);
        setBusyAction(null);
      }
    },
    [saveSettings],
  );

  return (
    <div>
      <PageHeader
        title="版本管理"
        description="已安装的客户端实例；原版直接可用，Fabric 复用父版本的资源与库。"
        action={
          <>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RotateCw className={loading ? "animate-spin" : undefined} />
              刷新
            </Button>
            <Button size="sm" onClick={() => { navigate("/download"); }}>
              <Download />
              安装新版本
            </Button>
          </>
        }
      />

      <div className="space-y-3">
        {backendDown ? <BackendNotice onRetry={reload} retrying={loading} /> : null}
        {error !== null && !backendDown ? (
          <ErrorAlert title="读取版本列表失败" message={error} onRetry={reload} />
        ) : null}

        {versions.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              共 <span className="font-semibold text-foreground">{versions.length}</span> 个实例
              {selectedId !== null ? " · 当前 " + selectedId : ""}
            </p>
            <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
              {(
                [
                  { key: "installed", label: "安装时间" },
                  { key: "name", label: "名称" },
                  { key: "kind", label: "类型" },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => { setSort(item.key); }}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                    sort === item.key
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading && versions.length === 0 ? (
          <>
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </>
        ) : sorted.length === 0 && !backendDown && error === null ? (
          <EmptyState
            icon={Boxes}
            tone="brand"
            title="还没有安装任何版本"
            description="到「下载」页挑一个正式版，装好后会自动出现在这里；也可以顺便勾选同时安装 Fabric。"
            action={
              <Button onClick={() => { navigate("/download"); }}>
                <Download />
                去下载版本
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2.5">
            {sorted.map((version) => (
              <VersionRow
                key={version.id}
                version={version}
                selected={version.id === selectedId}
                expanded={expanded === version.id}
                running={runningIds.has(version.id)}
                busy={busyId === version.id}
                busyAction={busyId === version.id ? busyAction : null}
                onToggle={() => {
                  setExpanded((previous) => (previous === version.id ? null : version.id));
                }}
                onSelect={() => { void handleSelect(version); }}
                onDelete={() => {
                  setActionError(null);
                  setDeleting(version);
                }}
                onLaunch={() => { navigate("/"); }}
                onMods={() => { navigate("/mods"); }}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-4 text-destructive" />
              删除实例 {deleting?.id}
            </DialogTitle>
            <DialogDescription>
              会删除该版本的客户端目录（version json / jar / natives / mods）。全局 libraries 与 assets
              会保留，其它版本不受影响。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          {actionError !== null ? <ErrorAlert title="删除失败" message={actionError} /> : null}
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              disabled={busyAction === "delete"}
              onClick={() => {
                if (deleting !== null) {
                  void handleDelete(deleting);
                }
              }}
            >
              {busyAction === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface VersionRowProps {
  version: VersionInfo;
  selected: boolean;
  expanded: boolean;
  running: boolean;
  busy: boolean;
  busyAction: "delete" | "select" | null;
  onToggle: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onLaunch: () => void;
  onMods: () => void;
}

function VersionRow({
  version,
  selected,
  expanded,
  running,
  busy,
  busyAction,
  onToggle,
  onSelect,
  onDelete,
  onLaunch,
  onMods,
}: VersionRowProps) {
  return (
    <li
      className={cn(
        "card-soft overflow-hidden rounded-2xl border bg-card transition-colors",
        selected ? "border-primary/45" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3.5">
        <VersionAvatar kind={version.kind} label={version.id} size="md" />

        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{version.id}</span>
            <VersionKindBadge kind={version.kind} />
            {selected ? (
              <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-primary">
                <Star />
                当前
              </Badge>
            ) : null}
            {running ? (
              <Badge
                variant="outline"
                className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                <span className="size-1.5 rounded-full bg-emerald-500" />
                运行中
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            基础版本 {version.baseVersion} · Java {version.javaMajor || "?"} · 安装于{" "}
            {formatSince(version.installedAt)}
          </p>
        </button>

        <div className="flex items-center gap-1.5">
          {!selected ? (
            <Button variant="outline" size="xs" onClick={onSelect} disabled={busy}>
              {busyAction === "select" ? <Loader2 className="animate-spin" /> : <Star />}
              设为当前
            </Button>
          ) : (
            <Button variant="ghost" size="xs" onClick={onLaunch}>
              <Play />
              启动
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            onClick={onToggle}
            aria-label={expanded ? "收起详情" : "展开详情"}
          >
            <ChevronDown className={cn("transition-transform", expanded ? "rotate-180" : "")} />
          </Button>
          <Button
            variant="destructive"
            size="icon-xs"
            onClick={onDelete}
            disabled={busy}
            aria-label={"删除 " + version.id}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-border bg-muted/25 px-3.5 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow icon={FileClock} label="安装时间" value={formatDateTime(version.installedAt)} />
            <DetailRow icon={Coffee} label="Java 主版本" value={"Java " + (version.javaMajor || "未知")} />
            <DetailRow icon={Boxes} label="实例目录" value={"versions/" + version.id} mono />
            <DetailRow
              icon={Download}
              label="资源复用"
              value={version.kind === "fabric" ? "复用 " + version.baseVersion + " 的 jar 与资源" : "独立 jar 与资源"}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="xs" onClick={onLaunch}>
              <Play />
              去主页启动
            </Button>
            <Button variant="outline" size="xs" onClick={onMods}>
              管理 Mod
            </Button>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              id: {shortenMiddle(version.id, 30)}
            </span>
          </div>
        </div>
      ) : null}
    </li>
  );
}

interface DetailRowProps {
  icon: typeof Coffee;
  label: string;
  value: string;
  mono?: boolean;
}

function DetailRow({ icon: Icon, label, value, mono = false }: DetailRowProps) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={cn("truncate text-xs font-medium", mono ? "font-mono" : "")} title={value}>
          {value}
        </p>
      </div>
    </div>
  );
}
