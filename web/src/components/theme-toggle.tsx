import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** 深浅色切换。默认亮色；resolvedTheme 未就绪时按亮色渲染。 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("text-muted-foreground hover:text-foreground", className)}
          onClick={() => {
            setTheme(isDark ? "light" : "dark");
          }}
          aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
        >
          {isDark ? <Moon /> : <Sun />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isDark ? "切换到浅色模式" : "切换到深色模式"}</TooltipContent>
    </Tooltip>
  );
}
