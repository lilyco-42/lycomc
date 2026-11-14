import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleCheck,
  Download,
  Loader2,
  PartyPopper,
  Play,
  SkipForward,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { VersionKindBadge } from "@/components/version-badge";
import { useAppData } from "@/context/app-data-context";
import { api, errorMessage, type Account, type Job } from "@/lib/api";
import { clampPercent, formatPercent } from "@/lib/format";
import { normalizeAccount } from "@/lib/normalize";
import { markOnboarded } from "@/lib/onboarding";
import { useJobTracker } from "@/lib/use-job";
import { cn } from "@/lib/utils";

/** 新手推荐装这个版本：最稳、Mod 多、要求不高。 */
const RECOMMENDED_VERSION = "1.20.1";
const STEP_TITLES = ["认识它", "取个名字", "选个版本"] as const;

interface OnboardingProps {
  /** 用户看完 / 跳过后关闭向导 */
  onFinish: () => void;
}

/**
 * 首次打开启动器时的一次性向导：三步、全大白话、每步只讲一件事。
 * 任何一步都能「跳过」，跳过也记成已看过，之后可从顶栏「引导」重新打开。
 */
export function Onboarding({ onFinish }: OnboardingProps) {
  const { versions, accounts, currentAccount, reload, saveSettings, patchAccounts } = useAppData();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(currentAccount?.name ?? accounts[0]?.name ?? "Steve");
  const [creating, setCreating] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [installedId, setInstalledId] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const finish = useCallback(() => {
    markOnboarded();
    onFinish();
  }, [onFinish]);

  const handleInstallFinished = useCallback(
    (finishedJob: Job) => {
      if (finishedJob.state === "done") {
        setInstalledId(RECOMMENDED_VERSION);
        setInstallError(null);
        toast.success("装好啦", { description: "已经装好 " + RECOMMENDED_VERSION + "，回到游戏页就能开始玩。" });
        reload();
      } else {
        setInstallError(finishedJob.message !== "" ? finishedJob.message : "这次没装完，稍后再试一次也可以。");
      }
    },
    [reload],
  );

  const { job, error: jobError } = useJobTracker(jobId, { onFinished: handleInstallFinished });

  // 桌面壳的 WebView 子容器不会自动把 GTK 键盘焦点交给输入框：
  // 进入第 2 步时再显式 focus + select，保证点一下就能直接改名。
  useEffect(() => {
    if (step === 1) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [step]);

  const handleCreateAccount = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setAccountError("先给自己取个名字吧，比如 Steve。");
      return;
    }
    if (/[\s/\\]/.test(trimmed)) {
      setAccountError("名字里不能有空格或斜杠，换一个试试。");
      return;
    }
    setCreating(true);
    setAccountError(null);
    try {
      const created = await api.createAccount(trimmed);
      const account: Account =
        normalizeAccount(created) ?? { name: trimmed, uuid: "", kind: "offline", hasSession: true };
      patchAccounts((list) => (list.some((item) => item.name === account.name) ? list : [...list, account]));
      toast.success("你好，" + account.name, { description: "启动游戏时就用这个名字。" });
      setStep(2);
    } catch (cause: unknown) {
      setAccountError(
        errorMessage(cause) + "。也可以先点「跳过」，进到游戏页后再设置名字。",
      );
    } finally {
      setCreating(false);
    }
  }, [name, patchAccounts]);

  const handleInstall = useCallback(async () => {
    setInstallError(null);
    try {
      const result = await api.installVersion(RECOMMENDED_VERSION, false);
      setJobId(result.jobId);
    } catch (cause: unknown) {
      setInstallError(errorMessage(cause) + "。可以点「跳过」，等启动器服务正常了再装。");
    }
  }, []);

  const handlePickVersion = useCallback(
    async (id: string) => {
      try {
        await saveSettings({ selectVersion: id });
        toast.success("已经选好 " + id);
      } catch {
        // 选不上不影响继续用，游戏页里还能再选
      }
      finish();
    },
    [saveSettings, finish],
  );

  const percent = clampPercent(job?.progress ?? 0);
  const hasVersion = versions.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm"
    >
      <div className="card-soft relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="brand-solid h-1.5 w-full shrink-0" />

        <div className="flex shrink-0 items-center justify-between px-6 pt-4">
          <div className="flex items-center gap-2">
            {STEP_TITLES.map((title, index) => (
              <span key={title} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
                    index < step
                      ? "bg-pcl-3 text-white"
                      : index === step
                        ? "brand-solid text-white"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {index < step ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span
                  className={cn(
                    "hidden text-[11px] sm:inline",
                    index === step ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {title}
                </span>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label="关闭引导"
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 0 ? (
            <div className="text-center">
              <span className="brand-solid mx-auto flex size-16 items-center justify-center rounded-3xl text-white shadow-lg">
                <PartyPopper className="size-8" />
              </span>
              <h2 className="mt-4 text-xl font-semibold tracking-tight">欢迎来到 LilyCraft 启动器</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
                它是一个「帮你把 Minecraft 装好、开起来」的小工具：装一次版本，之后每次只要点一个按钮。
              </p>
              <p className="mt-4 rounded-xl border-l-[3px] border-primary bg-pcl-8/70 px-3 py-2 text-left text-[13px] leading-relaxed text-muted-foreground dark:bg-muted/50">
                接下来只有两个小问题：你想叫什么名字、想玩哪个版本。十几秒就好。
              </p>
            </div>
          ) : step === 1 ? (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <UserRound className="size-5 text-primary" />
                你的名字
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                这是游戏里显示的名字，随便取，之后可以改。暂时没有正版账号也没关系，直接用名字就能玩。
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Input
                  ref={inputRef}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setAccountError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleCreateAccount();
                    }
                  }}
                  onFocus={(event) => event.currentTarget.select()}
                  maxLength={16}
                  placeholder="例如 Steve"
                  className="h-10 min-w-48 flex-1"
                  aria-label="你的名字"
                  autoFocus
                />
                <Button onClick={() => { void handleCreateAccount(); }} disabled={creating}>
                  {creating ? <Loader2 className="animate-spin" /> : null}
                  就用它
                </Button>
              </div>
              {accountError !== null ? (
                <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs leading-relaxed text-destructive">
                  {accountError}
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">想用正版皮肤？可以稍后在「设置 → 账号」里登录正版账号。</p>
              )}
            </div>
          ) : (
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Download className="size-5 text-primary" />
                玩哪个版本
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                已经装好的直接选；一个都没装的话，点下面的按钮帮你装一个最常用的。
              </p>

              <div className="mt-4 space-y-2">
                {versions.length > 0 ? (
                  versions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => { void handlePickVersion(item.id); }}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-pcl-8/60 px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-pcl-7/70 dark:bg-muted/40 dark:hover:bg-muted"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary ring-1 ring-border">
                        <Play className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{item.id}</span>
                          <VersionKindBadge kind={item.kind} />
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          基础版本 {item.baseVersion}
                          {item.javaMajor > 0 ? " · 需要 Java " + item.javaMajor : ""}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  ))
                ) : installedId !== null ? (
                  <div className="rounded-xl border border-pcl-4/40 bg-pcl-7 px-3 py-3 text-sm text-pcl-2 dark:text-pcl-5">
                    <span className="flex items-center gap-1.5 font-medium">
                      <CircleCheck className="size-4" />
                      {installedId} 已经装好了
                    </span>
                    <p className="mt-1 text-[11px] leading-relaxed">
                      回到「游戏」页，点中间的大按钮就能开玩。第一次启动会久一点，请耐心等。
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-pcl-8/60 px-3 py-4 text-center dark:bg-muted/30">
                    <p className="text-sm font-medium">还没有装任何版本</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      推荐装 {RECOMMENDED_VERSION}：稳定、Mod 最多，绝大多数电脑都能带得动。
                    </p>
                    <Button
                      className="mt-3 w-full"
                      onClick={() => { void handleInstall(); }}
                      disabled={jobId !== null && job?.state === "running"}
                    >
                      {jobId !== null && job?.state !== "done" ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Download />
                      )}
                      帮我装 {RECOMMENDED_VERSION}
                    </Button>
                  </div>
                )}

                {jobId !== null ? (
                  <div className="rounded-xl border border-border bg-card px-3 py-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium">正在安装 {RECOMMENDED_VERSION}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {formatPercent(percent)}
                      </span>
                    </div>
                    <Progress value={percent} className="mt-2 h-2" />
                    <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">
                      {job?.message ?? "正在准备下载…"}
                    </p>
                  </div>
                ) : null}

                {installError !== null ? (
                  <p className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-xs leading-relaxed text-destructive">
                    {installError}
                  </p>
                ) : null}
                {jobError !== null && installError === null && jobId !== null ? (
                  <p className="text-xs text-muted-foreground">
                    进度偶尔会慢一拍，正在自动重试（{jobError}）。
                  </p>
                ) : null}
                {!hasVersion && installedId === null && versions.length === 0 ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    装好后会显示在上面，下次打开启动器就不用再装了。
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-pcl-8/50 px-6 py-3 dark:bg-muted/30">
          <Button variant="ghost" size="sm" onClick={finish}>
            <SkipForward />
            跳过引导
          </Button>
          <div className="flex items-center gap-2">
            {step > 0 ? (
              <Button variant="outline" size="sm" onClick={() => { setStep(step - 1); }}>
                上一步
              </Button>
            ) : null}
            {step === 0 ? (
              <Button size="sm" onClick={() => { setStep(1); }}>
                开始
                <ArrowRight />
              </Button>
            ) : step === 1 ? (
              <Button size="sm" onClick={() => { void handleCreateAccount(); }} disabled={creating}>
                下一步
                <ArrowRight />
              </Button>
            ) : (
              <Button size="sm" onClick={finish}>
                完成
                <ArrowRight />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
