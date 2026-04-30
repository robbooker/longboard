"use client";

import React, { useCallback, useEffect, useState } from "react";

const font = "var(--font-labels)";

type ArchiveSummary = {
  id: string;
  sent_date: string;
  subject: string;
  generated_by_email: string | null;
  created_at: string;
  top_pick_ticker: string;
  also_on_board_tickers: string[];
};

type ArchiveDetail = {
  id: string;
  sent_date: string;
  subject: string;
  stocks_json: unknown;
  qa_json: unknown;
  html: string;
  generated_by: string | null;
  generated_by_email: string | null;
  created_at: string;
};

type Toast = { kind: "ok" | "error"; message: string };

export default function HistoryClient() {
  const [summaries, setSummaries] = useState<ArchiveSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadList = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch("/api/admin/morning-email/archive", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSummaries(data as ArchiveSummary[]);
    } catch (e) {
      setSummaries([]);
      setListError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  const handleDelete = useCallback(
    async (row: ArchiveSummary) => {
      const msg = `Delete this brief from ${row.sent_date} generated at ${formatTimestamp(row.created_at)}? This cannot be undone.`;
      if (!confirm(msg)) return;

      const previous = summaries ?? [];
      setPendingDelete(row.id);
      setSummaries((prev) => (prev ?? []).filter((s) => s.id !== row.id));

      try {
        const res = await fetch(`/api/admin/morning-email/archive/${encodeURIComponent(row.id)}`, {
          method: "DELETE",
          cache: "no-store",
        });
        if (!res.ok) {
          let body = "";
          try { body = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
        }
        showToast({ kind: "ok", message: `Deleted ${row.sent_date} (${formatTimestamp(row.created_at)})` });
      } catch (e) {
        setSummaries(previous);
        const errMsg = e instanceof Error ? e.message : String(e);
        showToast({ kind: "error", message: `Failed to delete: ${errMsg}` });
      } finally {
        setPendingDelete((d) => (d === row.id ? null : d));
      }
    },
    [summaries, showToast],
  );

  return (
    <div style={{ fontFamily: font, color: "var(--text-primary)", padding: "32px 24px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
            LONGBOARD.AI
          </div>
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
            Morning Email · History
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/admin/morning-email" style={backBtn}>← Generator</a>
          <a href="/admin" style={backBtn}>← Admin</a>
        </div>
      </div>

      <div style={infoBanner}>
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6, color: "var(--text-secondary)" }}>
          Archive
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Every successfully generated brief is snapshotted to <code>morning_email_archive</code>.
          Multiple snapshots per day are expected — the timestamp distinguishes them.
          View opens the stored HTML; Delete is permanent.
        </div>
      </div>

      {listError && <div style={errorBanner}>Failed to load: {listError}</div>}

      <Body summaries={summaries} pendingDelete={pendingDelete} onView={setViewingId} onDelete={handleDelete} />

      {viewingId && <Modal id={viewingId} onClose={() => setViewingId(null)} onToast={showToast} />}
      {toast && <ToastView toast={toast} />}
    </div>
  );
}

type BodyProps = {
  summaries: ArchiveSummary[] | null;
  pendingDelete: string | null;
  onView: (id: string) => void;
  onDelete: (row: ArchiveSummary) => void;
};

function Body({ summaries, pendingDelete, onView, onDelete }: BodyProps) {
  if (summaries === null) {
    return <div style={emptyState}>Loading…</div>;
  }
  if (summaries.length === 0) {
    return <div style={emptyState}>No briefs archived yet.</div>;
  }
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Sent Date</th>
            <th style={thStyle}>Subject</th>
            <th style={thStyle}>Top Pick</th>
            <th style={thStyle}>Also On Board</th>
            <th style={thStyle}>Generated By</th>
            <th style={thStyle}>Created</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map((s) => {
            const pending = pendingDelete === s.id;
            return (
              <tr key={s.id} style={{ opacity: pending ? 0.4 : 1 }}>
                <td style={tdStyle}>
                  <button
                    type="button"
                    onClick={() => onView(s.id)}
                    disabled={pending}
                    style={linkBtn}
                  >
                    {s.sent_date}
                  </button>
                </td>
                <td style={tdStyle}>{s.subject || "—"}</td>
                <td style={tdStyle}>{s.top_pick_ticker || "—"}</td>
                <td style={tdStyle}>{s.also_on_board_tickers.length > 0 ? s.also_on_board_tickers.join(", ") : "—"}</td>
                <td style={tdStyle}>{s.generated_by_email || "—"}</td>
                <td style={tdStyle}>
                  <span title={s.created_at}>{formatTimestamp(s.created_at)}</span>
                </td>
                <td style={tdStyle}>
                  <button type="button" onClick={() => onView(s.id)} disabled={pending} style={linkBtn}>View</button>
                  <span style={{ color: "var(--text-secondary)", margin: "0 8px" }}>|</span>
                  <button type="button" onClick={() => onDelete(s)} disabled={pending} style={linkBtn}>Delete</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type ModalProps = {
  id: string;
  onClose: () => void;
  onToast: (t: Toast) => void;
};

function Modal({ id, onClose, onToast }: ModalProps) {
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "done" | "err">("idle");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/morning-email/archive/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          let body = "";
          try { body = await r.text(); } catch {}
          throw new Error(`HTTP ${r.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
        }
        return r.json();
      })
      .then((data: ArchiveDetail) => {
        if (cancelled) return;
        setDetail(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    if (!detail) return;
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(detail.html);
      setCopyState("done");
      setTimeout(() => setCopyState("idle"), 1500);
      onToast({ kind: "ok", message: "HTML copied to clipboard" });
    } catch (e) {
      setCopyState("err");
      setTimeout(() => setCopyState("idle"), 2500);
      onToast({ kind: "error", message: e instanceof Error ? e.message : "Copy failed" });
    }
  }, [detail, onToast]);

  const copyLabel = copyState === "copying" ? "Copying…" : copyState === "done" ? "Copied!" : copyState === "err" ? "Copy failed" : "Copy HTML";

  return (
    <div onClick={onClose} style={modalBackdrop}>
      <div onClick={(e) => e.stopPropagation()} style={modalBox}>
        <div style={modalHeader}>
          <div style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 12 }}>
            <span style={{ color: "var(--accent)", fontWeight: 600 }}>{detail?.sent_date ?? "…"}</span>
            <span style={{ color: "var(--text-secondary)" }}>· {detail ? formatTimestamp(detail.created_at) : ""}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={handleCopy} disabled={!detail || copyState === "copying"} style={modalBtn}>{copyLabel}</button>
            <button type="button" onClick={onClose} style={modalBtn}>Close</button>
          </div>
        </div>
        <div style={modalBody}>
          {error && <div style={errorBanner}>Failed to load: {error}</div>}
          {!error && !detail && <div style={emptyState}>Loading…</div>}
          {detail && (
            <iframe
              title={`morning-email-${detail.sent_date}-${detail.id}`}
              srcDoc={detail.html}
              style={modalIframe}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ToastView({ toast }: { toast: Toast }) {
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        padding: "10px 16px",
        background: toast.kind === "ok" ? "var(--bg-secondary, transparent)" : "var(--danger-20)",
        color: toast.kind === "ok" ? "var(--text-primary)" : "var(--danger)",
        fontSize: 12,
        border: `1px solid ${toast.kind === "ok" ? "var(--border)" : "var(--danger)"}`,
        borderRadius: 4,
        zIndex: 100,
        maxWidth: 360,
        fontFamily: font,
      }}
    >
      {toast.message}
    </div>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} CT`;
}

const backBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "8px 14px",
  background: "transparent",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  textDecoration: "none",
  letterSpacing: 1,
  textTransform: "uppercase",
  fontFamily: font,
};

const infoBanner: React.CSSProperties = {
  padding: "14px 16px",
  marginBottom: 20,
  border: "1px solid var(--border)",
  borderRadius: 4,
  background: "var(--bg-secondary, transparent)",
};

const errorBanner: React.CSSProperties = {
  background: "var(--danger-20)",
  border: "1px solid var(--danger)",
  color: "var(--danger)",
  padding: "10px 14px",
  borderRadius: 4,
  marginBottom: 16,
  fontSize: 13,
};

const tableWrap: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 4,
  overflowX: "auto",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 10,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "var(--text-primary)",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

const linkBtn: React.CSSProperties = {
  background: "transparent",
  border: 0,
  padding: 0,
  color: "var(--accent)",
  fontFamily: font,
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
};

const emptyState: React.CSSProperties = {
  padding: "20px",
  textAlign: "center",
  fontSize: 12,
  color: "var(--text-secondary)",
  border: "1px dashed var(--border)",
  borderRadius: 4,
};

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 80,
  padding: 20,
};

const modalBox: React.CSSProperties = {
  width: "100%",
  maxWidth: 720,
  height: "90vh",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const modalHeader: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "var(--bg-secondary, transparent)",
};

const modalBody: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  background: "var(--bg)",
  overflow: "hidden",
};

const modalIframe: React.CSSProperties = {
  flex: 1,
  width: "100%",
  border: 0,
  background: "#fff",
};

const modalBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "6px 12px",
  background: "transparent",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  letterSpacing: 1,
  textTransform: "uppercase",
  fontFamily: font,
  cursor: "pointer",
};
