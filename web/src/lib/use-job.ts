import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, isRecord, type Job } from "@/lib/api";
import { useSse } from "@/lib/use-sse";

const POLL_INTERVAL_MS = 1500;

export interface UseJobTrackerOptions {
  /** 任务进入 done / error 时回调一次（在异步回调里触发，可安全 setState） */
  onFinished?: (job: Job) => void;
}

export interface JobTracker {
  job: Job | null;
  /** 实时进度连上了；false 时界面提示「进度会自己刷新」 */
  live: boolean;
  error: string | null;
  /** 任务已进入 done / error */
  finished: boolean;
  reset: () => void;
}

function isTerminal(job: Job): boolean {
  return job.state === "done" || job.state === "error";
}

/**
 * 追踪单个任务：优先吃实时进度，同时低频查看 /api/jobs/:id 兜底
 * （实时进度没连上或被掐断时界面也不会永远卡住）。
 * job 用「存下来的结果 + 是否属于当前 jobId」派生，避免在 effect 里清状态。
 */
export function useJobTracker(
  jobId: string | null,
  options: UseJobTrackerOptions = {},
): JobTracker {
  const [stored, setStored] = useState<Job | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const onFinishedRef = useRef(options.onFinished);
  useEffect(() => {
    onFinishedRef.current = options.onFinished;
  }, [options.onFinished]);

  const firedRef = useRef<Set<string>>(new Set());
  const activeJobId = jobId !== null && jobId !== "" ? jobId : "";

  const absorb = useCallback((incoming: Job) => {
    setStored((previous) => {
      if (previous === null || previous.id !== incoming.id) {
        return incoming;
      }
      // 进度只增不减，避免乱序帧把进度拉回去；日志取更长的一份
      return {
        ...previous,
        ...incoming,
        progress: Math.max(previous.progress ?? 0, incoming.progress ?? 0),
        logs: incoming.logs.length >= previous.logs.length ? incoming.logs : previous.logs,
      };
    });
    if (isTerminal(incoming) && !firedRef.current.has(incoming.id)) {
      firedRef.current.add(incoming.id);
      onFinishedRef.current?.(incoming);
    }
  }, []);

  const { status, error: sseError } = useSse({ jobId: activeJobId, onJob: absorb });

  // 兜底轮询：只在任务未结束时继续
  useEffect(() => {
    if (activeJobId === "") {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const tick = () => {
      api
        .job(activeJobId)
        .then((value) => {
          if (cancelled) {
            return;
          }
          absorb(value);
          setPollError(null);
          if (value.state === "running") {
            timer = window.setTimeout(tick, POLL_INTERVAL_MS);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setPollError(errorMessage(cause));
          }
        });
    };
    timer = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [activeJobId, absorb, nonce]);

  const reset = useCallback(() => {
    setStored(null);
    setPollError(null);
    setNonce((value) => value + 1);
  }, []);

  const job = stored !== null && stored.id === activeJobId ? stored : null;

  return {
    job,
    live: status === "open",
    error: pollError ?? sseError,
    finished: job !== null && isTerminal(job),
    reset,
  };
}

/** 从 job.result 里尽量捞出 pid（契约只承诺 result 存在，形状未定）。 */
export function pickPid(result: unknown): number | null {
  if (typeof result === "number" && Number.isFinite(result)) {
    return result;
  }
  if (isRecord(result)) {
    for (const key of ["pid", "processId", "process_id"]) {
      const value = result[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
  }
  return null;
}

/** 合并服务端下发的日志与本地追加日志，去重后只留尾部。 */
export function tailLogs(job: Job | null, extra: string[], max = 200): string[] {
  if (job === null && extra.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const line of [...(job?.logs ?? []), ...extra]) {
    if (line.trim() === "" || seen.has(line)) {
      continue;
    }
    seen.add(line);
    merged.push(line);
  }
  return merged.slice(-max);
}
