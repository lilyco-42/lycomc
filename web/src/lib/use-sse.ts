import { useEffect, useRef, useState } from "react";
import { EVENTS_URL, isRecord, type Job, type JobState } from "@/lib/api";

export type SseStatus = "connecting" | "open" | "closed";

const RECONNECT_DELAY_MS = 2500;

function parseJob(data: string): Job | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  if (typeof parsed.id !== "string" || typeof parsed.progress !== "number") {
    return null;
  }
  return parsed as unknown as Job;
}

function stateOf(eventName: string, job: Job): JobState {
  if (eventName === "done") {
    return "done";
  }
  if (eventName === "error") {
    return "error";
  }
  return job.state ?? "running";
}

export interface UseSseOptions {
  /** 只关心这个任务；为空则把全部任务事件都透出 */
  jobId?: string | null;
  /** 收到任意已解析事件时回调（用于刷新列表 / 累积日志） */
  onJob?: (job: Job) => void;
}

/**
 * 订阅 /api/events（实时事件：progress / done / error，内容为任务状态）。
 * 断线自动重连；jobId 变化或组件卸载时关闭连接。
 */
const SUPPORTED = typeof EventSource !== "undefined";
const UNSUPPORTED_MESSAGE = "当前环境不支持 EventSource，无法接收实时进度";

export function useSse({ jobId, onJob }: UseSseOptions = {}) {
  const [job, setJob] = useState<Job | null>(null);
  const [status, setStatus] = useState<SseStatus>(SUPPORTED ? "connecting" : "closed");
  const [error, setError] = useState<string | null>(SUPPORTED ? null : UNSUPPORTED_MESSAGE);
  const [attempt, setAttempt] = useState(0);

  // 回调存 ref，避免因引用变化重建 EventSource（在 effect 内同步，渲染期不碰 ref）
  const onJobRef = useRef(onJob);
  useEffect(() => {
    onJobRef.current = onJob;
  }, [onJob]);

  useEffect(() => {
    if (!SUPPORTED) {
      return;
    }

    let closed = false;
    let timer: number | undefined;

    const source = new EventSource(EVENTS_URL);

    const handle = (eventName: string) => (event: MessageEvent<string>) => {
      const incoming = parseJob(event.data);
      if (incoming === null) {
        return;
      }
      const merged: Job = { ...incoming, state: stateOf(eventName, incoming) };
      if (jobId !== undefined && jobId !== null && jobId !== "" && merged.id !== jobId) {
        return;
      }
      setJob((prev) => (prev !== null && prev.id === merged.id ? { ...prev, ...merged } : merged));
      onJobRef.current?.(merged);
    };

    const onProgress = handle("progress");
    const onDone = handle("done");
    const onErrorEvent = handle("error");

    source.addEventListener("progress", onProgress as EventListener);
    source.addEventListener("done", onDone as EventListener);
    source.addEventListener("error", onErrorEvent as EventListener);
    source.onopen = () => {
      if (!closed) {
        setStatus("open");
        setError(null);
      }
    };
    source.onerror = () => {
      if (closed) {
        return;
      }
      setStatus("connecting");
      setError("实时连接已断开，正在重试…");
      // EventSource 自带重连，但部分实现会彻底放弃，这里补一次兜底
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        timer = window.setTimeout(() => {
          setAttempt((value) => value + 1);
        }, RECONNECT_DELAY_MS);
      }
    };

    return () => {
      closed = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      source.removeEventListener("progress", onProgress as EventListener);
      source.removeEventListener("done", onDone as EventListener);
      source.removeEventListener("error", onErrorEvent as EventListener);
      source.close();
    };
  }, [jobId, attempt]);

  return { job, status, error };
}
