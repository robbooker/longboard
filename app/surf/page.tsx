import ResearchPanel from "@/components/ResearchPanel";
import PortfolioPanel from "@/components/PortfolioPanel";

export default function SurfPage() {
  return (
    <div className="min-h-screen bg-terminal-bg flex flex-col">
      {/* Single-column centered layout — global DashboardNav in app/layout.tsx */}
      <main className="flex-1 flex flex-col xl:flex-row max-w-7xl mx-auto w-full">
        <div className="flex-1 overflow-y-auto">
          <ResearchPanel />
        </div>
        <div className="w-full xl:w-[400px] overflow-y-auto border-t xl:border-t-0 xl:border-l border-terminal-border">
          <PortfolioPanel />
        </div>
      </main>
    </div>
  );
}
