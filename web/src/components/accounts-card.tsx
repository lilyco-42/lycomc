import { useCallback, useState } from "react";
import { CircleCheck, Loader2, Plus, Trash2, UserPlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { SectionHeader } from "@/components/section-header";
import { api, errorMessage, type Account } from "@/lib/api";
import { normalizeAccount } from "@/lib/normalize";
import { shortUuid } from "@/lib/format";
import { useAppData } from "@/context/app-data-context";

/** 离线账号增删（Account 契约：{name, uuid, kind:"offline"}）。 */
export function AccountsCard() {
  const { accounts, patchAccounts } = useAppData();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed === "") {
      setFormError("用户名不能为空");
      return;
    }
    if (/[\s/\\]/.test(trimmed)) {
      setFormError("用户名不能包含空格或斜杠");
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const created = await api.createAccount(trimmed);
      const account = normalizeAccount(created) ?? { name: trimmed, uuid: "", kind: "offline" };
      patchAccounts((list) => (list.some((item) => item.name === account.name) ? list : [...list, account]));
      setName("");
      toast.success("已添加离线账号 " + account.name);
    } catch (cause: unknown) {
      setFormError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }, [name, patchAccounts]);

  const handleRemove = useCallback(
    async (account: Account) => {
      setRemoving(account.name);
      try {
        await api.deleteAccount(account.name);
        patchAccounts((list) => list.filter((item) => item.name !== account.name));
        toast.success("已删除账号 " + account.name);
      } catch (cause: unknown) {
        toast.error("删除账号失败", { description: errorMessage(cause) });
      } finally {
        setRemoving(null);
      }
    },
    [patchAccounts],
  );

  return (
    <div className="card-soft rounded-2xl border border-border bg-card p-4">
      <SectionHeader
        icon={UserRound}
        title="账号管理"
        description="离线账号：UUID 由 md5(OfflinePlayer:<名字>) 推导，和后端一致"
        action={
          <Badge variant="ghost" className="text-[10px] text-muted-foreground">
            {accounts.length} 个
          </Badge>
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setFormError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              void handleCreate();
            }
          }}
          placeholder="输入离线用户名，例如 Steve"
          className="h-8 min-w-44 flex-1"
          maxLength={32}
        />
        <Button size="sm" onClick={() => { void handleCreate(); }} disabled={creating}>
          {creating ? <Loader2 className="animate-spin" /> : <UserPlus />}
          添加
        </Button>
      </div>
      {formError !== null ? (
        <p className="mt-1.5 text-xs text-destructive">{formError}</p>
      ) : null}

      <div className="mt-3 space-y-2">
        {accounts.length === 0 ? (
          <EmptyState
            icon={Plus}
            className="py-8"
            title="还没有离线账号"
            description="添加一个用户名就能启动游戏（正版登录后续再加）。"
          />
        ) : (
          accounts.map((account, index) => (
            <div
              key={account.name}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-2.5 py-2"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background font-mono text-[11px] font-semibold uppercase ring-1 ring-border">
                {account.name.slice(0, 2)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium">{account.name}</p>
                  {index === 0 ? (
                    <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                      <CircleCheck />
                      默认
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {shortUuid(account.uuid)}
                </p>
              </div>
              <Button
                variant="destructive"
                size="icon-xs"
                disabled={removing === account.name}
                onClick={() => { void handleRemove(account); }}
                aria-label={"删除账号 " + account.name}
              >
                {removing === account.name ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** 骨架，供设置页首屏使用 */
export function AccountsCardSkeleton() {
  return (
    <div className="card-soft space-y-2 rounded-2xl border border-border bg-card p-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}
