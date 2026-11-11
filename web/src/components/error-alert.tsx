import { CircleAlert, RefreshCw, ServerCrash } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ErrorAlertProps {
  title: string;
  message: string;
  onRetry?: () => void;
  /** 后端未就绪时给一条更具体的行动建议 */
  offline?: boolean;
}

export function ErrorAlert({ title, message, onRetry, offline = false }: ErrorAlertProps) {
  return (
    <Alert variant="destructive" className="border-destructive/30 bg-destructive/5">
      {offline ? <ServerCrash /> : <CircleAlert />}
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {title}
        {onRetry ? (
          <Button
            variant="outline"
            size="xs"
            className="ml-auto border-destructive/30 text-destructive hover:bg-destructive/10"
            onClick={onRetry}
          >
            <RefreshCw />
            重试
          </Button>
        ) : null}
      </AlertTitle>
      <AlertDescription>
        <span className="block font-mono text-xs break-words whitespace-pre-wrap">{message}</span>
        {offline ? (
          <span className="mt-1.5 block text-xs">
            后端未就绪：请确认 lycomc 服务已启动（默认同源 <code>/api</code>）。界面仍可浏览，数据会在服务恢复后自动加载。
          </span>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
