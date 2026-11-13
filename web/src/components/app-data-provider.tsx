import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  api,
  errorMessage,
  isBackendDown,
  type Account,
  type Health,
  type RemoteData,
  type Settings,
  type StateResponse,
  type VersionInfo,
} from "@/lib/api";
import { normalizeRemote, normalizeSettings, normalizeState } from "@/lib/normalize";
import { AppDataContext, type AppDataValue } from "@/context/app-data-context";

const EMPTY_VERSIONS: VersionInfo[] = [];
const EMPTY_ACCOUNTS: Account[] = [];
const EMPTY_RUNNING: StateResponse["running"] = [];
const EMPTY_JAVAS: StateResponse["javas"] = [];

interface AppDataProviderProps {
  children: ReactNode;
}

interface RemoteRequest {
  nonce: number;
  refresh: boolean;
}

interface RemoteResult {
  nonce: number;
  error: string | null;
}

/** 全局数据源：一次 /api/state + /api/health，各页面共享；后端没起也不白屏。 */
export function AppDataProvider({ children }: AppDataProviderProps) {
  const [state, setState] = useState<StateResponse | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [backendDown, setBackendDown] = useState(false);
  const [nonce, setNonce] = useState(0);

  const [remote, setRemote] = useState<RemoteData | null>(null);
  const [request, setRequest] = useState<RemoteRequest | null>(null);
  const [result, setResult] = useState<RemoteResult | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  // 会话级快速切换（不持久化）：null = 跟随 defaultAccount / 列表首项
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const reloadRemote = useCallback((refresh = false) => {
    requestSeqRef.current += 1;
    setRequest({ nonce: requestSeqRef.current, refresh });
  }, []);

  // 全局状态
  useEffect(() => {
    let cancelled = false;

    api
      .state()
      .then((raw) => {
        if (cancelled) {
          return;
        }
        setState(normalizeState(raw));
        setError(null);
        setBackendDown(false);
        if (raw.remote !== undefined && raw.remote !== null) {
          setRemote(normalizeRemote(raw.remote));
        } else {
          // 状态里没带远程版本：在回调里补一次拉取（不在渲染/effect 同步阶段改状态）
          requestSeqRef.current += 1;
          setRequest({ nonce: requestSeqRef.current, refresh: false });
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        setError(errorMessage(cause));
        setBackendDown(isBackendDown(cause));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    api
      .health()
      .then((data) => {
        if (!cancelled) {
          setHealth(data);
          setBackendDown(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setHealth(null);
          if (isBackendDown(cause)) {
            setBackendDown(true);
          }
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // 远程版本（独立请求，刷新按钮 / 状态缺少 remote 时触发）
  useEffect(() => {
    if (request === null) {
      return;
    }
    let cancelled = false;
    const requested = request;
    api
      .remoteVersions(requested.refresh)
      .then((data) => {
        if (cancelled) {
          return;
        }
        setRemote(normalizeRemote(data));
        setRemoteError(null);
        setResult({ nonce: requested.nonce, error: null });
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        const message = errorMessage(cause);
        setRemoteError(message);
        setResult({ nonce: requested.nonce, error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const patchVersions = useCallback((updater: (versions: VersionInfo[]) => VersionInfo[]) => {
    setState((previous) => (previous === null ? previous : { ...previous, versions: updater(previous.versions) }));
  }, []);

  const patchAccounts = useCallback((updater: (accounts: Account[]) => Account[]) => {
    setState((previous) => (previous === null ? previous : { ...previous, accounts: updater(previous.accounts) }));
  }, []);

  const saveSettings = useCallback(async (patch: Partial<Settings>): Promise<Settings> => {
    const saved = normalizeSettings(await api.saveSettings(patch));
    setState((previous) => (previous === null ? previous : { ...previous, settings: saved }));
    return saved;
  }, []);

  const versions = state?.versions ?? EMPTY_VERSIONS;
  const accounts = state?.accounts ?? EMPTY_ACCOUNTS;
  const running = state?.running ?? EMPTY_RUNNING;
  const javas = state?.javas ?? EMPTY_JAVAS;
  const settings = state?.settings ?? null;
  const selectVersion = settings?.selectVersion ?? null;

  const selectedVersion = useMemo<VersionInfo | null>(() => {
    if (versions.length === 0) {
      return null;
    }
    if (selectVersion !== null) {
      const found = versions.find((version) => version.id === selectVersion);
      if (found !== undefined) {
        return found;
      }
    }
    return versions[0] ?? null;
  }, [versions, selectVersion]);

  const defaultAccount = settings?.defaultAccount ?? null;
  const currentAccount = useMemo<Account | null>(() => {
    if (accounts.length === 0) {
      return null;
    }
    const target = selectedName ?? defaultAccount;
    if (target !== null) {
      const picked = accounts.find((account) => account.name === target);
      if (picked !== undefined) {
        return picked;
      }
    }
    return accounts[0] ?? null;
  }, [accounts, defaultAccount, selectedName]);

  /** 快速切换（仅当前会话）：顶栏/侧栏/主页同步显示，不改动持久化默认账号。 */
  const switchAccount = useCallback((name: string): void => {
    setSelectedName(name);
  }, []);

  /** 设为默认账号（持久化到 settings.json，同时把当前显示切到该账号）。 */
  const setDefaultAccount = useCallback(
    async (name: string): Promise<Settings> => {
      const saved = normalizeSettings(await api.setDefaultAccount(name));
      setState((previous) => (previous === null ? previous : { ...previous, settings: saved }));
      setSelectedName(name);
      return saved;
    },
    [],
  );

  const remoteLoading = request !== null && (result === null || result.nonce !== request.nonce);

  const value = useMemo<AppDataValue>(
    () => ({
      settings,
      accounts,
      versions,
      running,
      javas,
      remote,
      health,
      loading,
      error,
      backendDown,
      reload,
      patchVersions,
      patchAccounts,
      saveSettings,
      remoteLoading,
      remoteError,
      reloadRemote,
      selectedVersion,
      defaultAccount,
      currentAccount,
      switchAccount,
      setDefaultAccount,
    }),
    [
      settings,
      accounts,
      versions,
      running,
      javas,
      remote,
      health,
      loading,
      error,
      backendDown,
      reload,
      patchVersions,
      patchAccounts,
      saveSettings,
      remoteLoading,
      remoteError,
      reloadRemote,
      selectedVersion,
      defaultAccount,
      currentAccount,
      switchAccount,
      setDefaultAccount,
    ],
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}
