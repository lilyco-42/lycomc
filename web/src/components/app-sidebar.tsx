import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppData } from "@/context/app-data-context";
import { NAV_ITEMS } from "@/lib/nav";
import { normalizeHash, useRoutePath } from "@/lib/router";
import { shortUuid } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 左侧固定竖栏：logo + 导航 + 底部账号 / 主题切换。 */
export function AppSidebar() {
  const path = useRoutePath();
  const { currentAccount, running, backendDown, versions } = useAppData();

  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <span className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-md">
          LC
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
            LilyCraft
          </p>
          <p className="truncate text-[11px] text-muted-foreground">启动器</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-2.5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = path === normalizeHash(item.to);
          return (
            <a
              key={item.to}
              href={item.to === "/" ? "#/" : "#" + item.to}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              {active ? (
                <span className="brand-gradient absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full" />
              ) : null}
              <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "")} />
              <span className="truncate">{item.label}</span>
              {item.to === "/versions" && versions.length > 0 ? (
                <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {versions.length}
                </span>
              ) : null}
            </a>
          );
        })}
      </nav>

      <div className="space-y-2 px-2.5 pb-4">
        {running.length > 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-emerald-500 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            游戏运行中（{running.length}）
          </div>
        ) : null}

        <div className="rounded-xl border border-sidebar-border bg-background/50 p-2.5">
          <p className="text-[11px] text-muted-foreground">当前账号</p>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="mt-0.5 truncate text-sm font-medium text-sidebar-foreground">
                {currentAccount !== null ? currentAccount.name : "未登录"}
              </p>
            </TooltipTrigger>
            <TooltipContent>
              {currentAccount !== null
                ? "离线账号 · UUID " + shortUuid(currentAccount.uuid)
                : "还没有离线账号，去「设置」里添加一个"}
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className={cn(
              "h-5 gap-1 text-[10px]",
              backendDown
                ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                : "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", backendDown ? "bg-amber-500" : "bg-emerald-500")}
            />
            {backendDown ? "未连接" : "已连接"}
          </Badge>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
