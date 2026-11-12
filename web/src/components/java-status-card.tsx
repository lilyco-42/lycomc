import { Coffee, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeader } from "@/components/section-header";
import { shortenMiddle } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { JavaInfo } from "@/lib/api";

interface JavaStatusCardProps {
  javas: JavaInfo[];
  loading?: boolean;
  /** 选中版本需要的 Java 主版本，用于展示是否匹配 */
  requiredMajor?: number;
  javaPath?: string | null;
  className?: string;
}

/** Java 状态小卡片：列出检测到的 JRE，并标出与当前版本是否匹配。 */
export function JavaStatusCard({
  javas,
  loading = false,
  requiredMajor,
  javaPath,
  className,
}: JavaStatusCardProps) {
  const preferred =
    javaPath !== null && javaPath !== undefined && javaPath !== ""
      ? javas.find((item) => item.path === javaPath)
      : undefined;
  const matched =
    requiredMajor !== undefined && requiredMajor > 0
      ? javas.find((item) => item.version === requiredMajor)
      : undefined;

  return (
    <div className={cn("card-soft rounded-2xl border border-border bg-card p-4", className)}>
      <SectionHeader
        icon={Coffee}
        title="Java 环境"
        description={javas.length > 0 ? "已检测到 " + javas.length + " 个运行时" : "未检测到 Java"}
        action={
          matched !== undefined ? (
            <Badge
              variant="outline"
              className="gap-1 border-pcl-4/50 bg-pcl-7 text-pcl-2 dark:text-pcl-5"
            >
              匹配 Java {requiredMajor}
            </Badge>
          ) : requiredMajor !== undefined && requiredMajor > 0 && !loading ? (
            <Badge variant="outline" className="gap-1 border-pcl-4/50 bg-pcl-7 text-pcl-2 dark:text-pcl-5">
              <TriangleAlert />
              缺 Java {requiredMajor}
            </Badge>
          ) : null
        }
      />

      <div className="mt-3 space-y-2">
        {loading ? (
          <>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </>
        ) : javas.length === 0 ? (
          <p className="rounded-xl bg-pcl-8/50 dark:bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            还没有可用的 Java。启动器会在安装版本时自动下载托管 JRE，也可以在设置里手动指定
            <code className="mx-1 rounded bg-background px-1 py-0.5 font-mono text-[11px]">javaPath</code>
            路径。
          </p>
        ) : (
          javas.slice(0, 4).map((item) => {
            const isPreferred = preferred?.path === item.path;
            return (
              <div
                key={item.path + item.version}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-2.5 py-2",
                  isPreferred
                    ? "border-primary/40 bg-primary/5"
                    : "border-border bg-pcl-8/50 dark:bg-muted/40",
                )}
              >
                <span className="flex size-7 items-center justify-center rounded-lg bg-background font-mono text-[11px] font-semibold text-foreground ring-1 ring-border">
                  {item.version > 0 ? item.version : "?"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">Java {item.version || "未知版本"}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground" title={item.path}>
                    {shortenMiddle(item.path, 38)}
                  </p>
                </div>
                <Badge variant="ghost" className="shrink-0 text-[10px] text-muted-foreground">
                  {item.source === "managed" ? "托管" : "系统"}
                </Badge>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
