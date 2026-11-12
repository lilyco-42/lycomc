import { useEffect, useState } from "react";
import { PlugZap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackendNoticeProps {
  onRetry: () => void;
  /** 用于在用户点重试后显示「正在重连」 */
  retrying?: boolean;
}

/** 后端未就绪时的全局横幅：不遮挡界面，只提示 + 重试。 */
export function BackendNotice({ onRetry, retrying = false }: BackendNoticeProps) {
  const [dots, setDots] = useState("./");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDots((value) => (value === "./" ? "../" : value === "../" ? "..." : "./"));
    }, 600);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-pcl-4/40 bg-pcl-7 px-3.5 py-2.5 text-sm text-pcl-2 dark:text-pcl-5">
      <PlugZap className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">后端未就绪</span>
        <span className="text-pcl-2 dark:text-pcl-5">
          　连不上 lycomc 服务，正在等待 {dots} 页面可以正常浏览，数据会在服务恢复后加载。
        </span>
      </p>
      <Button variant="outline" size="xs" onClick={onRetry} disabled={retrying} className="shrink-0">
        <RefreshCw className={retrying ? "animate-spin" : undefined} />
        重新连接
      </Button>
    </div>
  );
}
