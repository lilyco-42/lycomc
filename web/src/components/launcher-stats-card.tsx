import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Activity, BarChart3, Cpu, PieChart as PieChartIcon, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppData } from "@/context/app-data-context";

/** 与 index.css 的 --chart-1..5 对齐，浅色/深色都可读。 */
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-2)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: "0.75rem",
  color: "var(--foreground)",
  fontSize: "12px",
  boxShadow: "var(--card-shadow)",
};

interface Slice {
  name: string;
  value: number;
}

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: number; hint: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-pcl-8/50 px-3 py-2 dark:bg-muted/30">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-pcl-7 text-pcl-2 dark:bg-muted dark:text-pcl-5">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold tabular-nums text-foreground">
          {label} {value}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </div>
  );
}

/**
 * 启动器一览：两张图 + 三个计数，全部来自 /api/state 的真实快照。
 * 不画「最近 7 天」之类没有后端数据支撑的时序。
 */
export function LauncherStatsCard() {
  const { versions, accounts, running, javas, loading } = useAppData();

  const kindData = useMemo<Slice[]>(() => {
    const vanilla = versions.filter((item) => item.kind === "vanilla").length;
    const fabric = versions.length - vanilla;
    return [
      { name: "原版", value: vanilla },
      { name: "Fabric", value: fabric },
    ].filter((item) => item.value > 0);
  }, [versions]);

  const javaData = useMemo<Slice[]>(() => {
    const counts = new Map<string, number>();
    for (const item of versions) {
      const key = item.javaMajor > 0 ? "Java " + item.javaMajor : "未标注";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [versions]);

  const official = accounts.filter((item) => item.kind === "microsoft").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-primary">
              <BarChart3 className="size-4" />
              启动器一览
            </CardTitle>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              下面的数字都来自现在装好的版本与账号，不编造历史记录。
            </p>
          </div>
          <Badge variant="outline" className="gap-1 text-[11px]">
            <PieChartIcon className="size-3 text-primary" />
            当前快照
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat
            icon={<Users className="size-4" />}
            label="账号"
            value={accounts.length}
            hint={"正版 " + official + " · 离线 " + (accounts.length - official)}
          />
          <Stat
            icon={<Activity className="size-4" />}
            label="运行中"
            value={running.length}
            hint={running.length > 0 ? "游戏正在运行" : "当前没有启动"}
          />
          <Stat
            icon={<Cpu className="size-4" />}
            label="Java"
            value={javas.length}
            hint={javas.length > 0 ? "本机检测到的 Java" : "还没检测到 Java"}
          />
        </div>
        {loading ? (
          <Skeleton className="h-44 w-full rounded-xl" />
        ) : versions.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-pcl-8/60 px-4 py-8 text-center text-sm text-muted-foreground dark:bg-muted/30">
            还没有装版本，装好一个之后这里就会出现两张图。
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-foreground">版本类型</p>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={kindData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={38}
                      outerRadius={64}
                      paddingAngle={3}
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      {kindData.map((item, index) => (
                        <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 flex flex-wrap gap-3">
                {kindData.map((item, index) => (
                  <span key={item.name} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      className="size-2 rounded-sm"
                      style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                    />
                    {item.name} {item.value}
                  </span>
                ))}
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-foreground">版本需要的 Java</p>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={javaData} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="value" name="版本数" radius={[6, 6, 0, 0]} maxBarSize={38}>
                      {javaData.map((item, index) => (
                        <Cell key={item.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">按每个版本声明的 Java 主版本统计</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
