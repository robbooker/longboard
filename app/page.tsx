import ResearchPanel from "@/components/ResearchPanel";
import PortfolioPanel from "@/components/PortfolioPanel";
import ThemeToggle from "@/components/ThemeToggle";
import ThemeSetter from "@/components/ThemeSetter";

export default function Home() {
  return (
    <div className="min-h-screen bg-terminal-bg flex flex-col">
      <ThemeSetter theme="terminal" />

      {/* Header */}
      <header className="border-b border-terminal-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-terminal-accent text-xl font-mono font-semibold tracking-widest">
            LONGBOARD
          </span>
          <span className="text-terminal-dim text-xs font-mono border border-terminal-muted px-2 py-0.5 rounded-sm">
            research terminal
          </span>
        </div>
        <div className="flex items-center gap-4">
          <a href="/research/drop-and-pop" className="text-terminal-dim text-xs font-mono border border-terminal-muted px-2 py-0.5 rounded-sm hover:text-terminal-accent hover:border-terminal-accent/30 transition-colors">
            Drop &amp; Pop
          </a>
          <ThemeToggle current="terminal" />
          <div className="text-terminal-dim text-xs font-mono">
            LIVE <span className="text-terminal-accent animate-pulse">●</span>
          </div>
        </div>
      </header>

      {/* Two-panel layout */}
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
