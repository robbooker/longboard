import ResearchPanel from "@/components/ResearchPanel";
import PortfolioPanel from "@/components/PortfolioPanel";

export default function Workspace() {
  return (
    <div className="min-h-screen bg-terminal-bg flex flex-col">
      {/* Two-panel layout — global DashboardNav lives in app/layout.tsx */}
      <main className="flex-1 flex flex-col lg:flex-row">
        <div className="flex-1 lg:border-r lg:border-terminal-border overflow-y-auto">
          <ResearchPanel />
        </div>
        <div className="w-full lg:w-[420px] xl:w-[480px] overflow-y-auto border-t lg:border-t-0 border-terminal-border">
          <PortfolioPanel />
        </div>
      </main>
    </div>
  );
}
