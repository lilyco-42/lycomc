import { Loader2, Play, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface LaunchButtonProps {
  disabled?: boolean;
  launching?: boolean;
  running?: boolean;
  label?: string;
  hint?: string;
  onClick: () => void;
  className?: string;
}

/** PCL 风的巨型启动按钮：渐变底 + 高光 + 呼吸阴影。 */
export function LaunchButton({
  disabled = false,
  launching = false,
  running = false,
  label = "启动游戏",
  hint,
  onClick,
  className,
}: LaunchButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || launching}
      className={cn(
        "group relative flex h-16 w-full items-center justify-center gap-3 overflow-hidden rounded-2xl text-lg font-semibold tracking-wide transition-all",
        "brand-gradient text-white shadow-lg shadow-primary/25",
        "hover:shadow-xl hover:shadow-primary/30 hover:brightness-105",
        "active:translate-y-px active:brightness-95",
        "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:brightness-100",
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-0 bg-linear-to-b from-white/25 to-transparent opacity-60" />
      <span className="pointer-events-none absolute -top-16 -left-10 size-40 rounded-full bg-white/20 blur-2xl transition-transform duration-700 group-hover:translate-x-24" />
      {launching ? (
        <Loader2 className="size-6 animate-spin" />
      ) : running ? (
        <Square className="size-5" />
      ) : (
        <Play className="size-6 fill-current" />
      )}
      <span className="relative">{launching ? "启动中…" : running ? "正在运行" : label}</span>
      {hint ? (
        <span className="relative ml-1 hidden text-xs font-normal text-white/75 sm:inline">
          {hint}
        </span>
      ) : null}
    </button>
  );
}
