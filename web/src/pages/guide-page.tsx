import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  CircleHelp,
  Coffee,
  Download,
  Gamepad2,
  Languages,
  Lightbulb,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Wifi,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/page-header";
import { SectionHeader } from "@/components/section-header";
import { useAppData } from "@/context/app-data-context";
import { requestOnboarding } from "@/lib/onboarding";
import { navigate } from "@/lib/router";
import { cn } from "@/lib/utils";

interface GuideStep {
  id: string;
  title: string;
  summary: string;
  minutes: string;
  icon: typeof Download;
  tone: "blue" | "violet" | "green" | "amber";
  illustration: ReactNode;
  points: string[];
  actionLabel: string;
  actionTo: string;
}

interface FaqItem {
  id: string;
  question: string;
  icon: typeof Wrench;
  answer: string[];
  actionLabel?: string;
  actionTo?: string;
}

/** 每一步的图标底色：纯实色 + 实色文字，不用渐变。 */
const STEP_TONES: Record<GuideStep["tone"], string> = {
  blue: "bg-pcl-7 text-pcl-2 dark:bg-muted dark:text-pcl-5",
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
};

/** 第一步：点开「下载」，找到 1.20.1，再点安装；进度条自己走完就行。 */
function InstallPicture() {
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-card/80 p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
      <div className="rounded-lg border border-border bg-background px-2.5 py-2">
        <p className="text-[10px] text-muted-foreground">左边这一列</p>
        <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-pcl-7 px-2 py-1.5 text-[11px] font-medium text-pcl-2 dark:bg-muted dark:text-pcl-5">
          <Download className="size-3" />
          下载
        </div>
      </div>
      <ArrowRight className="mx-auto size-4 rotate-90 text-primary sm:rotate-0" />
      <div className="rounded-lg border border-border bg-background px-2.5 py-2">
        <p className="text-[10px] text-muted-foreground">中间那一列</p>
        <div className="mt-1.5 flex items-center justify-between rounded-md border border-pcl-4/40 px-2 py-1.5">
          <span className="text-[11px] font-medium">1.20.1</span>
          <span className="rounded bg-pcl-7 px-1.5 py-0.5 text-[10px] text-pcl-2 dark:bg-muted dark:text-pcl-5">
            安装
          </span>
        </div>
      </div>
    </div>
  );
}

/** 第二步：正版登录靠「微软正版登录」按钮，按屏幕上给的代码操作。 */
function LoginPicture() {
  return (
    <div className="rounded-xl border border-border bg-card/80 p-3">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
        <ShieldCheck className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-muted-foreground">设置 → 账号</p>
          <p className="truncate text-[11px] font-medium">微软正版登录</p>
        </div>
        <Badge variant="outline" className="text-[9px]">点一下</Badge>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-lg bg-pcl-8/70 px-2.5 py-2 dark:bg-muted/40">
        <span className="rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] tracking-widest">
          ABCD-EFGH
        </span>
        <span className="text-[11px] text-muted-foreground">照着窗口里显示的填就行</span>
      </div>
    </div>
  );
}

/** 第三步：Mod 从搜索结果里点「安装」，不需要自己搬文件。 */
function ModPicture() {
  return (
    <div className="grid gap-2 rounded-xl border border-border bg-card/80 p-3 sm:grid-cols-3">
      {[
        { icon: Puzzle, label: "搜索想要的玩法" },
        { icon: Check, label: "点卡片上的安装" },
        { icon: Gamepad2, label: "回主页开始游戏" },
      ].map((item, index) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="rounded-lg border border-border bg-background px-2 py-2 text-center">
            <Icon className="mx-auto size-4 text-primary" />
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              {index + 1}. {item.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** 第四步：版本管理 → 一键汉化，完成后游戏里就是中文。 */
function LanguagePicture() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card/80 p-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pcl-7 text-primary dark:bg-muted">
        <Languages className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium">版本管理 → 一键汉化</p>
        <p className="mt-0.5 text-[10px] text-muted-foreground">进度走完，再进游戏就是中文啦</p>
      </div>
      <Badge variant="outline" className="shrink-0 text-[10px]">中文</Badge>
    </div>
  );
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: "install",
    title: "第一次，把游戏装进来",
    summary: "只要点两下，剩下的交给启动器。第一次会等几分钟，属于正常现象。",
    minutes: "约 3～10 分钟",
    icon: Download,
    tone: "blue",
    illustration: <InstallPicture />,
    points: [
      "点左上方的「下载」，在列表里找到 1.20.1。认准这个数字就好，别的版本以后再慢慢试。",
      "点它右边的「安装」。屏幕上会出现一条慢慢前进的进度条，期间不用点别的。",
      "进度条走完，回到「主页」。中间大按钮下面会显示已经装好的版本，这就说明成功了。",
    ],
    actionLabel: "带我去下载",
    actionTo: "/download",
  },
  {
    id: "account",
    title: "想用正版账号，这样登录",
    summary: "没有购买过正版也可以跳过这一步，取个名字照样能玩。",
    minutes: "约 1 分钟",
    icon: ShieldCheck,
    tone: "violet",
    illustration: <LoginPicture />,
    points: [
      "打开「设置」，往下找到「账号」。如果只想先试试游戏，直接看下一步就好。",
      "点「微软正版登录」，屏幕会出现一串短代码和一个网页按钮。",
      "点开网页，把短代码填进去，按网页上的提示登录。完成后这个小窗口会自己关掉。",
    ],
    actionLabel: "打开账号设置",
    actionTo: "/settings",
  },
  {
    id: "mods",
    title: "想加点新玩法，装 Mod",
    summary: "Mod 就是给游戏加小功能。搜索名字、点安装，启动器会帮你放好。",
    minutes: "约 2 分钟",
    icon: Puzzle,
    tone: "green",
    illustration: <ModPicture />,
    points: [
      "先确认自己装的是带「Fabric」标记的版本；没有的话，在「下载」页安装时勾上「同时安装 Fabric」。",
      "打开「Mod 管理」，在搜索框里输入想要的东西，比如「小地图」，然后点搜索。",
      "看中哪张卡片就点它上面的「安装」；回到「主页」点「开始游戏」，新玩法就出现了。",
    ],
    actionLabel: "去挑点新玩法",
    actionTo: "/mods",
  },
  {
    id: "chinese",
    title: "让游戏变成中文",
    summary: "按钮叫「一键汉化」，点一次就好，不用自己下载或搬东西。",
    minutes: "约 1 分钟",
    icon: Languages,
    tone: "amber",
    illustration: <LanguagePicture />,
    points: [
      "打开「版本管理」，找到自己平时玩的那一行。",
      "点这一行的「一键汉化」，等小进度条走完。",
      "下次进游戏，菜单和按钮就是中文了。没生效就关掉游戏，再开一次。",
    ],
    actionLabel: "去版本管理",
    actionTo: "/versions",
  },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    id: "cannot-open",
    question: "点了「开始游戏」，游戏没出来怎么办？",
    icon: Wrench,
    answer: [
      "第一次启动要准备不少东西，慢一点很正常，先等两三分钟，别反复点按钮。",
      "看看按钮下面那行小字：如果写着「还没装版本」，点「安装新版本」先装一个 1.20.1。",
      "如果一直没反应，关掉启动器再打开一次；还是不行，到「使用教程」最下面找「再试一次」的小抄。",
    ],
    actionLabel: "回主页再试一次",
    actionTo: "/",
  },
  {
    id: "no-java",
    question: "屏幕上说「没有 Java」呢？",
    icon: Coffee,
    answer: [
      "Java 是游戏需要的一个小工具，不用你懂它，也不用手敲任何东西。",
      "安装游戏版本的时候，启动器一般会顺手把它准备好。",
      "如果还看到这个提示，把启动器关掉再打开，然后重新装一次 1.20.1 就好。",
    ],
    actionLabel: "去重新安装",
    actionTo: "/download",
  },
  {
    id: "slow-download",
    question: "下载特别慢，或者老是卡住？",
    icon: Wifi,
    answer: [
      "先看看家里网络是不是正常；下载大文件时进度条停一小会儿也常见。",
      "到「设置」里把下载线路换成「国内加速」，再把「同时下载的数量」调小一点，保存后重试。",
      "实在不行，换个网络或者晚一点再装。已经下好的部分不会白费。",
    ],
    actionLabel: "打开设置",
    actionTo: "/settings",
  },
];

/** 使用教程：四步图文 + 常见问题，全部大白话，完全不需要懂电脑术语。 */
export function GuidePage() {
  const { selectedVersion, loading, backendDown } = useAppData();

  return (
    <div className="space-y-5" data-motion-root>
      <PageHeader
        title="使用教程"
        description="第一次用？从上往下看，四步就能进游戏。点开每一步，照着做就好。"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { requestOnboarding(); }}>
              <CircleHelp />
              重看新手引导
            </Button>
            <Button variant="outline" size="sm" onClick={() => { navigate("/"); }}>
              <Gamepad2 />
              回主页
            </Button>
          </div>
        }
      />

      <div className="card-soft rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className="brand-solid flex size-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-md">
            <BookOpen className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold tracking-tight">先记住这一句话</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              「装一次版本 → 取个名字 → 点开始游戏」。其它按钮都是想让游戏更好玩时才用，第一次完全可以不管。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1 text-[11px]">
                <Sparkles className="size-3 text-primary" />
                不用自己找文件
              </Badge>
              <Badge variant="outline" className="gap-1 text-[11px]">
                <Lightbulb className="size-3 text-primary" />
                不用记英文
              </Badge>
              {loading ? (
                <Skeleton className="h-5 w-40" />
              ) : (
                <Badge variant="secondary" className="text-[11px]">
                  {selectedVersion !== null ? "现在用的是 " + selectedVersion.id : "还没装游戏版本"}
                </Badge>
              )}
            </div>
          </div>
        </div>
        {backendDown ? (
          <p className="mt-4 rounded-xl border-l-[3px] border-primary bg-pcl-8/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground dark:bg-muted/50">
            启动器还在准备中，教程可以先看；等它准备好了，下面的按钮就能直接带你过去。
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <SectionHeader
          icon={Boxes}
          title="四步开始玩"
          description="每一步都只要看眼前一个窗口，做完再点开下一步。"
        />
        {GUIDE_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <details
              key={step.id}
              open={index === 0}
              className="group card-soft overflow-hidden rounded-2xl border border-border bg-card"
            >
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 transition-colors hover:bg-pcl-8/60 dark:hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-border", STEP_TONES[step.tone])}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      第 {index + 1} 步 · {step.title}
                    </span>
                    <Badge variant="ghost" className="text-[10px] text-muted-foreground">
                      {step.minutes}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {step.summary}
                  </span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-border px-4 py-4">
                <div className="rounded-xl border border-border bg-pcl-8/60 p-1 dark:bg-muted/30">
                  {step.illustration}
                </div>
                <ol className="mt-4 space-y-2.5">
                  {step.points.map((point, pointIndex) => (
                    <li key={point} className="flex gap-2.5 text-[13px] leading-relaxed text-foreground">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-pcl-7 text-[10px] font-semibold text-pcl-2 dark:bg-muted dark:text-pcl-5">
                        {pointIndex + 1}
                      </span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">照着做完这一步，就可以点开下一步啦。</p>
                  <Button size="sm" onClick={() => { navigate(step.actionTo); }}>
                    {step.actionLabel}
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            </details>
          );
        })}
      </div>

      <div className="space-y-3 pt-1">
        <SectionHeader
          icon={CircleHelp}
          title="常见问题"
          description="遇到小麻烦别慌，点开对应的问题看一眼。"
        />
        {FAQ_ITEMS.map((faq) => {
          const Icon = faq.icon;
          return (
            <details key={faq.id} className="group card-soft rounded-2xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 transition-colors hover:bg-pcl-8/60 dark:hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <Icon className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 text-sm font-medium">{faq.question}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-border px-4 py-3">
                <ul className="space-y-2">
                  {faq.answer.map((line, index) => (
                    <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-pcl-3" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                {faq.actionLabel !== undefined && faq.actionTo !== undefined ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      navigate(faq.actionTo as string);
                    }}
                  >
                    {faq.actionLabel}
                    <ArrowRight />
                  </Button>
                ) : null}
              </div>
            </details>
          );
        })}
      </div>

      <div className="card-soft flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-pcl-7 text-primary dark:bg-muted">
          <Lightbulb className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">还是没弄明白？</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            点右上角「引导」可以重新看一遍三分钟的小向导；回主页按「安装新版本」再走一次也不会弄坏什么。
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { navigate("/"); }}>
          回主页
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
