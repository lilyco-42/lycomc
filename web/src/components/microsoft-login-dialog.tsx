import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppData } from "@/context/app-data-context";
import { api, errorMessage, type Account, type MicrosoftStartResponse } from "@/lib/api";
import { normalizeAccount } from "@/lib/normalize";

interface MicrosoftLoginDialogProps {
  /** 可自定义触发按钮；默认显示「微软正版登录」 */
  trigger?: ReactNode;
  /** 登录成功后额外回调（对话框内部已经 patchAccounts + reload） */
  onDone?: (account: Account) => void;
}

type LoginPhase = "idle" | "waiting" | "expired" | "done";

function intervalMs(seconds: number): number {
  const safe = Number.isFinite(seconds) ? Math.floor(seconds) : 5;
  return Math.min(60, Math.max(2, safe)) * 1000;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return String(minutes).padStart(2, "0") + ":" + String(rest).padStart(2, "0");
}

/**
 * PCL 风格微软设备代码登录：显示 userCode / 验证网址 / 倒计时，
 * 按后端建议 interval 轮询；关闭或卸载时所有定时器都会清理。
 */
export function MicrosoftLoginDialog({ trigger, onDone }: MicrosoftLoginDialogProps) {
  const { patchAccounts, reload } = useAppData();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<MicrosoftStartResponse | null>(null);
  const [phase, setPhase] = useState<LoginPhase>("idle");
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);

  const openRef = useRef(false);
  const sequenceRef = useRef(0);
  const startingRef = useRef(false);
  const expiredRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const beginLogin = useCallback(async () => {
    if (startingRef.current) {
      return;
    }
    startingRef.current = true;
    const token = ++sequenceRef.current;
    expiredRef.current = false;
    openRef.current = true;
    setPhase("waiting");
    setStarting(true);
    setStart(null);
    setError(null);
    setCopied(false);
    setRemaining(0);
    setMessage("正在向微软请求设备代码…");
    try {
      const response = await api.microsoftStart();
      if (!openRef.current || token !== sequenceRef.current) {
        return;
      }
      setStart(response);
      setRemaining(
        Number.isFinite(response.expiresIn) ? Math.max(0, Math.floor(response.expiresIn)) : 900,
      );
      setMessage(response.message || "请在浏览器中填入下方代码，完成微软授权");
    } catch (cause: unknown) {
      if (!openRef.current || token !== sequenceRef.current) {
        return;
      }
      const text = errorMessage(cause);
      setError(text);
      setPhase("expired");
      setMessage("后端未就绪或微软登录服务暂时不可用，请检查网络后重试。");
      toast.error("无法开始微软登录", { description: text });
    } finally {
      startingRef.current = false;
      if (openRef.current && token === sequenceRef.current) {
        setStarting(false);
      }
    }
  }, []);

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    openRef.current = next;
    if (!next) {
      sequenceRef.current += 1;
      expiredRef.current = true;
      setStart(null);
      setPhase("idle");
      setStarting(false);
      setError(null);
      setMessage("");
      setRemaining(0);
      setCopied(false);
    } else {
      void beginLogin();
    }
  }, [beginLogin]);

  // 倒计时到 0 时只挡住后续轮询，UI 直接显示「已过期，重新登录」。
  useEffect(() => {
    if (!open || phase !== "waiting" || start === null) {
      return;
    }
    const timer = window.setInterval(() => {
      setRemaining((previous) => {
        if (previous <= 1) {
          expiredRef.current = true;
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [open, phase, start]);

  // 递归 setTimeout 轮询：pending 继续，expired/done/网络异常都会停止。
  useEffect(() => {
    if (!open || phase !== "waiting" || start === null) {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    let delay = intervalMs(start.interval);
    const token = sequenceRef.current;

    const tick = async () => {
      if (cancelled || !openRef.current || expiredRef.current || token !== sequenceRef.current) {
        return;
      }
      try {
        const result = await api.microsoftPoll();
        if (cancelled || !openRef.current || token !== sequenceRef.current) {
          return;
        }
        if (result.status === "pending") {
          setMessage(result.message || "等待微软授权…");
          delay = intervalMs(result.interval);
          timer = window.setTimeout(() => { void tick(); }, delay);
          return;
        }
        if (result.status === "expired") {
          expiredRef.current = true;
          setPhase("expired");
          setMessage(result.message || "设备代码已过期，请重新登录");
          toast.error("设备代码已过期", { description: "请重新获取代码并完成授权" });
          return;
        }
        const account: Account = normalizeAccount(result.account) ?? {
          name: "Microsoft",
          uuid: "",
          kind: "microsoft",
          hasSession: true,
        };
        patchAccounts((list) => [account, ...list.filter((item) => item.name !== account.name)]);
        reload();
        onDoneRef.current?.(account);
        toast.success("微软正版登录成功", { description: account.name + " 已加入账号列表" });
        setPhase("done");
        setOpen(false);
        openRef.current = false;
        sequenceRef.current += 1;
        setStart(null);
      } catch (cause: unknown) {
        if (cancelled || !openRef.current || token !== sequenceRef.current) {
          return;
        }
        const text = errorMessage(cause);
        expiredRef.current = true;
        setError(text);
        setPhase("expired");
        setMessage("轮询中断：" + text + "。请重新登录或检查后端。");
        toast.error("微软登录轮询失败", { description: text });
      }
    };

    timer = window.setTimeout(() => { void tick(); }, delay);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [open, phase, start, patchAccounts, reload]);

  const handleCopy = useCallback(async () => {
    const code = start?.userCode ?? "";
    if (code === "") {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success("已复制设备代码 " + code);
    } catch {
      toast.error("复制失败", { description: "请点击代码框手动选中并复制" });
    }
  }, [start]);

  const handleOpenUri = useCallback(() => {
    const uri = start?.verificationUri ?? "";
    if (uri === "") {
      return;
    }
    const opened = window.open(uri, "_blank", "noopener,noreferrer");
    if (opened === null) {
      toast.error("浏览器拦截了新窗口", { description: "请手动访问 " + uri });
    }
  }, [start]);

  const expired = phase === "expired" || (start !== null && remaining === 0);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <ShieldCheck />
            微软正版登录
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            微软正版登录
          </DialogTitle>
          <DialogDescription>
            使用设备代码登录：在微软页面填入一次性代码，启动器会自动完成授权，凭据只保存在本地。
          </DialogDescription>
        </DialogHeader>

        {starting ? (
          <div className="flex items-center gap-2 rounded-xl bg-pcl-8/50 dark:bg-muted/40 p-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在获取设备代码…
          </div>
        ) : null}

        {start !== null && !starting ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-pcl-8/50 dark:bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">一次性设备代码</p>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  readOnly
                  value={start.userCode}
                  onFocus={(event) => { event.currentTarget.select(); }}
                  aria-label="微软设备代码"
                  className="h-10 font-mono text-lg font-semibold tracking-[0.25em]"
                />
                <Button variant="outline" size="icon" onClick={() => { void handleCopy(); }} aria-label="复制设备代码">
                  <Copy />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={handleOpenUri}>
                <ExternalLink />
                打开微软验证页面
              </Button>
              <Badge variant="outline" className="gap-1 font-mono">
                <Clock3 />
                {formatCountdown(remaining)}
              </Badge>
              {copied ? (
                <Badge variant="secondary" className="gap-1 text-pcl-2 dark:text-pcl-5">
                  <CircleCheck />
                  已复制
                </Badge>
              ) : null}
            </div>
            <p className="break-all text-[11px] text-muted-foreground">{start.verificationUri}</p>
            <div className="rounded-xl border border-border bg-pcl-8/70 dark:bg-pcl-8/50 dark:bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
              {expired ? "设备代码已过期，请重新登录。" : message}
            </div>
            {expired ? (
              <Button variant="secondary" size="sm" onClick={() => { void beginLogin(); }}>
                <RefreshCw />
                重新获取设备代码
              </Button>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                授权完成后本窗口会自动关闭；每 {Math.round(intervalMs(start.interval) / 1000)} 秒检查一次。
              </p>
            )}
          </div>
        ) : null}

        {start === null && !starting && error !== null ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              <span>{message}</span>
            </div>
            <p className="break-all text-[11px] text-muted-foreground">{error}</p>
            <Button variant="secondary" size="sm" onClick={() => { void beginLogin(); }}>
              <RefreshCw />
              重试
            </Button>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => { handleOpenChange(false); }}>
            取消登录
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
