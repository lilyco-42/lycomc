import { createContext, useContext } from "react";
import type {
  Account,
  Health,
  JavaInfo,
  RemoteData,
  RunningInstance,
  Settings,
  VersionInfo,
} from "@/lib/api";

export interface AppDataValue {
  settings: Settings | null;
  accounts: Account[];
  versions: VersionInfo[];
  running: RunningInstance[];
  javas: JavaInfo[];
  remote: RemoteData | null;
  health: Health | null;
  /** /api/state 首次加载中 */
  loading: boolean;
  /** /api/state 的错误（后端未就绪时为网络错误） */
  error: string | null;
  /** 连不上后端（服务没起 / 端口不通） */
  backendDown: boolean;
  reload: () => void;
  patchVersions: (updater: (versions: VersionInfo[]) => VersionInfo[]) => void;
  patchAccounts: (updater: (accounts: Account[]) => Account[]) => void;
  /** 写设置：成功后同步本地 settings */
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>;
  remoteLoading: boolean;
  remoteError: string | null;
  reloadRemote: (refresh?: boolean) => void;
  /** 当前选中版本（settings.selectVersion 优先，否则第一个已装实例） */
  selectedVersion: VersionInfo | null;
  /** 默认账号名（settings.defaultAccount，可能为 null = 回退账号列表第一项） */
  defaultAccount: string | null;
  /** 当前账号：settings.defaultAccount 指向的账号，找不到则回退列表第一项 */
  currentAccount: Account | null;
  /** 快速切换账号（仅本会话）：全局（顶栏/侧栏/主页）同步显示，不改动持久化默认账号 */
  switchAccount: (name: string) => void;
  /** 设为默认账号（持久化到 settings.json，未显式指定账号时启动用它） */
  setDefaultAccount: (name: string) => Promise<Settings>;
}

export const AppDataContext = createContext<AppDataValue | null>(null);

export function useAppData(): AppDataValue {
  const value = useContext(AppDataContext);
  if (value === null) {
    throw new Error("useAppData 必须在 <AppDataProvider> 内使用");
  }
  return value;
}
