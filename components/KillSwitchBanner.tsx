"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type State = {
  orderSubmissionEnabled: boolean;
  envOverride: boolean;
  effectiveEnabled: boolean;
  updatedByEmail: string | null;
  updatedAt: string | null;
};

export default function KillSwitchBanner() {
  const [mounted, setMounted] = useState(false);
  const state = useKillSwitchState();
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  if (!state || state.effectiveEnabled) return null;
  const reason = state.envOverride ? "env_override" : "soft_disabled";
  return (
    <div
      style={{
        background: "rgba(255, 92, 92, 0.12)",
        borderTop: "1px solid #ff5c5c",
        borderBottom: "1px solid #ff5c5c",
        color: "#ff5c5c",
        fontFamily: '"IBM Plex Mono", monospace',
        fontSize: 13,
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div>
        <strong style={{ letterSpacing: "0.08em" }}>ORDERS DISABLED</strong>{" "}
        <span style={{ color: "#f0a0a0" }}>
          — New orders and locates are blocked. Cancels and flattens still work.
          {reason === "env_override" ? " (Hard env override active.)" : ""}
        </span>
      </div>
      <Link href="/settings" style={{ color: "#ff5c5c", textDecoration: "underline", whiteSpace: "nowrap" }}>
        Manage in Settings →
      </Link>
    </div>
  );
}

export function useKillSwitchState(): State | null {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/settings/kill-switch", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as State;
        if (!cancelled) setState(data);
      } catch {}
    }
    load();
    const id = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);
  return state;
}

export function useKillSwitchOrdersBlocked(): boolean {
  const [mounted, setMounted] = useState(false);
  const state = useKillSwitchState();
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return false;
  return state ? !state.effectiveEnabled : false;
}
