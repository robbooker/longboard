import ResearchPanel from "@/components/ResearchPanel";
import PortfolioPanel from "@/components/PortfolioPanel";
import ThemeToggle from "@/components/ThemeToggle";

export default function SurfPage() {
  return (
    <div className="min-h-screen bg-terminal-bg flex flex-col">
      {/* Header — relaxed beach vibe */}
      <header className="border-b border-terminal-border px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img
            src="/logo-longboard.png"
            alt="Longboard"
            className="h-10 object-contain"
          />
        </div>
        <div className="flex items-center gap-4">
          <ThemeToggle current="longboard" />
          <div className="text-terminal-dim text-sm font-serif">
            live <span className="text-terminal-accent">●</span>
          </div>
        </div>
      </header>

      {/* Single-column centered layout — more editorial feel */}
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
