import { Compass, House } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { navigate } from "@/lib/router";

export function NotFoundPage() {
  return (
    <div className="card-soft rounded-2xl border border-border bg-card p-8" data-motion-root>
      <EmptyState
        icon={Compass}
        tone="brand"
        title="这个页面不存在"
        description="地址可能敲错了，回主页继续吧。"
        action={
          <Button onClick={() => { navigate("/"); }}>
            <House />
            回到主页
          </Button>
        }
      />
    </div>
  );
}
