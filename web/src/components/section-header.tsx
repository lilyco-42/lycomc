import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/** 卡片内的蓝色分组小标题。 */
export function SectionHeader({ icon: Icon, title, description, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? (
          <span className="flex size-7 items-center justify-center rounded-lg bg-pcl-7 text-primary dark:bg-muted">
            <Icon className="size-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight text-primary">{title}</h2>
          {description ? (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
