import { useCallback, useMemo, useState } from "react";
import {
  Coffee,
  Gauge,
  HardDriveDownload,
  Languages,
  ShieldCheck,
  Loader2,
  MemoryStick,
  RotateCw,
  Save,
  SlidersHorizontal,
  Undo2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { BackendNotice } from "@/components/backend-notice";
import { ErrorAlert } from "@/components/error-alert";
import { AccountsCard, AccountsCardSkeleton } from "@/components/accounts-card";
import { useAppData } from "@/context/app-data-context";
import { errorMessage, type DownloadSource, type Settings } from "@/lib/api";
import { GAME_LANGS, formatMemory, shortenMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";

const MEMORY_MIN = 512;
const MEMORY_MAX = 16384;
const MEMORY_STEP = 256;
const CONCURRENCY_MIN = 1;
const CONCURRENCY_MAX = 32;

/** 设置：内存 / Java / JVM 参数 / 下载源 / 并发 / 账号。 */
export function SettingsPage() {
  const { settings, javas, loading, backendDown, error, reload, saveSettings } = useAppData();

  // 草稿 = 服务端设置 + 本地改动（派生，无需 effect 同步，服务端变了也能跟上）
  const [edits, setEdits] = useState<Partial<Settings>>({});
  const [jvmArgsEdit, setJvmArgsEdit] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const draft = useMemo<Settings | null>(
    () => (settings === null ? null : { ...settings, ...edits }),
    [settings, edits],
  );
  const jvmArgsText = jvmArgsEdit ?? (draft?.extraJvmArgs.join("\n") ?? "");

  const dirty = useMemo(() => {
    if (draft === null || settings === null) {
      return false;
    }
    return (
      draft.memoryMb !== settings.memoryMb ||
      (draft.javaPath ?? "") !== (settings.javaPath ?? "") ||
      draft.downloadSource !== settings.downloadSource ||
      draft.maxConcurrent !== settings.maxConcurrent ||
      draft.closeOnLaunch !== settings.closeOnLaunch ||
      (draft.gameLang ?? "zh_cn") !== (settings.gameLang ?? "zh_cn") ||
      jvmArgsText.trim() !== settings.extraJvmArgs.join("\n")
    );
  }, [draft, settings, jvmArgsText]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setEdits((previous) => ({ ...previous, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (draft === null) {
      return;
    }
    const args = jvmArgsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const patch: Partial<Settings> = {
      memoryMb: draft.memoryMb,
      javaPath: draft.javaPath === null || draft.javaPath === "" ? null : draft.javaPath,
      extraJvmArgs: args,
      downloadSource: draft.downloadSource,
      maxConcurrent: draft.maxConcurrent,
      closeOnLaunch: draft.closeOnLaunch,
      gameLang: draft.gameLang ?? "zh_cn",
    };
    setSaving(true);
    setSaveError(null);
    try {
      await saveSettings(patch);
      setEdits({});
      setJvmArgsEdit(null);
      toast.success("设置已保存");
    } catch (cause: unknown) {
      setSaveError(errorMessage(cause));
      toast.error("保存失败", { description: errorMessage(cause) });
    } finally {
      setSaving(false);
    }
  }, [draft, jvmArgsText, saveSettings]);

  const handleReset = useCallback(() => {
    setEdits({});
    setJvmArgsEdit(null);
    setSaveError(null);
  }, []);

  if (loading && settings === null) {
    return (
      <div>
        <PageHeader title="设置" description="启动参数、下载源、账号与皮肤预览。" />
        <div className="space-y-3">
          <Skeleton className="h-52 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <AccountsCardSkeleton />
        </div>
      </div>
    );
  }

  if (settings === null) {
    return (
      <div>
        <PageHeader title="设置" description="启动参数、下载源、账号与皮肤预览。" />
        <div className="space-y-3">
          {backendDown ? <BackendNotice onRetry={reload} retrying={loading} /> : null}
          <ErrorAlert
            title="读取设置失败"
            message={error ?? "后端没有返回设置数据"}
            onRetry={reload}
            offline={backendDown}
          />
          <div className="rounded-2xl border border-dashed border-border bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
            后端就绪后这里会显示内存、Java 路径、JVM 参数、下载源、账号与皮肤预览。你仍然可以先在下面添加离线账号或进行微软正版登录（需要后端支持）。
          </div>
          <div className="space-y-2 pt-1">
          <SectionHeader
            icon={ShieldCheck}
            title="账号与皮肤"
            description="正版账号显示皮肤头像与预览；离线账号永远可直接启动，不需要刷新登录。"
          />
          <AccountsCard />
        </div>
        </div>
      </div>
    );
  }

  const current = draft ?? settings;
  const memoryMb = current.memoryMb;

  return (
    <div>
      <PageHeader
        title="设置"
        description="修改会写回 ~/.local/share/lycomc/settings.json。"
        action={
          <>
            <Button variant="outline" size="sm" onClick={handleReset} disabled={!dirty || saving}>
              <Undo2 />
              还原
            </Button>
            <Button size="sm" onClick={() => { void handleSave(); }} disabled={!dirty || saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              保存
            </Button>
          </>
        }
      />

      <div className="space-y-3">
        {backendDown ? <BackendNotice onRetry={reload} retrying={loading} /> : null}
        {error !== null && !backendDown ? (
          <ErrorAlert title="读取设置失败" message={error} onRetry={reload} />
        ) : null}
        {saveError !== null ? <ErrorAlert title="保存失败" message={saveError} /> : null}

        <div className="card-soft rounded-2xl border border-border bg-card p-4">
          <SectionHeader
            icon={MemoryStick}
            title="内存分配"
            description="堆内存上限（-Xmx），按实例需求调整"
            action={
              <Badge variant="outline" className="font-mono">
                {formatMemory(memoryMb)}
              </Badge>
            }
          />
          <div className="mt-4">
            <Slider
              value={[memoryMb]}
              min={MEMORY_MIN}
              max={MEMORY_MAX}
              step={MEMORY_STEP}
              onValueChange={(values) => {
                const next = values[0];
                if (typeof next === "number") {
                  update("memoryMb", Math.round(next));
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{formatMemory(MEMORY_MIN)}</span>
              <span className="flex items-center gap-1.5">
                <MemoryStick className="size-3" />
                建议 4 GB（16 个 Mod 以上可给 6 GB）
              </span>
              <span>{formatMemory(MEMORY_MAX)}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {[2048, 4096, 6144, 8192, 12288].map((value) => (
                <Button
                  key={value}
                  variant={memoryMb === value ? "secondary" : "outline"}
                  size="xs"
                  onClick={() => { update("memoryMb", value); }}
                >
                  {formatMemory(value)}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="card-soft rounded-2xl border border-border bg-card p-4">
          <SectionHeader
            icon={Coffee}
            title="Java 运行时"
            description="留空则由启动器自动挑选（按版本要求的 javaMajor）"
            action={
              <Badge variant="ghost" className="text-[10px] text-muted-foreground">
                检测到 {javas.length} 个
              </Badge>
            }
          />
          <div className="mt-3 space-y-2.5">
            <div>
              <Label htmlFor="java-path" className="mb-1.5 text-xs text-muted-foreground">
                Java 可执行文件路径
              </Label>
              <Input
                id="java-path"
                value={current.javaPath ?? ""}
                onChange={(event) => { update("javaPath", event.target.value); }}
                placeholder="例如 /usr/lib/jvm/java-17-openjdk/bin/java"
                className="h-8 font-mono text-xs"
              />
            </div>
            {javas.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {javas.slice(0, 6).map((java) => (
                  <Button
                    key={java.path + java.version}
                    variant={current.javaPath === java.path ? "secondary" : "outline"}
                    size="xs"
                    className="max-w-full"
                    title={java.path}
                    onClick={() => { update("javaPath", java.path); }}
                  >
                    Java {java.version || "?"}
                    <span className="ml-1 max-w-28 truncate font-mono text-[10px] opacity-60">
                      {shortenMiddle(java.path, 22)}
                    </span>
                  </Button>
                ))}
                {current.javaPath !== null && current.javaPath !== "" ? (
                  <Button variant="ghost" size="xs" onClick={() => { update("javaPath", null); }}>
                    自动选择
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="card-soft rounded-2xl border border-border bg-card p-4">
          <SectionHeader
            icon={Wrench}
            title="额外 JVM 参数"
            description="每行一个，拼在 -Xmx 之后；写错会导致启动失败"
          />
          <textarea
            value={jvmArgsText}
            onChange={(event) => { setJvmArgsEdit(event.target.value); }}
            spellCheck={false}
            rows={4}
            placeholder={"-XX:+UseG1GC\n-Dfile.encoding=UTF-8"}
            className={cn(
              "mt-3 w-full resize-y rounded-xl border border-input bg-transparent px-2.5 py-2 font-mono text-xs",
              "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
              "dark:bg-input/30",
            )}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {jvmArgsText.trim() === ""
              ? "当前没有任何额外参数"
              : "共 " + jvmArgsText.split("\n").filter((line) => line.trim() !== "").length + " 条参数"}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card-soft rounded-2xl border border-border bg-card p-4">
            <SectionHeader icon={HardDriveDownload} title="下载源" description="国内网络建议用 BMCLAPI" />
            <Select
              value={current.downloadSource}
              onValueChange={(value) => { update("downloadSource", value as DownloadSource); }}
            >
              <SelectTrigger className="mt-3 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mojang">Mojang 官方</SelectItem>
                <SelectItem value="bmcl">BMCLAPI（国内镜像）</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {current.downloadSource === "bmcl"
                ? "走 bmclapi2.bangbang93.com，速度更快但偶尔会缺最新快照。"
                : "走 Mojang 官方 CDN，最稳但国内可能较慢。"}
            </p>
          </div>

          <div className="card-soft rounded-2xl border border-border bg-card p-4">
            <SectionHeader
              icon={Gauge}
              title="并发下载数"
              description="同时下载的文件数"
              action={<Badge variant="outline" className="font-mono">{current.maxConcurrent}</Badge>}
            />
            <Slider
              className="mt-4"
              value={[current.maxConcurrent]}
              min={CONCURRENCY_MIN}
              max={CONCURRENCY_MAX}
              step={1}
              onValueChange={(values) => {
                const next = values[0];
                if (typeof next === "number") {
                  update("maxConcurrent", Math.round(next));
                }
              }}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              默认 8；网络不稳时调到 4 以下更少出现校验失败。
            </p>
          </div>
        </div>

        <div className="card-soft rounded-2xl border border-border bg-card p-4">
          <SectionHeader
            icon={Languages}
            title="游戏语言"
            description="启动时写入 options.txt 的 lang"
            action={
              <Badge variant="outline" className="font-mono">
                {current.gameLang ?? "zh_cn"}
              </Badge>
            }
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,15rem)_1fr] sm:items-center">
            <Select
              value={current.gameLang ?? "zh_cn"}
              onValueChange={(value) => { update("gameLang", value); }}
            >
              <SelectTrigger className="w-full" aria-label="游戏语言">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GAME_LANGS.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value}>
                    {lang.label}
                    <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                      {lang.value}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              启动时写入 options.txt；模组界面中文需要配合「一键汉化」（版本管理 → 一键汉化）安装的中文资源包。
            </p>
          </div>
          {(current.gameLang ?? "zh_cn") === "en_us" ? (
            <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              当前是英文界面。想玩中文请选「简体中文」，并在版本管理里对实例点一次「一键汉化」。
            </p>
          ) : null}
        </div>

        <div className="card-soft rounded-2xl border border-border bg-card p-4">
          <SectionHeader icon={SlidersHorizontal} title="启动器行为" />
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">启动游戏后关闭启动器</p>
              <p className="text-[11px] text-muted-foreground">
                开启后点「启动游戏」会结束本进程（后端托管时生效）
              </p>
            </div>
            <Switch
              checked={current.closeOnLaunch}
              onCheckedChange={(checked) => { update("closeOnLaunch", checked); }}
            />
          </div>
          <Separator className="my-3" />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>数据根 ~/.local/share/lycomc/</span>
            <Button variant="ghost" size="xs" onClick={reload} disabled={loading}>
              <RotateCw className={loading ? "animate-spin" : undefined} />
              重新读取设置
            </Button>
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <SectionHeader
            icon={ShieldCheck}
            title="账号与皮肤"
            description="正版账号显示皮肤头像与预览；离线账号永远可直接启动，不需要刷新登录。"
          />
          <AccountsCard />
        </div>
      </div>
    </div>
  );
}
