import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
}

/** 页面标题：PCL 风蓝色小标题 + 辅助说明。 */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pb-5">
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="brand-solid h-4 w-1 rounded-full" />
          <h1 className="text-lg font-semibold tracking-tight text-primary">{title}</h1>
        </div>
        <p className="pl-3 text-[13px] text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
