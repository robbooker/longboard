"use client";

import Link from "next/link";

export default function ThemeToggle({ current }: { current: "terminal" | "longboard" }) {
  const isTerminal = current === "terminal";

  return (
    <Link
      href={isTerminal ? "/surf" : "/"}
      className="flex items-center gap-2 px-3 py-1.5 border border-terminal-border rounded-sm text-xs font-mono text-terminal-dim hover:text-terminal-accent hover:border-terminal-accent transition-all"
      title={isTerminal ? "Switch to Longboard mode" : "Switch to Terminal mode"}
    >
      {isTerminal ? (
        <>
          <span className="text-sm">🏄</span>
          <span>Longboard</span>
        </>
      ) : (
        <>
          <span className="text-sm">⌨</span>
          <span>Terminal</span>
        </>
      )}
    </Link>
  );
}
