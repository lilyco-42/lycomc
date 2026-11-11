import { Download, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/section-header";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";
import type { RemoteData } from "@/lib/api";

interface RemoteLatestCardProps {
  remote: RemoteData | null;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  className?: string;
}

/** 远程最新版本小卡片：正式版 / 快照 + 刷新。 */
export function RemoteLatestCard({
  remote,
  loading = false,
  error = null,
  onRefresh,
  className,
}: RemoteLatestCardProps) {
  const latest = remote?.latest ?? null;
  const total = remote?.versions.length ?? 0;

  return (
    <div className={cn("card-soft rounded-2xl border border-border bg-card p-4", className)}>
      <SectionHeader
        icon={Sparkles}
        title="最新版本"
        description={total > 0 ? "已获取 " + total + " 个远程版本" : "来自 Mojang 版本清单"}
        action={
          onRefresh !== undefined ? (
            <Button variant="ghost" size="icon-sm" onClick={onRefresh} disabled={loading} aria-label="刷新远程版本">
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
          ) : null
        }
      />

      <div className="mt-3 space-y-2">
        {loading && latest === null ? (
          <>
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </>
        ) : error !== null && latest === null ? (
          <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            拿不到远程版本：{error}
          </p>
        ) : latest === null ? (
          <p className="rounded-xl bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            还没有远程版本数据，点右上角刷新试试。
          </p>
        ) : (
          <>
            <RemoteRow label="正式版" value={latest.release} tone="cyan" />
            <RemoteRow label="快照" value={latest.snapshot} tone="violet" />
          </>
        )}
      </div>

      <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => { navigate("/download"); }}>
        <Download />
        去下载页挑版本
      </Button>
    </div>
  );
}

interface RemoteRowProps {
  label: string;
  value: string;
  tone: "cyan" | "violet";
}

function RemoteRow({ label, value, tone }: RemoteRowProps) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-2.5 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-mono text-sm font-semibold",
          tone === "cyan" ? "text-cyan-600 dark:text-cyan-300" : "text-violet-600 dark:text-violet-300",
        )}
      >
        {value === "" ? "未知" : value}
      </span>
    </div>
  );
}
