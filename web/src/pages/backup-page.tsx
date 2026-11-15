import { useCallback, useRef, useState, type ChangeEvent } from "react";
import {
  Archive,
  Download,
  FileJson,
  HardDrive,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorAlert } from "@/components/error-alert";
import { BackendNotice } from "@/components/backend-notice";
import { useAppData } from "@/context/app-data-context";
import {
  api,
  errorMessage,
  isRecord,
  type BackupEntry,
  type BackupListResponse,
  type Settings,
} from "@/lib/api";
import { formatBytes, formatDateTime } from "@/lib/format";
import { normalizeSettings } from "@/lib/normalize";
import { useKeyedFetch } from "@/lib/use-keyed-fetch";
import { cn } from "@/lib/utils";

const BACKUP_LIST_KEY = "backup-list";
const JSON_AREA_CLASS = cn(
  "w-full min-h-32 resize-y rounded-xl border border-input bg-pcl-8/60 px-3 py-2 font-mono text-xs",
  "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
  "dark:bg-muted/60",
);

function stamp(date: Date): string {
  const two = (value: number) => String(value).padStart(2, "0");
  return (
    String(date.getFullYear()) +
    two(date.getMonth() + 1) +
    two(date.getDate()) +
    "-" +
    two(date.getHours()) +
    two(date.getMinutes()) +
    two(date.getSeconds())
  );
}

function downloadJson(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/**
 * H35：设置导出/导入、备份/恢复、缓存清理。
 * 四个能力各自独立 loading / 错误 / 成功提示，后端不可用时整页仍可浏览。
 */
export function BackupPage() {
  const { backendDown, reload } = useAppData();
  const [exportText, setExportText] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const backups = useKeyedFetch<BackupListResponse>(BACKUP_LIST_KEY, () => api.listBackups());
  const items = backups.data?.items ?? [];

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const settings = await api.exportSettings();
      const text = JSON.stringify(settings, null, 2);
      setExportText(text);
      downloadJson(text, "lycomc-settings-" + stamp(new Date()) + ".json");
      toast.success("设置已导出", { description: "JSON 文件已开始下载。" });
    } catch (cause: unknown) {
      setExportError(errorMessage(cause));
      toast.error("导出失败", { description: errorMessage(cause) });
    } finally {
      setExporting(false);
    }
  }, []);

  const handlePickFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) {
      return;
    }
    setImportError(null);
    try {
      setImportText(await file.text());
      setImportFileName(file.name);
      toast.success("已读取文件", { description: file.name + "，核对内容后可导入。" });
    } catch (cause: unknown) {
      setImportError("读取文件失败：" + errorMessage(cause));
    }
  }, []);

  const handleImport = useCallback(async () => {
    const text = importText.trim();
    if (text === "") {
      setImportError("请先粘贴设置 JSON，或选择一个 .json 文件。");
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      setImportError("这段内容不是有效的 JSON，请检查有没有复制完整。");
      return;
    }
    if (!isRecord(payload)) {
      setImportError("设置内容格式不对，应选择包含设置字段的 JSON 对象。");
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const saved: Settings = await api.importSettings(payload as Partial<Settings>);
      setExportText(JSON.stringify(saved, null, 2));
      toast.success("设置已导入", { description: "新的设置已生效。" });
      reload();
    } catch (cause: unknown) {
      setImportError(errorMessage(cause));
      toast.error("导入失败", { description: errorMessage(cause) });
    } finally {
      setImporting(false);
    }
  }, [importText, reload]);

  const handleCopyExport = useCallback(async () => {
    if (exportText === "") {
      return;
    }
    try {
      await navigator.clipboard.writeText(exportText);
      toast.success("已复制设置内容");
    } catch {
      setExportError("复制失败，可以改用导出按钮下载文件。");
    }
  }, [exportText]);

  const fillExportFromImport = useCallback(() => {
    setExportText(importText.trim());
    setExportError(null);
  }, [importText]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    setActionError(null);
    try {
      const created = await api.createBackup();
      toast.success("备份已创建", { description: created.fileName });
      backups.reload();
    } catch (cause: unknown) {
      setActionError(errorMessage(cause));
      toast.error("创建备份失败", { description: errorMessage(cause) });
    } finally {
      setCreating(false);
    }
  }, [backups.reload]);

  const handleRestore = useCallback(async () => {
    if (restoreTarget === null) {
      return;
    }
    setRestoring(true);
    setActionError(null);
    try {
      const result = await api.restoreBackup(restoreTarget.id);
      const settings = normalizeSettings(result.settings);
      setExportText(JSON.stringify(settings, null, 2));
      setRestoreTarget(null);
      toast.success("设置已恢复", { description: "可以向导返回原设置备份。" });
      reload();
    } catch (cause: unknown) {
      setActionError(errorMessage(cause));
      toast.error("恢复失败", { description: errorMessage(cause) });
    } finally {
      setRestoring(false);
    }
  }, [restoreTarget, reload]);

  const handleCleanup = useCallback(async () => {
    setCleaning(true);
    setActionError(null);
    try {
      const result = await api.cleanupCache();
      setCleanupOpen(false);
      toast.success("缓存已清理", {
        description:
          "释放 " +
          formatBytes(result.freedBytes) +
          "，删除 " +
          result.removedFiles +
          " 个文件、" +
          result.removedDirs +
          " 个空目录。",
      });
    } catch (cause: unknown) {
      setActionError(errorMessage(cause));
      toast.error("清理失败", { description: errorMessage(cause) });
    } finally {
      setCleaning(false);
    }
  }, []);

  return (
    <div data-motion-root className="space-y-3">
      <PageHeader
        title="备份与清理"
        description="设置可以导出成文件保存；需要时导入或恢复备份。清理只针对临时缓存。"
      />
      {backendDown ? <BackendNotice onRetry={backups.reload} retrying={backups.loading} /> : null}
      {actionError !== null ? <ErrorAlert title="操作失败" message={actionError} /> : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card-soft space-y-3">
          <SectionHeader
            icon={Download}
            title="导出设置"
            description="把当前设置下载成 JSON 文件，换电脑时也能用。"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            设置文件里没有账号凭据或登录令牌，可以放心保存。游戏、存档和 Mod 不在导出范围内。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { void handleExport(); }} disabled={exporting}>
              {exporting ? <Loader2 className="animate-spin" /> : <Download />}
              导出 JSON 文件
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { void handleCopyExport(); }}
              disabled={exportText === ""}
            >
              复制内容
            </Button>
          </div>
          {exportError !== null ? <ErrorAlert title="导出失败" message={exportError} /> : null}
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">导出的内容预览</p>
            <textarea
              readOnly
              value={exportText}
              placeholder="点「导出 JSON 文件」后，这里会显示刚导出的设置内容。"
              aria-label="导出的设置 JSON"
              rows={6}
              className={cn(JSON_AREA_CLASS, "dark:bg-muted/40")}
            />
          </div>
        </section>

        <section className="card-soft space-y-3">
          <SectionHeader
            icon={Upload}
            title="导入设置"
            description="粘贴设置 JSON，或上传之前导出的 .json 文件。"
          />
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => { void handlePickFile(event); }}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { fileRef.current?.click(); }}>
              <FileJson />
              选择 .json 文件
            </Button>
            {importFileName !== "" ? (
              <Badge variant="outline" className="max-w-full truncate" title={importFileName}>
                {importFileName}
              </Badge>
            ) : null}
          </div>
          <textarea
            value={importText}
            onChange={(event) => { setImportText(event.target.value); setImportFileName(""); setImportError(null); }}
            spellCheck={false}
            rows={6}
            placeholder={'例如：{ "memoryMb": 4096, "downloadSource": "bmcl" }'}
            aria-label="要导入的设置 JSON"
            className={JSON_AREA_CLASS}
          />
          {importError !== null ? <ErrorAlert title="无法导入" message={importError} /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => { void handleImport(); }} disabled={importing}>
              {importing ? <Loader2 className="animate-spin" /> : <Upload />}
              导入并保存
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={fillExportFromImport}
              disabled={importText.trim() === ""}
            >
              放入导出预览区
            </Button>
            <span className="text-[11px] text-muted-foreground">
              导入只覆盖提交的字段，未提供的设置保持原样；成功后页面与侧栏会刷新。
            </span>
          </div>
        </section>
      </div>

      <section className="card-soft space-y-3">
        <SectionHeader
          icon={Archive}
          title="设置备份"
          description="创建一份带时间的设置快照，随时恢复。"
          action={
            <Button size="sm" onClick={() => { void handleCreate(); }} disabled={creating}>
              {creating ? <Loader2 className="animate-spin" /> : <Archive />}
              创建备份
            </Button>
          }
        />
        {backups.loading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        ) : backups.error !== null ? (
          <ErrorAlert title="读取备份列表失败" message={backups.error} onRetry={backups.reload} offline={backendDown} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="还没有备份"
            description="点右上角「创建备份」，给当前设置留一份快照。备份只包含启动器设置。"
          />
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">共 {backups.data?.count ?? items.length} 份备份</p>
            {items.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-pcl-8/50 px-3 py-2.5 dark:bg-muted/30"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-pcl-7 text-primary dark:bg-muted">
                  <Archive className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium" title={item.fileName}>{item.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDateTime(item.createdAt)} · {formatBytes(item.bytes)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => { setRestoreTarget(item); setActionError(null); }}
                  disabled={restoring}
                >
                  <RotateCcw />
                  恢复设置
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-soft space-y-3">
        <SectionHeader
          icon={HardDrive}
          title="清理缓存"
          description="只清理启动器下载过程中产生的临时文件。"
          action={
            <Button variant="destructive" size="sm" onClick={() => { setCleanupOpen(true); setActionError(null); }}>
              <Trash2 />
              清理缓存
            </Button>
          }
        />
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-pcl-8/50 px-3 py-2.5 text-xs text-muted-foreground dark:bg-muted/30">
          <Trash2 className="size-4 shrink-0" />
          <span>只清理缓存；不会删除游戏、存档、资源包、Mod、已装版本或设置备份。</span>
        </div>
      </section>

      <Dialog open={restoreTarget !== null} onOpenChange={(open) => { if (!open) { setRestoreTarget(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>恢复这份设置备份？</DialogTitle>
            <DialogDescription>
              将用「{restoreTarget?.fileName ?? ""}」里的设置覆盖当前设置。游戏文件、存档与 Mod 不会变动；建议先导出一份当前设置。
            </DialogDescription>
          </DialogHeader>
          {actionError !== null ? <ErrorAlert title="恢复失败" message={actionError} /> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={restoring}>取消</Button>
            </DialogClose>
            <Button onClick={() => { void handleRestore(); }} disabled={restoring}>
              {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              确认恢复
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>清理启动器缓存？</DialogTitle>
            <DialogDescription>
              只清理临时缓存，不会删除游戏、存档、资源包、Mod、已装版本和设置备份。清理完成后会显示释放的空间和文件数量。
            </DialogDescription>
          </DialogHeader>
          {actionError !== null ? <ErrorAlert title="清理失败" message={actionError} /> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={cleaning}>取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => { void handleCleanup(); }} disabled={cleaning}>
              {cleaning ? <Loader2 className="animate-spin" /> : <Trash2 />}
              确认清理
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
