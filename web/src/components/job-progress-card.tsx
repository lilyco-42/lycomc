import { useEffect, useRef, type ReactNode } from "react";
import { CircleCheck, CircleX, Loader2, Terminal } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Job } from "@/lib/api";
import { clampPercent, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

interface JobProgressCardProps {
  job: Job | null;
  /** 静默等待中（还没收到第一帧） */
  waiting?: boolean;
  logs?: string[];
  live?: boolean;
  title?: string;
  className?: string;
  footer?: ReactNode;
  onDismiss?: () => void;
}

/** 通用任务进度卡：标题 + 进度条 + 当前步骤 + 日志尾部。 */
export function JobProgressCard({
  job,
  waiting = false,
  logs,
  live = false,
  title,
  className,
  footer,
  onDismiss,
}: JobProgressCardProps) {
  const percent = clampPercent(job?.progress ?? 0);
  const lines = logs ?? job?.logs ?? [];
  const done = job?.state === "done";
  const failed = job?.state === "error";
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = logRef.current;
    if (node !== null) {
      node.scrollTop = node.scrollHeight;
    }
  }, [lines.length]);

  const stateBadge = done ? (
    <Badge variant="outline" className="gap-1 border-pcl-4/50 bg-pcl-7 text-pcl-2 dark:text-pcl-5">
      <CircleCheck />
      已完成
    </Badge>
  ) : failed ? (
    <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-destructive">
      <CircleX />
      失败
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Loader2 className="animate-spin" />
      {waiting && job === null ? "排队中" : "进行中"}
    </Badge>
  );

  return (
    <div
      className={cn(
        "card-soft rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-semibold">{title ?? job?.title ?? "任务"}</p>
          {stateBadge}
          {!live && !done && !failed && job !== null ? (
            <span className="text-[11px] text-muted-foreground">（实时连接未建立，进度来自轮询）</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {formatPercent(percent)}
          </span>
          {onDismiss !== undefined && (done || failed) ? (
            <Button variant="ghost" size="xs" onClick={onDismiss}>
              收起
            </Button>
          ) : null}
        </div>
      </div>

      <Progress value={percent} className="mt-3 h-2" />

      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
        {job?.message ?? (waiting ? "正在提交任务…" : "等待后端返回进度")}
      </p>

      {lines.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-pcl-8/50 dark:bg-muted/40">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
            <Terminal className="size-3.5" />
            日志（{lines.length} 行）
          </div>
          <div
            ref={logRef}
            className="max-h-48 overflow-y-auto px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
          >
            {lines.slice(-120).map((line, index) => (
              <div key={index} className="break-all">
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {failed && job?.message ? (
        <p className="mt-2 rounded-lg bg-destructive/10 px-2.5 py-1.5 font-mono text-xs break-words text-destructive">
          {job.message}
        </p>
      ) : null}

      {footer ? <div className="mt-3 flex flex-wrap items-center gap-2">{footer}</div> : null}
    </div>
  );
}
