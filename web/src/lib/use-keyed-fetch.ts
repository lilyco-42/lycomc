import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "@/lib/api";

interface KeyedResult<T> {
  key: string;
  nonce: number;
  data: T | null;
  error: string | null;
}

export interface KeyedFetch<T> {
  data: T | null;
  error: string | null;
  /** key 变了但结果还没回来；由「结果的 key/nonce 是否匹配」派生，不在 effect 里置位 */
  loading: boolean;
  reload: () => void;
}

/**
 * 按 key 拉数据（替代 TanStack Query 的最小实现）。
 * 结果自带它对应的 key 与 nonce，loading 完全派生，避免 effect 里同步 setState。
 */
export function useKeyedFetch<T>(
  key: string,
  loader: (key: string) => Promise<T>,
): KeyedFetch<T> {
  const [result, setResult] = useState<KeyedResult<T> | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (key === "") {
      return;
    }
    let cancelled = false;
    loader(key)
      .then((data) => {
        if (!cancelled) {
          setResult({ key, nonce, data, error: null });
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResult({ key, nonce, data: null, error: errorMessage(cause) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [key, nonce, loader]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  const matched = result !== null && result.key === key && result.nonce === nonce ? result : null;

  return {
    data: matched?.data ?? null,
    error: matched?.error ?? null,
    loading: key !== "" && matched === null,
    reload,
  };
}
