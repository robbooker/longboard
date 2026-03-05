"use client";

import { useState, useEffect, useRef } from "react";
import { submitTickerResearch, subscribeToResearch } from "@/lib/supabase";
import type { TickerResearch, ResearchStatus } from "@/types";

const STATUS_MESSAGES: Record<ResearchStatus, string> = {
  pending:    "queued — waiting for Buddy",
  processing: "Buddy is on it...",
  complete:   "research complete",
  error:      "something went wrong",
};

function StatusDot({ status }: { status: ResearchStatus }) {
  const colors: Record<ResearchStatus, string> = {
    pending:    "bg-terminal-dim",
    processing: "bg-terminal-warn animate-pulse",
    complete:   "bg-terminal-accent",
    error:      "bg-terminal-danger",
  };
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full mr-2 ${colors[status]}`}
    />
  );
}

function Spinner() {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => (f + 1) % frames.length), 80);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="text-terminal-warn font-mono text-sm">{frames[frame]}</span>
  );
}

function ResearchCard({ research }: { research: TickerResearch }) {
  const isLive = research.status === "pending" || research.status === "processing";

  return (
    <div className="animate-slide-up border border-terminal-border bg-terminal-surface rounded-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center gap-3">
          <span className="text-terminal-accent font-mono font-semibold text-lg tracking-widest">
            ${research.ticker}
          </span>
          <span className="text-terminal-dim text-xs">
            {new Date(research.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
        <div className="flex items-center text-xs font-mono text-terminal-dim">
          <StatusDot status={research.status} />
          {isLive && <Spinner />}
          <span className={`ml-2 ${isLive ? "text-terminal-warn" : research.status === "complete" ? "text-terminal-accent" : "text-terminal-danger"}`}>
            {STATUS_MESSAGES[research.status]}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {research.status === "pending" && (
          <div className="text-terminal-dim text-sm py-4 text-center">
            <span className="animate-pulse">request received — Buddy will begin shortly</span>
          </div>
        )}

        {research.status === "processing" && (
          <div className="text-terminal-dim text-sm py-4 text-center space-y-1">
            <div className="text-terminal-warn">pulling Polygon data + Brave search + SEC EDGAR...</div>
            <div className="text-xs text-terminal-dim">this usually takes 30–60 seconds</div>
          </div>
        )}

        {research.status === "complete" && research.result && (
          <pre className="result-text text-terminal-text font-mono animate-fade-in">
            {research.result}
          </pre>
        )}

        {research.status === "error" && (
          <div className="text-terminal-danger text-sm py-4 text-center">
            Buddy encountered an error. Check Slack for details.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-terminal-border flex justify-between text-xs text-terminal-dim font-mono">
        <span>id: {research.id.slice(0, 8)}...</span>
        <span>powered by Buddy / Scout</span>
      </div>
    </div>
  );
}

export default function ResearchPanel() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [researches, setResearches] = useState<TickerResearch[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Subscribe to each research item
  useEffect(() => {
    const subs = researches
      .filter((r) => r.status === "pending" || r.status === "processing")
      .map((r) =>
        subscribeToResearch(r.id, (updated) => {
          setResearches((prev) =>
            prev.map((item) => (item.id === updated.id ? updated : item))
          );
        })
      );

    return () => {
      subs.forEach((s) => s.unsubscribe());
    };
  }, [researches.map((r) => r.id + r.status).join(",")]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const clean = ticker.trim().toUpperCase();
    if (!clean) return;

    setLoading(true);
    setError(null);

    try {
      const row = await submitTickerResearch(clean);
      setResearches((prev) => [row, ...prev]);
      setTicker("");
    } catch (err) {
      setError("Failed to submit. Check your Supabase connection.");
      console.error(err);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="min-h-screen bg-terminal-bg flex flex-col">
      {/* Top bar */}
      <header className="border-b border-terminal-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-terminal-accent text-xl font-mono font-semibold tracking-widest">
            LONGBOARD
          </span>
          <span className="text-terminal-dim text-xs font-mono border border-terminal-muted px-2 py-0.5 rounded-sm">
            research terminal
          </span>
        </div>
        <div className="text-terminal-dim text-xs font-mono">
          BUDDY ONLINE <span className="text-terminal-accent animate-pulse">●</span>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 space-y-6">
        {/* Input */}
        <form onSubmit={handleSubmit} className="flex gap-3 items-center">
          <div className="flex-1 flex items-center border border-terminal-border bg-terminal-surface rounded-sm px-4 py-3 gap-3 focus-within:border-terminal-accent transition-colors">
            <span className="text-terminal-accent font-mono text-sm select-none">$</span>
            <input
              ref={inputRef}
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z.]/g, ""))}
              placeholder="NVDA"
              maxLength={10}
              className="ticker-input flex-1 bg-transparent text-terminal-text font-mono text-lg tracking-widest outline-none"
              disabled={loading}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="characters"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !ticker.trim()}
            className="px-6 py-3 bg-terminal-surface border border-terminal-border text-terminal-accent font-mono text-sm tracking-widest hover:bg-terminal-muted hover:border-terminal-accent transition-all disabled:opacity-30 disabled:cursor-not-allowed rounded-sm"
          >
            {loading ? "..." : "RESEARCH"}
          </button>
        </form>

        {error && (
          <div className="text-terminal-danger text-xs font-mono border border-terminal-danger/30 bg-terminal-danger/5 px-4 py-2 rounded-sm">
            ✗ {error}
          </div>
        )}

        {/* Hint */}
        {researches.length === 0 && (
          <div className="text-center py-16 text-terminal-dim font-mono text-sm space-y-2">
            <div>enter a ticker above</div>
            <div className="text-xs">Buddy will pull Polygon · Brave · SEC EDGAR and return a full report</div>
          </div>
        )}

        {/* Results */}
        <div className="space-y-4">
          {researches.map((r) => (
            <ResearchCard key={r.id} research={r} />
          ))}
        </div>
      </main>
    </div>
  );
}
