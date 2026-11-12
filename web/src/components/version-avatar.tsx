import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VersionKind } from "@/lib/api";

interface VersionAvatarProps {
  kind: VersionKind;
  label: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "size-9 text-[11px] rounded-lg",
  md: "size-11 text-xs rounded-xl",
  lg: "size-16 text-sm rounded-2xl",
} as const;

/** 版本方块图标：Fabric 用深蓝，原版用亮蓝，统一在 PCL 蓝色层级内。 */
export function VersionAvatar({ kind, label, size = "md", className }: VersionAvatarProps) {
  const short = label.replace(/^fabric-/, "").split("-")[0] ?? label;
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white shadow-sm",
        SIZES[size],
        className,
      )}
    >
      <span
        className={cn(
          "absolute inset-0",
          kind === "fabric"
            ? "bg-linear-to-br from-pcl-2 to-pcl-4"
            : "bg-linear-to-br from-pcl-3 to-pcl-5",
        )}
      />
      <span className="absolute inset-0 bg-linear-to-b from-white/30 to-transparent opacity-70" />
      {kind === "fabric" ? (
        <Layers className="relative size-4" />
      ) : (
        <span className="relative max-w-full truncate px-1 text-center font-mono leading-none">
          {short}
        </span>
      )}
    </span>
  );
}
