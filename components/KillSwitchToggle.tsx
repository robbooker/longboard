"use client";

import { useEffect, useState } from "react";

type State = {
  orderSubmissionEnabled: boolean;
  envOverride: boolean;
  effectiveEnabled: boolean;
  updatedByEmail: string | null;
  updatedAt: string | null;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export default function KillSwitchToggle() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [flipping, setFlipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/settings/kill-switch", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json().catch(() => null)) as State | null;
      if (!data) throw new Error("invalid_json");
      setState(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function flip(nextEnabled: boolean) {
    setFlipping(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/kill-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `HTTP ${res.status}`);
      }
      setState(data as State);
      setConfirmOpen(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setFlipping(false);
    }
  }

  const mono = "var(--font-labels)";

  if (loading) {
    return <div style={{ color: "var(--text-secondary)", fontFamily: mono }}>loading kill switch state…</div>;
  }
  if (!state) {
    return <div style={{ color: "var(--danger)", fontFamily: mono }}>{error ?? "kill switch state unavailable"}</div>;
  }

  const isEnabled = state.effectiveEnabled;
  const envBlocked = state.envOverride;

  return (
    <div style={{ fontFamily: mono }}>
      {envBlocked && (
        <div style={{ background: "var(--warning-10)", border: "1px solid var(--warning)", color: "var(--warning)", padding: "10px 12px", marginBottom: 16, fontSize: 13, lineHeight: 1.5 }}>
          ⚠ Hard override active via DISABLE_ORDER_SUBMISSION env var. The soft toggle below has no effect until that env var is removed.
        </div>
      )}

      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "0.05em", color: isEnabled ? "var(--accent)" : "var(--danger)", marginBottom: 6 }}>
        {isEnabled ? "ORDERS ENABLED" : "ORDERS DISABLED"}
      </div>

      <div style={{ color: "var(--text-secondary)", fontSize: 12, marginBottom: 16 }}>
        Last changed by <span style={{ color: "var(--text-primary)" }}>{state.updatedByEmail ?? "—"}</span> at <span style={{ color: "var(--text-primary)" }}>{fmtTime(state.updatedAt)}</span>
      </div>

      {!confirmOpen ? (
        <button
          disabled={envBlocked || flipping}
          onClick={() => setConfirmOpen(true)}
          style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", padding: "10px 18px", background: "transparent", border: `1px solid ${envBlocked ? "var(--border)" : isEnabled ? "var(--danger)" : "var(--accent)"}`, color: envBlocked ? "var(--text-secondary)" : isEnabled ? "var(--danger)" : "var(--accent)", cursor: envBlocked ? "not-allowed" : "pointer" }}
        >
          {isEnabled ? "DISABLE ORDERS" : "ENABLE ORDERS"}
        </button>
      ) : (
        <div style={{ border: "1px solid var(--border)", padding: 16, background: "var(--surface)" }}>
          <div style={{ color: "var(--text-primary)", fontSize: 13, marginBottom: 12, lineHeight: 1.5 }}>
            {isEnabled ? (
              <>This will <strong style={{ color: "var(--danger)" }}>immediately block</strong> all order and locate submissions across Alpaca Paper and TradeZero Live. Cancels and flattens will still work. Continue?</>
            ) : (
              <>This will <strong style={{ color: "var(--accent)" }}>re-enable</strong> order and locate submissions across Alpaca Paper and TradeZero Live. Continue?</>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              disabled={flipping}
              onClick={() => flip(!isEnabled)}
              style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", padding: "10px 18px", background: isEnabled ? "var(--danger)" : "var(--accent)", color: "var(--bg)", border: "none", cursor: flipping ? "wait" : "pointer", opacity: flipping ? 0.6 : 1 }}
            >
              {flipping ? "..." : `CONFIRM ${isEnabled ? "DISABLE" : "ENABLE"}`}
            </button>
            <button
              disabled={flipping}
              onClick={() => { setConfirmOpen(false); setError(null); }}
              style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", padding: "10px 18px", background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)", cursor: "pointer" }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginTop: 12 }}>{error}</div>}
    </div>
  );
}
