import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Boxes,
  ChevronDown,
  Coffee,
  Download,
  FileClock,
  Languages,
  Loader2,
  Pencil,
  Play,
  RotateCw,
  Save,
  Settings2,
  ShieldCheck,
  Star,
  Trash2,
  Undo2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
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
import { SectionHeader } from "@/components/section-header";
import { BackendNotice } from "@/components/backend-notice";
import { ErrorAlert } from "@/components/error-alert";
import { JobProgressCard } from "@/components/job-progress-card";
import { VersionAvatar } from "@/components/version-avatar";
import { VersionKindBadge } from "@/components/version-badge";
import { useAppData } from "@/context/app-data-context";
import {
  api,
  errorMessage,
  isBackendDown,
  isRecord,
  type InstanceMeta,
  type Job,
  type Settings,
  type VersionInfo,
  type VersionSettingsResponse,
} from "@/lib/api";
import {
  GAME_LANGS,
  formatDateTime,
  formatMemory,
  formatSince,
  gameLangLabel,
  shortenMiddle,
} from "@/lib/format";
import { navigate } from "@/lib/router";
import { normalizeSettings } from "@/lib/normalize";
import { useJobTracker } from "@/lib/use-job";
import { useVersionDetails, type VersionDetail } from "@/lib/use-version-details";
import { cn } from "@/lib/utils";

type SortKey = "installed" | "name" | "kind";

/** 版本管理：已装实例列表 + 展开详情 + 删除 + 设为当前。 */
export function VersionsPage() {
  const { versions, settings, running, loading, error, backendDown, reload, patchVersions, saveSettings } =
    useAppData();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<VersionInfo | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"delete" | "select" | "metadata" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("installed");
  // 汉化任务：任务号走实时进度，target 只用于标题与按钮等待态
  const [localizeTarget, setLocalizeTarget] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);
  const [editTarget, setEditTarget] = useState<VersionInfo | null>(null);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [editIsolated, setEditIsolated] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<VersionInfo | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);

  const selectedId = settings?.selectVersion ?? versions[0]?.id ?? null;

  const openEdit = useCallback((target: VersionInfo) => {
    setActionError(null);
    setEditTarget(target);
    setEditName(target.displayName ?? "");
    setEditIcon(target.icon ?? "");
    setEditIsolated(target.isolated === true);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (editTarget === null) {
      return;
    }
    setBusyId(editTarget.id);
    setBusyAction("metadata");
    setActionError(null);
    try {
      const result = await api.patchVersion(editTarget.id, {
        displayName: editName.trim() === "" ? null : editName.trim(),
        icon: editIcon.trim() === "" ? null : editIcon.trim(),
        isolated: editIsolated,
      });
      const metadata: InstanceMeta = result.metadata;
      patchVersions((list) =>
        list.map((item) =>
          item.id === editTarget.id
            ? {
                ...item,
                displayName: metadata.displayName,
                icon: metadata.icon,
                isolated: metadata.isolated,
              }
            : item,
        ),
      );
      setEditTarget(null);
      toast.success("实例资料已保存", { description: editTarget.id });
      reload();
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      setActionError(message);
      toast.error("保存实例资料失败", { description: message });
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }, [editTarget, editName, editIcon, editIsolated, patchVersions, reload]);

  const openSettings = useCallback((target: VersionInfo) => {
    setActionError(null);
    setSettingsError(null);
    setSettingsKey((value) => value + 1);
    setSettingsTarget(target);
  }, []);

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

  const versionIds = useMemo(() => versions.map((version) => version.id), [versions]);
  // lang / resourcePacks / localized 来自实例详情接口；接口不存在时静默降级为「未知」
  const details = useVersionDetails(versionIds, detailNonce);

  // 汉化任务结束：刷新实例列表与详情（语言/资源包变了）
  const handleLocalizeFinished = useCallback(
    (finishedJob: Job) => {
      setLocalizeTarget(null);
      setDetailNonce((value) => value + 1);
      reload();
      if (finishedJob.state === "done") {
        toast.success("汉化完成", { description: finishedJob.title });
      } else {
        toast.error("汉化失败", { description: finishedJob.message });
      }
    },
    [reload],
  );

  const { job, live, reset } = useJobTracker(jobId, { onFinished: handleLocalizeFinished });

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

  const handleLocalize = useCallback(
    async (target: VersionInfo, alreadyLocalized: boolean) => {
      setActionError(null);
      setLocalizeTarget(target.id);
      reset();
      try {
        const result = await api.localize(target.id);
        setJobId(result.jobId);
        toast.info((alreadyLocalized ? "开始重新汉化 " : "开始汉化 ") + target.id, {
          description: "下载中文资源包并写入 options.txt，进度见下方",
        });
      } catch (cause: unknown) {
        setLocalizeTarget(null);
        const message = errorMessage(cause);
        setActionError(message);
        toast.error("提交汉化任务失败", {
          description: isBackendDown(cause)
            ? "后端未就绪，或还没有实装 /api/localize 接口。"
            : message,
        });
      }
    },
    [reset],
  );

  return (
    <div data-motion-root>
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

        {jobId !== null ? (
          <JobProgressCard
            job={job}
            live={live}
            waiting={job === null}
            title={job?.title ?? "汉化 " + (localizeTarget ?? "")}
            onDismiss={() => {
              setJobId(null);
              reset();
            }}
            footer={
              job?.state === "error" ? (
                <span className="flex items-center gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="size-3.5" />
                  资源包下载失败时可在设置里换下载源后重试
                </span>
              ) : job?.state === "done" ? (
                <span className="text-xs text-muted-foreground">
                  已写入 options.txt 与 resourcepacks/，启动游戏即为中文界面
                </span>
              ) : null
            }
          />
        ) : null}

        {versions.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              共 <span className="font-semibold text-foreground">{versions.length}</span> 个实例
              {selectedId !== null ? " · 当前 " + selectedId : ""}
            </p>
            <div className="flex items-center gap-1 rounded-lg bg-pcl-7 p-0.5 dark:bg-muted">
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
                      ? "bg-card text-primary shadow-sm"
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
                detail={details[version.id]}
                localizing={localizeTarget === version.id}
                busy={busyId === version.id}
                busyAction={busyId === version.id ? busyAction : null}
                onToggle={() => {
                  setExpanded((previous) => (previous === version.id ? null : version.id));
                }}
                onSelect={() => { void handleSelect(version); }}
                onEdit={() => { openEdit(version); }}
                onInstanceSettings={() => { openSettings(version); }}
                onDelete={() => {
                  setActionError(null);
                  setDeleting(version);
                }}
                onLaunch={() => { navigate("/"); }}
                onMods={() => { navigate("/mods"); }}
                onLocalize={() => {
                  void handleLocalize(version, details[version.id]?.localized === true);
                }}
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

      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-4" />
              编辑实例资料
            </DialogTitle>
            <DialogDescription>
              「{editTarget?.id ?? ""}」的显示名和图标只用于启动器内识别；隔离存储会让这个实例使用独立的存档、选项和 Mod 目录。
            </DialogDescription>
          </DialogHeader>
          {actionError !== null ? <ErrorAlert title="保存失败" message={actionError} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="instance-display-name">显示名</Label>
              <Input
                id="instance-display-name"
                value={editName}
                onChange={(event) => { setEditName(event.target.value); }}
                placeholder={editTarget?.id ?? "留空则显示版本 id"}
                maxLength={40}
              />
              <p className="text-[11px] text-muted-foreground">留空会恢复显示原始版本 id。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="instance-icon">实例图标</Label>
              <Input
                id="instance-icon"
                value={editIcon}
                onChange={(event) => { setEditIcon(event.target.value); }}
                placeholder="例如 🧊 或 ⛏"
                maxLength={4}
              />
              <p className="text-[11px] text-muted-foreground">可填一个 emoji 或最多四个字符；留空用版本方块。</p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-pcl-8/50 px-3 py-2.5 dark:bg-muted/30">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <Label htmlFor="instance-isolated">独立存储（隔离实例）</Label>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                开启后存档、options.txt 与 Mod 互不共用；关闭则恢复与其它实例共享。切换时不会删除已有文件。
              </p>
            </div>
            <Switch
              id="instance-isolated"
              checked={editIsolated}
              onCheckedChange={setEditIsolated}
              aria-label="独立存储"
            />
          </div>
          <DialogFooter showCloseButton>
            <Button onClick={() => { void handleSaveEdit(); }} disabled={busyAction === "metadata"}>
              {busyAction === "metadata" ? <Loader2 className="animate-spin" /> : <Save />}
              保存资料
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={settingsTarget !== null}
        onOpenChange={(open) => {
          if (!open && !settingsSaving) {
            setSettingsTarget(null);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="size-4" />
              实例专属设置
            </DialogTitle>
            <DialogDescription>
              「{settingsTarget?.id ?? ""}」可以只覆盖下面几项启动设置，其他设置继续跟随全局。清空覆盖后完全恢复跟随全局。
            </DialogDescription>
          </DialogHeader>
          {settingsTarget !== null ? (
            <InstanceSettingsPanel
              versionId={settingsTarget.id}
              versionKey={settingsKey}
              globalSettings={settings}
              busy={settingsSaving}
              onBusyChange={setSettingsSaving}
              onError={setSettingsError}
              onSaved={() => {
                setSettingsKey((value) => value + 1);
                patchVersions((list) =>
                  list.map((item) =>
                    item.id === settingsTarget.id ? { ...item, hasInstanceSettings: true } : item,
                  ),
                );
              }}
              onReset={() => {
                setSettingsKey((value) => value + 1);
                patchVersions((list) =>
                  list.map((item) =>
                    item.id === settingsTarget.id ? { ...item, hasInstanceSettings: false } : item,
                  ),
                );
                reload();
              }}
              onClose={() => { setSettingsTarget(null); }}
            />
          ) : null}
          {settingsError !== null ? <ErrorAlert title="实例设置未完成" message={settingsError} /> : null}
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
  /** 实例详情（语言 / 资源包 / 是否已汉化），拉取失败时为 undefined */
  detail: VersionDetail | undefined;
  localizing: boolean;
  busy: boolean;
  busyAction: "delete" | "select" | "metadata" | null;
  onEdit: () => void;
  onInstanceSettings: () => void;
  onToggle: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onLaunch: () => void;
  onMods: () => void;
  onLocalize: () => void;
}

function VersionRow({
  version,
  selected,
  expanded,
  running,
  detail,
  localizing,
  busy,
  busyAction,
  onEdit,
  onInstanceSettings,
  onToggle,
  onSelect,
  onDelete,
  onLaunch,
  onMods,
  onLocalize,
}: VersionRowProps) {
  const localized = detail?.localized === true;
  return (
    <li
      className={cn(
        "card-soft overflow-hidden rounded-2xl border bg-card transition-colors",
        selected ? "border-primary/45" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-3 p-3.5">
        <VersionAvatar kind={version.kind} label={version.id} icon={version.icon} size="md" />

        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{version.displayName ?? version.id}</span>
            {version.displayName !== null && version.displayName !== undefined && version.displayName !== "" ? (
              <span className="truncate text-[11px] text-muted-foreground" title={version.id}>
                {version.id}
              </span>
            ) : null}
            <VersionKindBadge kind={version.kind} />
            {version.hasInstanceSettings === true ? (
              <Badge variant="outline" className="gap-1 border-primary/35 bg-primary/10 text-primary">
                <Settings2 />
                专属设置
              </Badge>
            ) : null}
            {version.isolated === true ? (
              <Badge variant="outline" className="gap-1 border-pcl-4/40 bg-pcl-8 text-pcl-3 dark:text-pcl-5">
                <ShieldCheck />
                独立存储
              </Badge>
            ) : null}
            {selected ? (
              <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-primary">
                <Star />
                当前
              </Badge>
            ) : null}
            {running ? (
              <Badge
                variant="outline"
                className="gap-1 border-pcl-4/50 bg-pcl-7 text-pcl-2 dark:text-pcl-5"
              >
                <span className="size-1.5 rounded-full bg-pcl-3" />
                运行中
              </Badge>
            ) : null}
            {localized ? (
              <Badge
                variant="outline"
                className="gap-1 border-pcl-4/40 bg-pcl-8 text-pcl-3 dark:text-pcl-5"
              >
                <Languages />
                中文
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            基础版本 {version.baseVersion} · Java {version.javaMajor || "?"} · 安装于{" "}
            {formatSince(version.installedAt)}
            {detail !== undefined ? " · 语言 " + gameLangLabel(detail.lang) : ""}
          </p>
        </button>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onEdit}
            disabled={busy}
            title="编辑显示名、图标与独立存储"
            aria-label={"编辑 " + version.id + " 资料"}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onInstanceSettings}
            disabled={busy}
            title="这个实例单独的启动设置"
            aria-label={"编辑 " + version.id + " 专属设置"}
          >
            <Settings2 />
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={onLocalize}
            disabled={busy || localizing}
            title="下载中文资源包并写入 options.txt，让游戏与 Mod 界面变中文"
          >
            {localizing ? <Loader2 className="animate-spin" /> : <Languages />}
            {localized ? "重新汉化" : "一键汉化"}
          </Button>
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
        <div className="border-t border-border bg-pcl-8/60 dark:bg-muted/30 px-3.5 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow icon={FileClock} label="安装时间" value={formatDateTime(version.installedAt)} />
            <DetailRow icon={Coffee} label="Java 主版本" value={"Java " + (version.javaMajor || "未知")} />
            <DetailRow icon={Boxes} label="实例目录" value={"versions/" + version.id} mono />
            <DetailRow
              icon={Download}
              label="资源复用"
              value={version.kind === "fabric" ? "复用 " + version.baseVersion + " 的 jar 与资源" : "独立 jar 与资源"}
            />
            <DetailRow
              icon={Languages}
              label="游戏语言"
              value={
                detail === undefined
                  ? "未知（后端未提供实例详情）"
                  : gameLangLabel(detail.lang) + (localized ? " · 已装汉化包" : "")
              }
            />
            <DetailRow
              icon={ShieldCheck}
              label="存储方式"
              value={version.isolated === true ? "独立存档 / 选项 / Mod" : "与其它实例共享"}
            />
            <DetailRow
              icon={Settings2}
              label="专属设置"
              value={version.hasInstanceSettings === true ? "已有实例级覆盖" : "跟随全局设置"}
            />
            <DetailRow
              icon={Boxes}
              label="已启用资源包"
              value={
                detail === undefined
                  ? "未知"
                  : detail.resourcePacks.length === 0
                    ? "无（原版默认）"
                    : detail.resourcePacks.length + " 个：" + detail.resourcePacks.join("、")
              }
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
            <Button variant="outline" size="xs" onClick={onEdit} disabled={busy}>
              <Pencil />
              编辑资料
            </Button>
            <Button variant="outline" size="xs" onClick={onInstanceSettings} disabled={busy}>
              <Settings2 />
              专属设置
            </Button>
            <Button variant="outline" size="xs" onClick={onLocalize} disabled={busy || localizing}>
              {localizing ? <Loader2 className="animate-spin" /> : <Languages />}
              {localized ? "重新汉化" : "一键汉化"}
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


/** 实例级设置草稿：只覆盖玩家常用、且契约允许的四项。 */
interface InstanceSettingsDraft {
  memoryMb: number;
  javaPath: string | null;
  gameLang: string;
  extraJvmArgs: string[];
}

const INSTANCE_MEMORY_MIN = 512;
const INSTANCE_MEMORY_MAX = 16384;
const INSTANCE_MEMORY_STEP = 256;
const INSTANCE_SETTING_KEYS: ReadonlyArray<keyof InstanceSettingsDraft> = [
  "memoryMb",
  "javaPath",
  "gameLang",
  "extraJvmArgs",
];

function parseInstanceResponse(raw: unknown): VersionSettingsResponse | null {
  if (!isRecord(raw) || !isRecord(raw["settings"])) {
    return null;
  }
  const overrideRaw: unknown = raw["override"];
  const override: Partial<Settings> = {};
  if (isRecord(overrideRaw)) {
    for (const key of INSTANCE_SETTING_KEYS) {
      const value = overrideRaw[key];
      if (value === undefined) {
        continue;
      }
      (override as Record<string, unknown>)[key] = value;
    }
  }
  return { settings: normalizeSettings(raw["settings"]), override };
}

function toDraft(effective: Settings, override: Partial<Settings>): InstanceSettingsDraft {
  return {
    memoryMb: typeof override.memoryMb === "number" ? override.memoryMb : effective.memoryMb,
    javaPath:
      override.javaPath !== undefined ? override.javaPath : effective.javaPath,
    gameLang: override.gameLang ?? effective.gameLang ?? "zh_cn",
    extraJvmArgs: override.extraJvmArgs ?? effective.extraJvmArgs,
  };
}

function jvmArgsLines(args: string[]): string {
  return args.join("\n");
}

function splitJvmArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

interface InstanceSettingsPanelProps {
  versionId: string;
  versionKey: number;
  globalSettings: Settings | null;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onSaved: () => void;
  onReset: () => void;
  onClose: () => void;
}

/**
 * E24：展示后端解析后的生效设置，并针对当前实例提交非空覆盖。
 * 不使用 effect 同步草稿：远端数据返回后以「数据代数」作为 key 重挂表单。
 */
function InstanceSettingsPanel({
  versionId,
  versionKey,
  globalSettings,
  busy,
  onBusyChange,
  onError,
  onSaved,
  onReset,
  onClose,
}: InstanceSettingsPanelProps) {
  const [response, setResponse] = useState<VersionSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [edits, setEdits] = useState<Partial<InstanceSettingsDraft>>({});
  const [jvmArgsEdit, setJvmArgsEdit] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .getVersionSettings(versionId)
      .then((data) => {
        if (!cancelled) {
          const parsed = parseInstanceResponse(data as unknown);
          setResponse(parsed);
          setLoading(false);
          if (parsed === null) {
            setLoadError("启动器返回的数据格式不完整，请稍后重试");
          }
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(errorMessage(cause));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [versionId, versionKey, nonce]);

  const responseSettings = response?.settings ?? null;
  const override = response?.override ?? {};
  const draft = useMemo<InstanceSettingsDraft | null>(() => {
    if (responseSettings === null) {
      return null;
    }
    const base = toDraft(responseSettings, override);
    return { ...base, ...edits };
  }, [responseSettings, override, edits]);
  const jvmArgsText =
    jvmArgsEdit ?? (draft === null ? "" : jvmArgsLines(draft.extraJvmArgs));
  const dirty =
    draft !== null &&
    (draft.memoryMb !== responseSettings?.memoryMb ||
      (draft.javaPath ?? "") !== (responseSettings?.javaPath ?? "") ||
      draft.gameLang !== (responseSettings?.gameLang ?? "zh_cn") ||
      splitJvmArgs(jvmArgsText).join("\n") !== (responseSettings?.extraJvmArgs ?? []).join("\n"));

  const handleSave = useCallback(async () => {
    if (draft === null || responseSettings === null) {
      return;
    }
    const args = splitJvmArgs(jvmArgsText);
    const patch: Partial<Settings> = {
      memoryMb: draft.memoryMb,
      javaPath: draft.javaPath === null || draft.javaPath.trim() === "" ? null : draft.javaPath.trim(),
      gameLang: draft.gameLang,
      extraJvmArgs: args,
    };
    if (Object.keys(patch).length === 0) {
      onError("没有可保存的设置，请先修改一项");
      return;
    }
    onBusyChange(true);
    onError(null);
    try {
      const saved = await api.saveVersionSettings(versionId, patch);
      const parsed = parseInstanceResponse(saved as unknown);
      if (parsed !== null) {
        setResponse(parsed);
      }
      setEdits({});
      setJvmArgsEdit(null);
      toast.success("实例设置已保存", { description: versionId + " 的专属覆盖已生效" });
      onSaved();
      setNonce((value) => value + 1);
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      onError(message);
      toast.error("保存实例设置失败", { description: message });
    } finally {
      onBusyChange(false);
    }
  }, [draft, jvmArgsText, responseSettings, versionId, onBusyChange, onError, onSaved]);

  const handleReset = useCallback(async () => {
    onBusyChange(true);
    onError(null);
    try {
      const reset = await api.resetVersionSettings(versionId);
      const parsed = parseInstanceResponse(reset as unknown);
      if (parsed !== null) {
        setResponse(parsed);
      }
      setEdits({});
      setJvmArgsEdit(null);
      setResetOpen(false);
      toast.success("已恢复跟随全局设置", { description: "这个实例的专属覆盖已全部清除" });
      onReset();
      setNonce((value) => value + 1);
    } catch (cause: unknown) {
      const message = errorMessage(cause);
      onError(message);
      toast.error("恢复全局设置失败", { description: message });
    } finally {
      onBusyChange(false);
    }
  }, [versionId, onBusyChange, onError, onReset]);

  if (loading && response === null) {
    return (
      <div className="space-y-3 py-2">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <p className="text-xs text-muted-foreground">正在读取这个实例的设置…</p>
      </div>
    );
  }

  if (loadError !== null || response === null || responseSettings === null || draft === null) {
    return (
      <div className="space-y-3 py-2">
        <ErrorAlert
          title="读取实例设置失败"
          message={loadError ?? "启动器还没准备好这个功能，或返回的数据不完整"}
          onRetry={() => { setNonce((value) => value + 1); }}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          可以先继续使用全局设置；启动器服务恢复或功能上线后再点「重试」。
        </p>
      </div>
    );
  }

  const overrideKeys = INSTANCE_SETTING_KEYS.filter((key) => override[key] !== undefined);
  const active = responseSettings;

  return (
    <div data-motion-root className="space-y-3 py-1" key={versionKey}>
      <div className="rounded-xl border border-border bg-pcl-8/60 px-3 py-2.5 dark:bg-muted/30">
        <SectionHeader
          icon={ShieldCheck}
          title="生效设置"
          description="由全局设置与实例覆盖合并后得到，启动这个版本时实际使用"
          action={
            <Badge variant="outline" className="font-mono">
              {overrideKeys.length === 0 ? "跟随全局" : overrideKeys.length + " 项专属"}
            </Badge>
          }
        />
        <div className="mt-2 grid gap-x-4 gap-y-1.5 text-[11px] sm:grid-cols-2">
          <EffectiveSetting label="内存" value={formatMemory(active.memoryMb)} overridden={override.memoryMb !== undefined} />
          <EffectiveSetting label="Java" value={active.javaPath ?? "自动寻找"} overridden={override.javaPath !== undefined} />
          <EffectiveSetting label="游戏语言" value={gameLangLabel(active.gameLang)} overridden={override.gameLang !== undefined} />
          <EffectiveSetting
            label="额外 JVM 参数"
            value={active.extraJvmArgs.length === 0 ? "无" : active.extraJvmArgs.length + " 行"}
            overridden={override.extraJvmArgs !== undefined}
          />
        </div>
        {globalSettings !== null ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            全局当前内存 {formatMemory(globalSettings.memoryMb)}、语言 {gameLangLabel(globalSettings.gameLang)}；保存后只有这个实例使用新值。
          </p>
        ) : null}
      </div>

      <div className="card-soft space-y-3 border border-border">
        <SectionHeader
          icon={Settings2}
          title="实例覆盖"
          description="留空或清空后点「恢复跟随全局」，即不再单独设置"
          action={
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => {
                setEdits({});
                setJvmArgsEdit(null);
                onError(null);
              }}
            >
              <Undo2 />
              还原草稿
            </Button>
          }
        />
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="instance-memory">内存分配</Label>
            <Badge variant="outline" className="font-mono">{formatMemory(draft.memoryMb)}</Badge>
          </div>
          <Slider
            id="instance-memory"
            value={[draft.memoryMb]}
            min={INSTANCE_MEMORY_MIN}
            max={INSTANCE_MEMORY_MAX}
            step={INSTANCE_MEMORY_STEP}
            disabled={busy}
            onValueChange={(values) => {
              const value = values[0];
              if (value !== undefined) {
                setEdits((previous) => ({ ...previous, memoryMb: value }));
              }
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="instance-java-path">Java 路径</Label>
            <Input
              id="instance-java-path"
              value={draft.javaPath ?? ""}
              disabled={busy}
              onChange={(event) => { setEdits((previous) => ({ ...previous, javaPath: event.target.value })); }}
              placeholder="留空则自动寻找"
            />
            <p className="text-[11px] text-muted-foreground">只对这个实例生效；留空表示自动寻找。</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="instance-game-lang">游戏语言</Label>
            <select
              id="instance-game-lang"
              value={draft.gameLang}
              disabled={busy}
              onChange={(event) => { setEdits((previous) => ({ ...previous, gameLang: event.target.value })); }}
              className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:bg-input/30"
            >
              {GAME_LANGS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">启动时写入这个实例的 options.txt。</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="instance-jvm-args">额外 JVM 参数（一行一个）</Label>
          <textarea
            id="instance-jvm-args"
            value={jvmArgsText}
            disabled={busy}
            rows={4}
            spellCheck={false}
            placeholder={"-Dfile.encoding=UTF-8\n-XX:+UseG1GC"}
            onChange={(event) => { setJvmArgsEdit(event.target.value); }}
            className="w-full resize-y rounded-xl border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:bg-input/30"
          />
          <p className="text-[11px] text-muted-foreground">每行一条；空白行会被忽略。没有需要时全部删空即可。</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!dirty || busy} onClick={() => { void handleSave(); }}>
          {busy ? <Loader2 className="animate-spin" /> : <Save />}
          保存专属设置
        </Button>
        <Button variant="outline" size="sm" disabled={busy || overrideKeys.length === 0} onClick={() => { setResetOpen(true); }}>
          <Undo2 />
          恢复跟随全局
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose} className="ml-auto">
          关闭
        </Button>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清除这个实例的专属设置？</DialogTitle>
            <DialogDescription>
              「{versionId}」的内存、Java 路径、游戏语言与额外 JVM 参数会全部恢复为跟随全局设置。不会删除游戏文件或存档。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive" disabled={busy} onClick={() => { void handleReset(); }}>
              {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
              确认恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface EffectiveSettingProps {
  label: string;
  value: string;
  overridden: boolean;
}

function EffectiveSetting({ label, value, overridden }: EffectiveSettingProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium text-foreground" title={value}>{value}</span>
        {overridden ? (
          <Badge variant="outline" className="border-primary/35 bg-primary/10 px-1 py-0 text-[9px] text-primary">
            专属
          </Badge>
        ) : null}
      </span>
    </div>
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
