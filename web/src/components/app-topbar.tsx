import { Badge } from "@/components/ui/badge";
import { SkinAvatar } from "@/components/skin-avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAppData } from "@/context/app-data-context";
import { type AccountSkin } from "@/lib/api";
import { loadAccountSkinByKey, skinKeyFor } from "@/lib/account-skin";
import { NAV_ITEMS } from "@/lib/nav";
import { normalizeHash, useRoutePath } from "@/lib/router";
import { useKeyedFetch } from "@/lib/use-keyed-fetch";
import { cn } from "@/lib/utils";

/** 蓝色全宽标题栏：品牌 + 胶囊主导航 + 账号/连接状态。代码自研，仅参考布局与蓝色层级。 */
export function AppTopbar() {
  const path = useRoutePath();
  const { currentAccount, backendDown } = useAppData();
  const skinKey = currentAccount !== null ? skinKeyFor(currentAccount) : "";
  const { data: skin } = useKeyedFetch<AccountSkin>(skinKey, loadAccountSkinByKey);
  const skinUrl = skin?.skinUrl ?? currentAccount?.skinUrl ?? null;
  const skinModel = skin?.skinModel ?? currentAccount?.skinModel ?? "classic";
  const useBuiltinFallback = skin?.fallback === true;
  const accountName = currentAccount !== null ? currentAccount.name : "未登录";

  return (
    <header className="topbar-gradient relative z-20 flex h-14 shrink-0 items-center gap-3 px-4 text-white shadow-[0_2px_12px_rgb(22_98_182_/_22%)] md:px-6">
      <div className="flex shrink-0 items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-white/18 text-[11px] font-bold tracking-tight ring-1 ring-white/35">
          LC
        </span>
        <span className="hidden text-[15px] font-semibold tracking-wide sm:inline">LilyCraft</span>
        <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-pcl-2">
          Launcher
        </span>
      </div>

      <nav className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto md:gap-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = path === normalizeHash(item.to);
          return (
            <a
              key={item.to}
              href={item.to === "/" ? "#/" : "#" + item.to}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                active
                  ? "bg-white text-pcl-2 shadow-sm"
                  : "text-white/90 hover:bg-white/15 hover:text-white",
              )}
            >
              <Icon className="size-4" />
              <span>{item.short}</span>
            </a>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        <Badge
          variant="outline"
          className={cn(
            "hidden h-6 gap-1 border-white/40 text-[10px] text-white lg:inline-flex",
            backendDown ? "bg-white/20" : "bg-white/12",
          )}
        >
          <span className={cn("size-1.5 rounded-full", backendDown ? "bg-white/70" : "bg-white")} />
          {backendDown ? "未连接" : "已连接"}
        </Badge>
        <div className="hidden items-center gap-2 rounded-full bg-white/95 py-1 pr-1 pl-2 text-pcl-1 shadow-sm sm:flex">
          <span className="max-w-28 truncate text-xs font-medium">{accountName}</span>
          <SkinAvatar
            skinUrl={skinUrl}
            model={skinModel}
            size={24}
            fallback={useBuiltinFallback}
            title={"当前账号 " + accountName + " 的皮肤头像"}
            className="size-6 rounded-md ring-1 ring-pcl-6"
          />
        </div>
        <ThemeToggle className="text-white hover:bg-white/15 hover:text-white" />
      </div>
    </header>
  );
}
