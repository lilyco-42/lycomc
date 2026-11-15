import { useCallback, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppDataProvider } from "@/components/app-data-provider";
import { AppTopbar } from "@/components/app-topbar";
import { AppSidebar } from "@/components/app-sidebar";
import { PageTransition } from "@/components/page-transition";
import { useAppData } from "@/context/app-data-context";
import { useRoutePath } from "@/lib/router";
import { HomePage } from "@/pages/home-page";
import { VersionsPage } from "@/pages/versions-page";
import { DownloadPage } from "@/pages/download-page";
import { ModsPage } from "@/pages/mods-page";
import { SettingsPage } from "@/pages/settings-page";
import { BackupPage } from "@/pages/backup-page";
import { NotFoundPage } from "@/pages/not-found-page";
import { GuidePage } from "@/pages/guide-page";
import { HelpPage } from "@/pages/help-page";
import { Onboarding } from "@/components/onboarding";
import { GUIDE_EVENT, hasOnboarded } from "@/lib/onboarding";

function RouteView() {
  const path = useRoutePath();
  const { backendDown } = useAppData();

  return (
    <main className="page-surface min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1200px] px-6 py-6 md:px-8 md:py-8">
        {backendDown ? (
          <div className="mb-5">
            <BackendBanner />
          </div>
        ) : null}
        <PageTransition path={path} render={(shown) => <PageSwitch path={shown} />} />
      </div>
    </main>
  );
}

function BackendBanner() {
  const { reload } = useAppData();
  return (
    <div className="card-soft flex flex-wrap items-center gap-3 rounded-xl border border-pcl-4/40 bg-card px-4 py-3 text-sm text-pcl-2 dark:text-pcl-5">
      <span className="font-medium">后端未就绪</span>
      <span className="text-pcl-2 dark:text-pcl-5">
        连不上 lycomc 服务，页面仍可浏览，数据会在服务恢复后加载。
      </span>
      <button
        type="button"
        onClick={reload}
        className="ml-auto rounded-lg border border-pcl-4/50 px-2 py-1 text-xs font-medium hover:bg-pcl-7"
      >
        重新连接
      </button>
    </div>
  );
}

function PageSwitch({ path }: { path: string }) {
  switch (path) {
    case "/":
      return <HomePage />;
    case "/versions":
      return <VersionsPage />;
    case "/download":
      return <DownloadPage />;
    case "/mods":
      return <ModsPage />;
    case "/settings":
      return <SettingsPage />;
    case "/backup":
      return <BackupPage />;
    case "/guide":
      return <GuidePage />;
    case "/help":
      return <HelpPage />;
    default:
      return <NotFoundPage />;
  }
}

function App() {
  const [showGuide, setShowGuide] = useState<boolean>(() => !hasOnboarded());

  useEffect(() => {
    const reopen = () => { setShowGuide(true); };
    window.addEventListener(GUIDE_EVENT, reopen);
    return () => { window.removeEventListener(GUIDE_EVENT, reopen); };
  }, []);

  const closeGuide = useCallback(() => { setShowGuide(false); }, []);

  return (
    <AppDataProvider>
      <TooltipProvider>
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
          <AppTopbar />
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <AppSidebar />
            <RouteView />
          </div>
        </div>
        {showGuide ? <Onboarding onFinish={closeGuide} /> : null}
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </AppDataProvider>
  );
}

export default App;
