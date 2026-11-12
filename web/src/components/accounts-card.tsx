import { useCallback, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { MicrosoftLoginDialog } from "@/components/microsoft-login-dialog";
import { SectionHeader } from "@/components/section-header";
import { SkinAvatar } from "@/components/skin-avatar";
import { useAppData } from "@/context/app-data-context";
import { api, errorMessage, type Account, type AccountSkin } from "@/lib/api";
import { loadAccountSkinByKey, skinKeyFor, skinModelLabel, skinSourceLabel } from "@/lib/account-skin";
import { normalizeAccount } from "@/lib/normalize";
import { shortUuid } from "@/lib/format";
import { useKeyedFetch } from "@/lib/use-keyed-fetch";

interface AccountRowProps {
  account: Account;
  index: number;
  busyKey: string | null;
  onRemove: (account: Account) => void;
  onRefresh: (account: Account) => void;
  onLogout: (account: Account) => void;
  onAccountsChanged: () => void;
}

/** 单个账号：皮肤头像、类型徽章、正版会话操作与离线删除。 */
function AccountRow({
  account,
  index,
  busyKey,
  onRemove,
  onRefresh,
  onLogout,
  onAccountsChanged,
}: AccountRowProps) {
  const { data: skin, loading: skinLoading, error: skinError } =
    useKeyedFetch<AccountSkin>(skinKeyFor(account), loadAccountSkinByKey);
  const isMicrosoft = account.kind === "microsoft";
  const needsLogin = isMicrosoft && !account.hasSession;
  // 皮肤详情接口比 /api/state 的账号快照更新，优先采用它的 URL / 模型 / 披风；详情未返回时退回快照。
  const skinUrl = skin?.skinUrl ?? account.skinUrl ?? null;
  const skinModel = skin?.skinModel ?? account.skinModel ?? "classic";
  const capeUrl = skin?.capeUrl ?? account.capeUrl ?? null;
  // 后端 fallback=true 表示官方纹理不可用，无条件切内置 Steve / Alex（slim 走 Alex）。
  const useBuiltinFallback = skin?.fallback === true;
  const refreshing = busyKey === account.name + ":refresh";
  const loggingOut = busyKey === account.name + ":logout";
  const removing = busyKey === account.name + ":remove";

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <SkinAvatar
          skinUrl={skinUrl}
          model={skinModel}
          size={40}
          fallback={useBuiltinFallback}
          title={account.name + " 的皮肤头像"}
          className="size-10 ring-1 ring-border"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-medium">{account.name}</p>
            {index === 0 ? (
              <Badge variant="outline" className="h-4 gap-0.5 px-1 text-[10px] text-emerald-600 dark:text-emerald-400">
                <CircleCheck />
                默认
              </Badge>
            ) : null}
            {isMicrosoft ? (
              <Badge variant="secondary" className="h-4 gap-0.5 px-1 text-[10px]">
                <ShieldCheck />
                正版
              </Badge>
            ) : (
              <Badge variant="outline" className="h-4 px-1 text-[10px] text-muted-foreground">
                离线账号
              </Badge>
            )}
            {needsLogin ? (
              <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                需重新登录
              </Badge>
            ) : null}
          </div>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {shortUuid(account.uuid)} · {isMicrosoft ? "微软设备代码登录" : "离线 UUID 按名字推导"}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {needsLogin ? (
            <>
              <Button
                variant="outline"
                size="xs"
                disabled={refreshing || loggingOut || removing}
                onClick={() => { onRefresh(account); }}
              >
                {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                刷新登录
              </Button>
              <MicrosoftLoginDialog
                trigger={
                  <Button variant="secondary" size="xs" disabled={refreshing || loggingOut || removing}>
                    <ShieldCheck />
                    重新登录
                  </Button>
                }
                onDone={onAccountsChanged}
              />
            </>
          ) : null}
          {isMicrosoft ? (
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={loggingOut || removing}
              onClick={() => { onLogout(account); }}
              aria-label={"退出微软登录 " + account.name}
              title="退出登录（保留账号与皮肤缓存）"
            >
              {loggingOut ? <Loader2 className="animate-spin" /> : <LogOut />}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            size="icon-xs"
            disabled={removing || loggingOut || refreshing}
            onClick={() => { onRemove(account); }}
            aria-label={"删除账号 " + account.name}
          >
            {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
          </Button>
        </div>
      </div>

      {needsLogin ? (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          微软登录态已失效。点「刷新登录」尝试静默续期；若仍失败，请点「重新登录」完成设备代码授权。
        </p>
      ) : null}

      {account.entitled === false ? (
        <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          未检测到正版授权，请购买 Minecraft 后再使用正版登录。
          <a
            href="https://www.minecraft.net/"
            target="_blank"
            rel="noreferrer noopener"
            className="mx-1 inline-flex items-center gap-0.5 underline underline-offset-2"
          >
            前往官网<ExternalLink className="size-3" />
          </a>
          ；离线账号仍可直接启动。
        </p>
      ) : null}

      {isMicrosoft ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-border/70 bg-background/60 p-2">
          <SkinAvatar
            skinUrl={skinUrl}
            model={skinModel}
            size={56}
            fallback={useBuiltinFallback}
            title={account.name + " 的皮肤预览"}
            className="size-14 rounded-xl ring-1 ring-border"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">皮肤预览</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {skinLoading
                ? "正在读取皮肤…"
                : skinError !== null
                  ? "皮肤信息暂不可用，已显示内置头像"
                  : skinSourceLabel(skin?.source) + " · " + skinModelLabel(skinModel)}
              {skin?.fallback === true ? " · 已回退默认皮肤" : ""}
            </p>
            {capeUrl !== null ? (
              <a
                href={capeUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-primary underline-offset-2 hover:underline"
              >
                查看披风<ExternalLink className="size-3" />
              </a>
            ) : (
              <p className="mt-0.5 text-[10px] text-muted-foreground">未检测到披风</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 账号管理：离线增删 + 微软正版登录 / 刷新 / 退出 + 皮肤展示。 */
export function AccountsCard() {
  const { accounts, patchAccounts, reload, backendDown } = useAppData();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

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
      const account: Account = normalizeAccount(created) ?? {
        name: trimmed,
        uuid: "",
        kind: "offline",
        hasSession: true,
      };
      patchAccounts((list) => (list.some((item) => item.name === account.name) ? list : [...list, account]));
      setName("");
      toast.success("已添加离线账号 " + account.name);
    } catch (cause: unknown) {
      setFormError(errorMessage(cause));
    } finally {
      setCreating(false);
    }
  }, [name, patchAccounts]);

  const handleRemove = useCallback(async (account: Account) => {
    setBusyKey(account.name + ":remove");
    try {
      await api.deleteAccount(account.name);
      patchAccounts((list) => list.filter((item) => item.name !== account.name));
      toast.success("已删除账号 " + account.name);
    } catch (cause: unknown) {
      toast.error("删除账号失败", { description: errorMessage(cause) });
    } finally {
      setBusyKey(null);
    }
  }, [patchAccounts]);

  const handleRefresh = useCallback(async (account: Account) => {
    setBusyKey(account.name + ":refresh");
    try {
      const response = await api.microsoftRefresh(account.name);
      const normalized = normalizeAccount(response.account);
      const fresh: Account = normalized === null
        ? { ...account, hasSession: true }
        : { ...account, ...normalized, kind: "microsoft" };
      patchAccounts((list) => list.map((item) => (item.name === account.name ? fresh : item)));
      reload();
      toast.success("已刷新微软登录", { description: account.name + " 的登录态已更新" });
    } catch (cause: unknown) {
      toast.error("刷新登录失败", {
        description: errorMessage(cause) + "。如果凭据已失效，请重新登录。",
      });
    } finally {
      setBusyKey(null);
    }
  }, [patchAccounts, reload]);

  const handleLogout = useCallback(async (account: Account) => {
    setBusyKey(account.name + ":logout");
    try {
      await api.microsoftLogout(account.name);
      patchAccounts((list) =>
        list.map((item) => (item.name === account.name ? { ...item, hasSession: false } : item)),
      );
      reload();
      toast.success("已退出微软登录", { description: "账号与皮肤缓存保留，下次启动前需重新登录" });
    } catch (cause: unknown) {
      toast.error("退出登录失败", { description: errorMessage(cause) });
    } finally {
      setBusyKey(null);
    }
  }, [patchAccounts, reload]);

  const handleAccountsChanged = useCallback(() => {
    reload();
  }, [reload]);

  return (
    <div className="card-soft rounded-2xl border border-border bg-card p-4">
      <SectionHeader
        icon={UserRound}
        title="账号管理"
        description="离线账号按名字推导 UUID；正版账号用微软设备码登录，凭据只保存在本地"
        action={
          <>
            <MicrosoftLoginDialog onDone={handleAccountsChanged} />
            <Badge variant="ghost" className="text-[10px] text-muted-foreground">
              {accounts.length} 个
            </Badge>
          </>
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
      ) : backendDown ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
          <CircleAlert className="size-3.5" />
          后端未就绪，暂时无法读取或保存账号；后端恢复后重试即可。
        </p>
      ) : null}

      <div className="mt-3 space-y-2">
        {accounts.length === 0 ? (
          <EmptyState
            icon={UserRound}
            className="py-8"
            title="还没有账号"
            description={
              backendDown
                ? "后端未就绪，暂时无法读取账号列表。恢复后可添加离线账号或进行微软正版登录。"
                : "还没有账号，可添加离线账号或进行微软正版登录。"
            }
          />
        ) : (
          accounts.map((account, index) => (
            <AccountRow
              key={account.name}
              account={account}
              index={index}
              busyKey={busyKey}
              onRemove={(target) => { void handleRemove(target); }}
              onRefresh={(target) => { void handleRefresh(target); }}
              onLogout={(target) => { void handleLogout(target); }}
              onAccountsChanged={handleAccountsChanged}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** 骨架，供设置页首屏使用。 */
export function AccountsCardSkeleton() {
  return (
    <div className="card-soft space-y-2 rounded-2xl border border-border bg-card p-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-12 w-full rounded-xl" />
    </div>
  );
}
