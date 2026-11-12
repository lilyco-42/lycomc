import { Boxes, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VersionKind } from "@/lib/api";

interface VersionKindBadgeProps {
  kind: VersionKind;
  className?: string;
}

/** 原版 / Fabric 标签，配色区分但不喧宾夺主。 */
export function VersionKindBadge({ kind, className }: VersionKindBadgeProps) {
  if (kind === "fabric") {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1 border-pcl-4/40 bg-pcl-7 text-pcl-2 dark:bg-muted dark:text-pcl-6",
          className,
        )}
      >
        <Layers />
        Fabric
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-pcl-3/40 bg-pcl-8 text-pcl-3 dark:bg-muted dark:text-pcl-5",
        className,
      )}
    >
      <Boxes />
      原版
    </Badge>
  );
}
