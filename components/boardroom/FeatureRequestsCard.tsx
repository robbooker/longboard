"use client";

import React, { useState } from "react";

const font = "var(--font-labels)";

export type FeatureRequest = {
  id: string;
  title: string;
  upvote_count: number;
  userVoted: boolean;
};

export default function FeatureRequestsCard({ items }: { items: FeatureRequest[] }) {
  const [rows, setRows] = useState<FeatureRequest[]>(items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Submit form state.
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitTitle, setSubmitTitle] = useState("");
  const [submitBody, setSubmitBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);

  async function toggleVote(id: string) {
    setError(null);
    setBusyId(id);

    // Optimistic flip — revert if the server says no.
    const prev = rows;
    setRows((rs) => rs.map((r) => r.id === id ? {
      ...r,
      userVoted: !r.userVoted,
      upvote_count: r.upvote_count + (r.userVoted ? -1 : 1),
    } : r));

    try {
      const res = await fetch(`/api/boardroom/feature-requests/${id}/vote`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { voted: boolean; upvote_count: number };
      // Reconcile against authoritative server count (handles concurrent
      // votes from other members during our optimistic window).
      setRows((rs) => rs.map((r) => r.id === id ? {
        ...r,
        userVoted: data.voted,
        upvote_count: data.upvote_count,
      } : r));
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "vote_failed");
    } finally {
      setBusyId(null);
    }
  }

  async function submit() {
    setError(null);
    setSubmitNotice(null);
    const title = submitTitle.trim();
    if (!title) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/boardroom/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body: submitBody.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setSubmitTitle("");
      setSubmitBody("");
      setSubmitOpen(false);
      // The new request is unpublished and won't appear in the visible
      // top-3. Surface this so the member doesn't think submission failed.
      setSubmitNotice("Submitted — pending admin review before it appears here.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "submit_failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 14,
      }}>
        <div style={{
          fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
          textTransform: "uppercase", fontWeight: 600,
        }}>
          Feature Requests
        </div>
        {!submitOpen && (
          <button
            onClick={() => { setSubmitOpen(true); setSubmitNotice(null); }}
            style={{
              fontSize: 10, color: "var(--accent)", background: "transparent",
              border: "1px solid var(--accent)", borderRadius: 3,
              padding: "3px 10px", letterSpacing: 1, textTransform: "uppercase",
              fontWeight: 700, cursor: "pointer", fontFamily: font,
            }}
          >
            + Submit
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}
      {submitNotice && (
        <div style={{ color: "var(--accent)", fontSize: 12, marginBottom: 10 }}>{submitNotice}</div>
      )}

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No feature requests yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              paddingBottom: 10, borderBottom: "1px solid var(--border)",
            }}>
              <UpvoteButton
                count={r.upvote_count}
                voted={r.userVoted}
                disabled={busyId === r.id}
                onClick={() => toggleVote(r.id)}
              />
              <span style={{ fontSize: 13, color: "var(--text-primary)", flex: 1 }}>
                {r.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {submitOpen && (
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <input
            type="text"
            value={submitTitle}
            onChange={(e) => setSubmitTitle(e.target.value)}
            placeholder="Short title — what would you like to see?"
            disabled={submitting}
            style={fieldStyle}
            autoFocus
          />
          <textarea
            value={submitBody}
            onChange={(e) => setSubmitBody(e.target.value)}
            placeholder="Optional context"
            rows={3}
            disabled={submitting}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={submit}
              disabled={submitting || !submitTitle.trim()}
              style={{
                background: "var(--accent)", color: "var(--bg)", border: "none",
                padding: "6px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
                fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting || !submitTitle.trim() ? 0.6 : 1,
              }}
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
            <button
              onClick={() => { setSubmitOpen(false); setSubmitTitle(""); setSubmitBody(""); }}
              disabled={submitting}
              style={{
                background: "transparent", color: "var(--text-primary)",
                border: "1px solid var(--border)",
                padding: "6px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
                fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UpvoteButton({
  count, voted, disabled, onClick,
}: {
  count: number;
  voted: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const fg = voted ? "var(--bg)" : "var(--accent)";
  const bg = voted ? "var(--accent)" : "var(--bg)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={voted}
      aria-label={voted ? `Remove vote (${count} total)` : `Add vote (${count} total)`}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minWidth: 36, padding: "4px 6px",
        background: bg, border: "1px solid var(--border)",
        borderColor: voted ? "var(--accent)" : "var(--border)",
        borderRadius: 4, cursor: disabled ? "wait" : "pointer",
        fontFamily: font,
      }}
    >
      <div style={{ fontSize: 10, color: fg, lineHeight: 1 }}>▲</div>
      <div style={{ fontSize: 12, color: voted ? "var(--bg)" : "var(--text-primary)", fontWeight: 600, lineHeight: 1.2 }}>
        {count}
      </div>
    </button>
  );
}

const fieldStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
  padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
  fontFamily: font, fontSize: 13, outline: "none",
};
