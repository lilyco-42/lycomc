import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  tone?: "default" | "brand";
}

/** 空态占位：图标 + 中文说明 + 可选操作。 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = "default",
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-pcl-8/60 dark:bg-muted/30 px-6 py-14 text-center",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-2xl ring-1",
          tone === "brand"
            ? "brand-gradient text-white ring-transparent shadow-md"
            : "bg-background text-muted-foreground ring-border",
        )}
      >
        <Icon className="size-5.5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
