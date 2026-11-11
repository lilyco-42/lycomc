import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 深浅色切换。next-themes 在挂载前 resolvedTheme 为 undefined，此时按深色渲染（与 index.html 一致）。 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
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
