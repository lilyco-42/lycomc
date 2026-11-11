import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppDataProvider } from "@/components/app-data-provider";
import { AppSidebar } from "@/components/app-sidebar";
import { useAppData } from "@/context/app-data-context";
import { useRoutePath } from "@/lib/router";
import { HomePage } from "@/pages/home-page";
import { VersionsPage } from "@/pages/versions-page";
import { DownloadPage } from "@/pages/download-page";
import { ModsPage } from "@/pages/mods-page";
import { SettingsPage } from "@/pages/settings-page";
import { NotFoundPage } from "@/pages/not-found-page";

function RouteView() {
  const path = useRoutePath();
  const { backendDown } = useAppData();

  return (
    <main className="page-glow min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-6 py-6">
        {backendDown ? (
          <div className="mb-4">
            <BackendBanner />
          </div>
        ) : null}
        <PageSwitch path={path} />
      </div>
    </main>
  );
}

function BackendBanner() {
  const { reload } = useAppData();
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-700 dark:text-amber-300">
      <span className="font-medium">后端未就绪</span>
      <span className="text-amber-700/80 dark:text-amber-300/80">
        连不上 lycomc 服务，页面仍可浏览，数据会在服务恢复后加载。
      </span>
      <button
        type="button"
        onClick={reload}
        className="ml-auto rounded-lg border border-amber-500/40 px-2 py-1 text-xs font-medium hover:bg-amber-500/10"
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
    default:
      return <NotFoundPage />;
  }
}

function App() {
  return (
    <AppDataProvider>
      <TooltipProvider>
        <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
          <AppSidebar />
          <RouteView />
        </div>
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </AppDataProvider>
  );
}

export default App;
