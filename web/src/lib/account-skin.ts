/**
 * 账号皮肤元数据的轻量读取。
 * /api/state 里可能不带皮肤 URL，这里按账号名补拉 GET /api/accounts/:name/skin；
 * 请求失败时调用方静默退回内置 Steve / Alex，页面不白屏。
 */
import { api, type Account, type AccountSkin, type SkinSource } from "@/lib/api";
import { normalizeAccountSkin } from "@/lib/normalize";

/** 用不可见分隔符拼 key，账号名里出现普通标点也不会误切。 */
export const SKIN_KEY_SEP = "\u0001";

export function skinKeyFor(account: Account): string {
  return [
    account.name,
    account.kind,
    account.uuid,
    account.hasSession ? "1" : "0",
    account.skinModel ?? "classic",
    account.skinUrl ?? "",
  ].join(SKIN_KEY_SEP);
}

/** 给 useKeyedFetch 用的稳定 loader：key 首段永远是账号名。 */
export async function loadAccountSkinByKey(key: string): Promise<AccountSkin> {
  const name = key.split(SKIN_KEY_SEP)[0] ?? "";
  const skin = normalizeAccountSkin(await api.accountSkin(name));
  if (skin === null) {
    throw new Error("皮肤数据格式不正确");
  }
  return skin;
}

export function skinSourceLabel(source: SkinSource | undefined): string {
  switch (source) {
    case "microsoft":
      return "微软正版皮肤";
    case "mojang":
      return "Mojang 皮肤";
    case "default":
      return "内置默认皮肤";
    default:
      return "皮肤信息未知";
  }
}

export function skinModelLabel(model: AccountSkin["skinModel"] | undefined): string {
  return model === "slim" ? "Alex 细手臂" : "Steve 粗手臂";
}
