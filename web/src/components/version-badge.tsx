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
          "gap-1 border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
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
        "gap-1 border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
        className,
      )}
    >
      <Boxes />
      原版
    </Badge>
  );
}
