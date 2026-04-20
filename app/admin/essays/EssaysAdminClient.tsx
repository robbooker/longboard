"use client";

import React, { useEffect, useState } from "react";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

type EssayRow = {
  slug: string;
  issue: number;
  title: string;
  kicker: string | null;
  dek: string | null;
  published: string | null;
  read_minutes: number | null;
  audio_url: string | null;
  daily_rank: number | null;
  publish_at: string | null;
  synced_at: string;
};

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

function isScheduled(publishAt: string | null): boolean {
  if (!publishAt) return false;
  return new Date(publishAt).getTime() > Date.now();
}

export default function EssaysAdminClient() {
  const [rows, setRows] = useState<EssayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/essays", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setRows((data.essays ?? []) as EssayRow[]))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const orphanCount = rows.filter((r) => r.daily_rank === null).length;
  const scheduledCount = rows.filter((r) => isScheduled(r.publish_at)).length;

  return (
    <div style={{ fontFamily: font, color: "var(--text-primary)", padding: "32px 24px", maxWidth: 1200, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
            LONGBOARD.AI
          </div>
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
            Essays
          </div>
        </div>
        <a
          href="/admin"
          style={{
            fontSize: 11, padding: "6px 14px",
            color: "var(--text-secondary)", border: "1px solid var(--border)",
            borderRadius: 3, textDecoration: "none", letterSpacing: 1,
            textTransform: "uppercase", fontFamily: font,
          }}
        >
          ← Admin
        </a>
      </div>

      {error && (
        <div style={{
          background: "var(--danger-20)", border: "1px solid var(--danger)", color: "var(--danger)",
          padding: "10px 14px", borderRadius: 4, marginBottom: 20, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* ── Section header ── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ fontSize: 14, color: "var(--text-secondary)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
          All essays
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          {loading
            ? "loading…"
            : `${rows.length} total · ${scheduledCount} scheduled · ${orphanCount} orphaned`}
        </div>
      </div>

      {/* ── Table ── */}
      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: "var(--bg)" }}>
              {["Issue", "Title", "Slug", "Published", "Read", "Audio", "Rank", ""].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const isOrphan = e.daily_rank === null;
              const scheduled = isScheduled(e.publish_at);
              return (
                <tr key={e.slug} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{
                    ...tdStyle,
                    borderLeft: isOrphan ? "3px solid var(--warning)" : "3px solid transparent",
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {pad3(e.issue)}
                  </td>
                  <td style={tdStyle}>{e.title}</td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)", fontSize: 12 }}>{e.slug}</td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {e.published ?? "—"}
                    {scheduled && <ScheduledPill />}
                  </td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {e.read_minutes ?? "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    {e.audio_url ? (
                      <span style={{ color: "var(--accent)", fontWeight: 700 }}>✓</span>
                    ) : (
                      <span style={{ color: "var(--text-secondary)" }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {e.daily_rank === null
                      ? <span style={{ color: "var(--text-secondary)" }}>—</span>
                      : e.daily_rank}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <a href={`/learn/${e.slug}`} style={viewBtn}>
                      View →
                    </a>
                  </td>
                </tr>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...tdStyle, color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>
                  No essays synced yet. Run <code style={{ fontSize: 12 }}>npm run build</code> or check{" "}
                  <code style={{ fontSize: 12 }}>scripts/sync-essays.mjs</code> logs.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Legend ── */}
      {!loading && rows.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 11, color: "var(--text-secondary)", display: "flex", gap: 24, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 3, height: 14, background: "var(--warning)" }} />
            Orphaned — no <code style={{ fontSize: 11 }}>daily_rank</code>, not on the Daily rail
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <ScheduledPill />
            Scheduled — <code style={{ fontSize: 11 }}>publish_at</code> in the future
          </span>
        </div>
      )}
    </div>
  );
}

function ScheduledPill() {
  return (
    <span style={{
      marginLeft: 8,
      fontSize: 9,
      padding: "2px 6px",
      border: "1px solid var(--warning)",
      color: "var(--warning)",
      borderRadius: 2,
      textTransform: "uppercase",
      letterSpacing: 1,
      fontWeight: 600,
      verticalAlign: "middle",
    }}>
      Scheduled
    </span>
  );
}

const tableWrap: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  overflow: "hidden",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  fontSize: 10,
  color: "var(--text-secondary)",
  letterSpacing: 1.5,
  fontWeight: 500,
  borderBottom: "1px solid var(--border)",
};
const tdStyle: React.CSSProperties = { padding: "12px 14px", color: "var(--text-primary)" };

const viewBtn: React.CSSProperties = {
  fontSize: 10,
  color: "var(--accent)",
  border: "1px solid var(--accent)",
  padding: "4px 10px",
  borderRadius: 3,
  textDecoration: "none",
  letterSpacing: 1,
  fontWeight: 700,
  textTransform: "uppercase",
  fontFamily: font,
};
