import { Badge } from "@/components/ui/badge";
import { AccountMenu } from "@/components/account-menu";
import { SkinAvatar } from "@/components/skin-avatar";
import { useAppData } from "@/context/app-data-context";
import { type AccountSkin } from "@/lib/api";
import { loadAccountSkinByKey, skinKeyFor } from "@/lib/account-skin";
import { HELP_NAV_ITEM, NAV_ITEMS, type NavItem } from "@/lib/nav";
import { hrefFor, normalizeHash, useRoutePath } from "@/lib/router";
import { shortUuid } from "@/lib/format";
import { useKeyedFetch } from "@/lib/use-keyed-fetch";
import { cn } from "@/lib/utils";
import { BookOpen, ChevronsUpDown, DatabaseBackup, Languages, Package, Palette, SquareStack } from "lucide-react";

/** 浅蓝分组侧栏：分组标题 + 蓝色竖条激活项 + 底部账号卡。 */
export function AppSidebar() {
  const path = useRoutePath();
  const { currentAccount, running, backendDown, versions } = useAppData();
  const skinKey = currentAccount !== null ? skinKeyFor(currentAccount) : "";
  const { data: skin } = useKeyedFetch<AccountSkin>(skinKey, loadAccountSkinByKey);

  const HelpIcon = HELP_NAV_ITEM.icon;
  /** 备份与帮助入口放在「启动器」组，主导航仍由 NAV_ITEMS 统一驱动。 */
  const gameNavItems: NavItem[] = NAV_ITEMS.filter(
    (item) => item.to !== "/backup" && item.to !== HELP_NAV_ITEM.to,
  );
  const isMicrosoft = currentAccount?.kind === "microsoft";
  const needsLogin = isMicrosoft && currentAccount !== null && !currentAccount.hasSession;
  const skinUrl = skin?.skinUrl ?? currentAccount?.skinUrl ?? null;
  const skinModel = skin?.skinModel ?? currentAccount?.skinModel ?? "classic";
  const useBuiltinFallback = skin?.fallback === true;
  const accountName = currentAccount !== null ? currentAccount.name : "未登录";
  const tooltip =
    currentAccount === null
      ? "还没有账号，去「设置」里添加或进行正版登录"
      : (isMicrosoft ? "微软正版账号 · UUID " : "离线账号 · UUID ") + shortUuid(currentAccount.uuid);

  return (
    <aside className="flex w-[190px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:w-[204px]">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
        <div>
          <p className="px-3 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground">游戏</p>
          <nav className="flex flex-col gap-0.5">
            {gameNavItems.map((item) => {
              const Icon = item.icon;
              const active = path === normalizeHash(item.to);
              return (
                <a
                  key={item.to}
                  href={item.to === "/" ? "#/" : "#" + item.to}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                  )}
                >
                  {active ? (
                    <span className="brand-solid absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full" />
                  ) : null}
                  <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                  <span className="truncate">{item.label}</span>
                  {item.to === "/versions" && versions.length > 0 ? (
                    <span className="ml-auto rounded-full bg-pcl-7 px-1.5 py-0.5 text-[10px] font-semibold text-pcl-2">
                      {versions.length}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </nav>
        </div>

        <div>
          <p className="px-3 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground">启动器</p>
          <div className="flex flex-col gap-0.5">
            <a
              href="#/guide"
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                path === "/guide"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              )}
            >
              {path === "/guide" ? (
                <span className="brand-solid absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full" />
              ) : null}
              <BookOpen className={cn("size-4 shrink-0", path === "/guide" ? "text-primary" : "text-muted-foreground")} />
              使用教程
            </a>
            <a
              href="#/backup"
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                path === "/backup"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              )}
            >
              {path === "/backup" ? (
                <span className="brand-solid absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full" />
              ) : null}
              <DatabaseBackup className={cn("size-4 shrink-0", path === "/backup" ? "text-primary" : "text-muted-foreground")} />
              备份与清理
            </a>
            <a
              data-help-nav="sidebar"
              aria-label={HELP_NAV_ITEM.label}
              href={hrefFor(HELP_NAV_ITEM.to)}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors",
                path === HELP_NAV_ITEM.to
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
              )}
            >
              {path === HELP_NAV_ITEM.to ? (
                <span className="brand-solid absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full" />
              ) : null}
              <HelpIcon className={cn("size-4 shrink-0", path === HELP_NAV_ITEM.to ? "text-primary" : "text-muted-foreground")} />
              {HELP_NAV_ITEM.label}
            </a>
            <a href="#/settings" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground">
              <Palette className="size-4 shrink-0 text-muted-foreground" />
              个性化
            </a>
            <a href="#/settings" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground">
              <Languages className="size-4 shrink-0 text-muted-foreground" />
              语言与杂项
            </a>
          </div>
        </div>

        <div>
          <p className="px-3 pb-2 text-[11px] font-medium tracking-wide text-muted-foreground">社区资源</p>
          <div className="flex flex-col gap-0.5">
            <a href="#/mods" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground">
              <SquareStack className="size-4 shrink-0 text-muted-foreground" />
              模组管理
            </a>
            <a href="#/download" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground">
              <Package className="size-4 shrink-0 text-muted-foreground" />
              安装包
            </a>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-sidebar-border px-3 py-3">
        {running.length > 0 ? (
          <div className="flex items-center gap-2 rounded-lg bg-pcl-7 px-2.5 py-1.5 text-[11px] font-medium text-pcl-2 dark:text-pcl-5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-pcl-3 opacity-70" />
              <span className="relative inline-flex size-2 rounded-full bg-pcl-3" />
            </span>
            游戏运行中（{running.length}）
          </div>
        ) : null}

        <AccountMenu side="top" align="start">
          <button
            type="button"
            title={tooltip + " · 点击快速切换或设为默认账号"}
            aria-label="快速切换账号或设置默认账号"
            className="w-full rounded-xl border border-sidebar-border bg-pcl-8/60 p-2.5 text-left transition-all hover:border-pcl-4 hover:bg-pcl-7/70 active:translate-y-px dark:bg-muted/50 dark:hover:bg-muted"
          >
            <span className="flex items-center gap-2.5">
              <SkinAvatar
                skinUrl={skinUrl}
                model={skinModel}
                size={40}
                fallback={useBuiltinFallback}
                title={"当前账号 " + accountName + " 的皮肤头像"}
                className="size-10 shrink-0 rounded-xl ring-1 ring-sidebar-border"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] text-muted-foreground">当前账号</span>
                <span className="block truncate text-sm font-medium text-sidebar-foreground">{accountName}</span>
                <span className="mt-0.5 flex items-center gap-1">
                  {currentAccount !== null ? (
                    <Badge variant={isMicrosoft ? "secondary" : "outline"} className="h-4 px-1 text-[9px]">
                      {isMicrosoft ? "正版" : "离线账号"}
                    </Badge>
                  ) : null}
                  {needsLogin ? (
                    <Badge variant="destructive" className="h-4 px-1 text-[9px]">需重新登录</Badge>
                  ) : null}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </span>
          </button>
        </AccountMenu>

        <div className="flex items-center justify-between">
          <Badge
            variant="outline"
            className={cn(
              "h-5 gap-1 text-[10px]",
              backendDown
                ? "border-pcl-4/50 text-pcl-2 dark:text-pcl-5"
                : "border-pcl-4/50 text-pcl-2 dark:text-pcl-5",
            )}
          >
            <span className={cn("size-1.5 rounded-full", backendDown ? "bg-pcl-4" : "bg-pcl-3")} />
            {backendDown ? "未连接" : "已连接"}
          </Badge>
          <span className="text-[10px] text-muted-foreground">LilyCraft 0.1</span>
        </div>
      </div>
    </aside>
  );
}
