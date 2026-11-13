import { useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, Star, X } from "lucide-react";
import { toast } from "sonner";
import { SkinAvatar } from "@/components/skin-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppData } from "@/context/app-data-context";
import { errorMessage } from "@/lib/api";

interface AccountMenuProps {
  /** 触发器的渲染内容（按钮/药丸/账号卡），由调用方自研决定样式。 */
  children: ReactNode;
  /** "top" = 侧栏左下角向上弹出；"bottom" = 顶栏向下弹出。 */
  side?: "top" | "bottom";
  /** 对齐方式。 */
  align?: "start" | "end";
}

/**
 * 左下角/顶栏共用账号快速切换菜单：列出所有账号、切换当前账号、设为默认账号。
 * 快速切换只影响本会话显示；「设为默认」持久化到 settings.json。
 */
export function AccountMenu({ children, side = "top", align = "start" }: AccountMenuProps) {
  const {
    accounts,
    currentAccount,
    defaultAccount,
    switchAccount,
    setDefaultAccount,
    saveSettings,
  } = useAppData();
  const [busy, setBusy] = useState<string | null>(null);
  const defaultName = (defaultAccount !== null && accounts.some((item) => item.name === defaultAccount))
    ? defaultAccount
    : (accounts[0]?.name ?? null);

  const handleDefault = async (name: string): Promise<void> => {
    setBusy(name);
    try {
      await setDefaultAccount(name);
      toast.success("已把 " + name + " 设为默认账号");
    } catch (cause: unknown) {
      toast.error("设为默认账号失败", { description: errorMessage(cause) });
    } finally {
      setBusy(null);
    }
  };

  /** 清除持久化默认账号：PUT /api/settings，前端自动回退列表第一项。 */
  const handleClearDefault = async (): Promise<void> => {
    setBusy("__clear__");
    try {
      await saveSettings({ defaultAccount: null });
      toast.success("已清除默认账号，将回退账号列表第一项");
    } catch (cause: unknown) {
      toast.error("清除默认账号失败", { description: errorMessage(cause) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={align} className="w-64">
        <DropdownMenuLabel className="flex items-center gap-1.5">
          <ChevronsUpDown className="size-3.5" />
          快速切换账号
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {accounts.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">还没有账号，去「设置」里添加</p>
        ) : (
          accounts.map((account) => {
            const active = currentAccount?.name === account.name;
            return (
              <DropdownMenuItem
                key={account.name}
                className="flex items-center gap-2 py-1.5"
                onSelect={(event) => {
                  event.preventDefault();
                  switchAccount(account.name);
                }}
              >
                <SkinAvatar
                  skinUrl={account.skinUrl ?? null}
                  model={account.skinModel ?? "classic"}
                  size={24}
                  title={account.name + " 的头像"}
                  className="size-6 shrink-0 rounded-md ring-1 ring-border"
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{account.name}</span>
                {account.kind === "microsoft" ? (
                  <span className="rounded bg-pcl-7 px-1 text-[9px] text-pcl-2">正版</span>
                ) : null}
                {active ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px]">默认账号（下次启动）</DropdownMenuLabel>
        {accounts.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">无可用账号</p>
        ) : (
          accounts.map((account) => {
            const isDefault = defaultName === account.name;
            return (
              <DropdownMenuItem
                key={account.name}
                className="flex items-center gap-2 py-1.5 text-xs"
                disabled={busy !== null}
                onSelect={(event) => {
                  event.preventDefault();
                  void handleDefault(account.name);
                }}
              >
                {isDefault ? <Check className="size-3.5 text-primary" /> : <Star className="size-3.5 text-muted-foreground" />}
                <span className="truncate">{account.name}</span>
                {isDefault ? <span className="ml-auto text-[10px] text-muted-foreground">当前默认</span> : null}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-xs text-muted-foreground"
          disabled={defaultAccount === null || busy !== null}
          onSelect={(event) => {
            event.preventDefault();
            void handleClearDefault();
          }}
        >
          <X className="size-3.5" />
          清除默认（回退第一项）
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
