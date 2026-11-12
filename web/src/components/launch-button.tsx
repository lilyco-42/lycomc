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

/** PCL.Proto 风启动按钮：白底、蓝色描边与蓝字，而非旧版巨型渐变。 */
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
        "group flex min-h-14 w-full items-center justify-center gap-3 rounded-xl border-2 border-primary bg-card px-4 py-2.5 text-primary transition-all",
        "hover:bg-pcl-8 hover:shadow-[0_8px_20px_-12px_var(--primary)] dark:hover:bg-muted",
        "active:translate-y-px",
        "disabled:cursor-not-allowed disabled:border-muted disabled:bg-muted disabled:text-muted-foreground disabled:opacity-70",
        className,
      )}
    >
      {launching ? (
        <Loader2 className="size-5 animate-spin" />
      ) : running ? (
        <Square className="size-4" />
      ) : (
        <Play className="size-5 fill-current" />
      )}
      <span className="flex flex-col items-center leading-tight">
        <span className="text-base font-semibold">{launching ? "启动中…" : running ? "正在运行" : label}</span>
        {hint ? (
          <span className="mt-0.5 text-[11px] font-normal text-muted-foreground">{hint}</span>
        ) : null}
      </span>
    </button>
  );
}
