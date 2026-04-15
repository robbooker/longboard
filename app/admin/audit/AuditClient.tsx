"use client";

import { useCallback, useEffect, useState } from "react";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

type KillSwitchRow = {
  id: number;
  changed_at: string;
  changed_by_email: string | null;
  field: string;
  old_value: unknown;
  new_value: unknown;
  source: string;
};

type OrderRow = {
  id: number;
  created_at: string;
  user_email: string | null;
  broker: string;
  action: string;
  symbol: string | null;
  side: string | null;
  qty: number | null;
  order_type: string | null;
  response_status: number | null;
  error_message: string | null;
  duration_ms: number | null;
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  } catch {
    return iso;
  }
}

function statusColor(status: number | null): string {
  if (status == null) return "var(--text-secondary)";
  if (status >= 500) return "var(--danger)";
  if (status >= 400) return "var(--warning)";
  if (status >= 200 && status < 300) return "var(--accent)";
  return "var(--text-secondary)";
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "ON" : "OFF";
  if (typeof v === "string" || typeof v === "number") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

export default function AuditClient() {
  const [ksRows, setKsRows] = useState<KillSwitchRow[]>([]);
  const [ordRows, setOrdRows] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ksRes, ordRes] = await Promise.all([
        fetch("/api/admin/audit?type=kill_switch", { cache: "no-store" }),
        fetch("/api/admin/audit?type=orders", { cache: "no-store" }),
      ]);
      if (!ksRes.ok) throw new Error(`kill_switch: HTTP ${ksRes.status}`);
      if (!ordRes.ok) throw new Error(`orders: HTTP ${ordRes.status}`);
      const ksData = await ksRes.json();
      const ordData = await ordRes.json();
      setKsRows(ksData.rows ?? []);
      setOrdRows(ordData.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ fontFamily: font, color: "var(--text-primary)", padding: "32px 24px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
            LONGBOARD.AI
          </div>
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
            Audit Log
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: "transparent", border: "1px solid var(--border)",
            color: "var(--text-secondary)", padding: "6px 12px", borderRadius: 3,
            fontFamily: font, fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
            cursor: loading ? "wait" : "pointer", opacity: loading ? 0.5 : 1,
          }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div style={{
          background: "var(--danger-20)", border: "1px solid var(--danger)", color: "var(--danger)",
          padding: "10px 14px", borderRadius: 4, marginBottom: 20, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* ── Kill switch history ── */}
      <SectionHeader title="Kill Switch History" right={loading ? "loading…" : `${ksRows.length} entries`} />
      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: "var(--bg)" }}>
              {["When", "Who", "Old", "New", "Source"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ksRows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ ...tdStyle, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{fmtTime(r.changed_at)}</td>
                <td style={tdStyle}>{r.changed_by_email ?? "—"}</td>
                <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{fmtValue(r.old_value)}</td>
                <td style={tdStyle}>{fmtValue(r.new_value)}</td>
                <td style={{ ...tdStyle, fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 1 }}>{r.source}</td>
              </tr>
            ))}
            {!loading && ksRows.length === 0 && (
              <tr><td colSpan={5} style={{ ...tdStyle, color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>No kill-switch flips yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Order audit ── */}
      <div style={{ marginTop: 40 }}>
        <SectionHeader title="Order Audit" right={loading ? "loading…" : `${ordRows.length} entries`} />
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                {["When", "Who", "Broker", "Action", "Symbol", "Side", "Qty", "Type", "Status", "Error", "Dur"].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordRows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{fmtTime(r.created_at)}</td>
                  <td style={{ ...tdStyle, fontSize: 11 }}>{r.user_email ?? "—"}</td>
                  <td style={{ ...tdStyle, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-secondary)" }}>{r.broker}</td>
                  <td style={{ ...tdStyle, fontSize: 10, letterSpacing: 1, textTransform: "uppercase" }}>{r.action}</td>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{r.symbol ?? "—"}</td>
                  <td style={tdStyle}>{r.side ?? "—"}</td>
                  <td style={tdStyle}>{r.qty != null ? r.qty.toLocaleString() : "—"}</td>
                  <td style={{ ...tdStyle, fontSize: 11, color: "var(--text-secondary)" }}>{r.order_type ?? "—"}</td>
                  <td style={{ ...tdStyle, color: statusColor(r.response_status), fontWeight: 600 }}>
                    {r.response_status ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 11, color: "var(--danger)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.error_message ?? undefined}>
                    {r.error_message ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)", fontSize: 11 }}>
                    {r.duration_ms != null ? `${r.duration_ms}ms` : "—"}
                  </td>
                </tr>
              ))}
              {!loading && ordRows.length === 0 && (
                <tr><td colSpan={11} style={{ ...tdStyle, color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>No orders submitted yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, right }: { title: string; right?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)",
    }}>
      <div style={{ fontSize: 14, color: "var(--text-secondary)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
        {title}
      </div>
      {right && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{right}</div>}
    </div>
  );
}

const tableWrap: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, overflow: "auto",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "10px 14px", fontSize: 10, color: "var(--text-secondary)",
  letterSpacing: 1.5, fontWeight: 500, borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = { padding: "10px 14px", color: "var(--text-primary)" };
