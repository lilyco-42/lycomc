import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VersionKind } from "@/lib/api";

interface VersionAvatarProps {
  kind: VersionKind;
  label: string;
  /** 实例自定义图标（emoji 或短文字）；未提供时按版本类型绘制方块 */
  icon?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: "size-9 text-[11px] rounded-lg",
  md: "size-11 text-xs rounded-xl",
  lg: "size-16 text-sm rounded-2xl",
} as const;

/**
 * 版本方块：三面等距立方体用离散实色区分，不使用纯色渐变或半透明高光。
 * Fabric 用更深的右侧面，原版用亮蓝；中央放真实 lucide 图标或版本短号。
 */
export function VersionAvatar({ kind, label, icon, size = "md", className }: VersionAvatarProps) {
  const short = label.replace(/^fabric-/, "").split("-")[0] ?? label;
  const customIcon = typeof icon === "string" ? icon.trim() : "";
  const useCustomIcon = customIcon !== "" && Array.from(customIcon).length <= 4;
  if (useCustomIcon) {
    return (
      <span
        className={cn(
          "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-primary/35 bg-pcl-7 font-semibold text-primary shadow-sm dark:bg-muted",
          SIZES[size],
          className,
        )}
        title={label}
      >
        <span className="max-w-full truncate px-0.5 text-center leading-none">{customIcon}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden font-semibold text-white shadow-sm",
        SIZES[size],
        className,
      )}
    >
      <svg viewBox="0 0 64 64" className="absolute inset-0 size-full" aria-hidden="true">
        <rect x="0" y="0" width="64" height="64" fill={kind === "fabric" ? "#1662b6" : "#2078da"} />
        <path d="M32 10 L54 22 L32 34 L10 22 Z" fill="#9ec1ee" />
        <path d="M10 22 L32 34 L32 54 L10 42 Z" fill="#5291df" />
        <path d="M54 22 L32 34 L32 54 L54 42 Z" fill={kind === "fabric" ? "#0b4a92" : "#1662b6"} />
      </svg>
      {kind === "fabric" ? (
        <Layers className="relative size-4 drop-shadow-[0_1px_1px_rgb(11_74_146_/_80%)]" />
      ) : (
        <span className="relative max-w-full truncate px-1 text-center font-mono leading-none drop-shadow-[0_1px_1px_rgb(11_74_146_/_80%)]">
          {short}
        </span>
      )}
    </span>
  );
}
