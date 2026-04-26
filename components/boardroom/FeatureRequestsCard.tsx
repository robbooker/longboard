"use client";

import React, { useState } from "react";
import { CardHeader, BtnAccent, BtnGhost, smallBtn, PublishPill } from "@/components/boardroom/shared";
import FeatureRequestDraftForm, {
  type FeatureRequestDraft,
  emptyFeatureRequestDraft,
  featureRequestRowToDraft,
  featureRequestDraftToPayload,
} from "@/components/boardroom/drafts/FeatureRequestDraftForm";

const font = "var(--font-labels)";

export type FeatureRequest = {
  id: string;
  cohort?: string;
  title: string;
  body?: string | null;
  upvote_count: number;
  is_published?: boolean;
  userVoted: boolean;
};

export default function FeatureRequestsCard({
  cohort, isAdmin, items,
}: {
  cohort: string;
  isAdmin: boolean;
  items: FeatureRequest[];
}) {
  const [rows, setRows] = useState<FeatureRequest[]>(items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Member-side submit form.
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitTitle, setSubmitTitle] = useState("");
  const [submitBody, setSubmitBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);

  // Admin-side edit mode.
  const [editing, setEditing] = useState(false);
  const [adminAdding, setAdminAdding] = useState(false);
  const [adminAddDraft, setAdminAddDraft] = useState<FeatureRequestDraft>(emptyFeatureRequestDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FeatureRequestDraft>(emptyFeatureRequestDraft);
  const [busy, setBusy] = useState(false);

  function exitEdit() { setEditing(false); setAdminAdding(false); setEditingId(null); setError(null); }

  async function toggleVote(id: string) {
    setError(null);
    setBusyId(id);
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
      setRows((rs) => rs.map((r) => r.id === id ? {
        ...r, userVoted: data.voted, upvote_count: data.upvote_count,
      } : r));
    } catch (e) {
      setRows(prev);
      setError(e instanceof Error ? e.message : "vote_failed");
    } finally {
      setBusyId(null);
    }
  }

  async function memberSubmit() {
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
      setSubmitTitle(""); setSubmitBody(""); setSubmitOpen(false);
      setSubmitNotice("Submitted — pending admin review before it appears here.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "submit_failed");
    } finally {
      setSubmitting(false);
    }
  }

  function startRow(r: FeatureRequest) {
    setEditingId(r.id);
    setEditDraft(featureRequestRowToDraft({
      title: r.title, body: r.body ?? null, is_published: r.is_published ?? true,
    }));
  }

  async function adminAdd() {
    setError(null);
    if (!adminAddDraft.title.trim()) { setError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/boardroom/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...featureRequestDraftToPayload(adminAddDraft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => [{ ...(data as FeatureRequest), userVoted: false }, ...rs].sort(byVotes));
      setAdminAddDraft(emptyFeatureRequestDraft); setAdminAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "add_failed");
    } finally { setBusy(false); }
  }

  async function adminSave(id: string) {
    setError(null);
    if (!editDraft.title.trim()) { setError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/feature-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(featureRequestDraftToPayload(editDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((r) => r.id === id ? {
        ...(data as FeatureRequest), userVoted: r.userVoted,
      } : r).sort(byVotes));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function adminTogglePublish(r: FeatureRequest) {
    setError(null); setBusy(true);
    const next = !(r.is_published ?? true);
    try {
      const res = await fetch(`/api/admin/boardroom/feature-requests/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((x) => x.id === r.id ? {
        ...(data as FeatureRequest), userVoted: x.userVoted,
      } : x));
    } catch (e) {
      setError(e instanceof Error ? e.message : "toggle_failed");
    } finally { setBusy(false); }
  }

  async function adminRemove(id: string) {
    if (!confirm("Delete this feature request?")) return;
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/feature-requests/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    } finally { setBusy(false); }
  }

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <CardHeader
        title="Feature Requests"
        isAdmin={isAdmin}
        editing={editing}
        onToggle={() => editing ? exitEdit() : setEditing(true)}
        right={!editing && !submitOpen ? (
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
        ) : undefined}
      />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}
      {submitNotice && (
        <div style={{ color: "var(--accent)", fontSize: 12, marginBottom: 10 }}>{submitNotice}</div>
      )}

      {rows.length === 0 && !adminAdding ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No feature requests yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => editing && editingId === r.id ? (
            <div key={r.id} style={editBox}>
              <FeatureRequestDraftForm draft={editDraft} setDraft={setEditDraft} />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <BtnAccent onClick={() => adminSave(r.id)} disabled={busy}>{busy ? "Saving…" : "Save"}</BtnAccent>
                <BtnGhost onClick={() => setEditingId(null)} disabled={busy}>Cancel</BtnGhost>
              </div>
            </div>
          ) : (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              paddingBottom: 10, borderBottom: "1px solid var(--border)",
            }}>
              <UpvoteButton
                count={r.upvote_count}
                voted={r.userVoted}
                disabled={busyId === r.id || (editing && busy)}
                onClick={() => toggleVote(r.id)}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {r.is_published === false && <PublishPill on={false} />}
                  <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{r.title}</span>
                </div>
                {editing && r.body && (
                  <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.4 }}>
                    {r.body}
                  </div>
                )}
              </div>
              {isAdmin && editing && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => adminTogglePublish(r)}
                    disabled={busy}
                    style={{
                      ...smallBtn(r.is_published === false ? "var(--accent)" : "var(--warning)"),
                      cursor: busy ? "wait" : "pointer",
                    }}
                  >
                    {r.is_published === false ? "PUBLISH" : "UNPUBLISH"}
                  </button>
                  <button onClick={() => startRow(r)} disabled={busy} style={smallBtn("var(--text-secondary)")}>EDIT</button>
                  <button onClick={() => adminRemove(r.id)} disabled={busy} style={smallBtn("var(--danger)")}>DELETE</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Admin-side: + Add row in edit mode */}
      {isAdmin && editing && !adminAdding && !editingId && (
        <div style={{ marginTop: 12 }}>
          <BtnGhost onClick={() => setAdminAdding(true)}>+ Seed request</BtnGhost>
        </div>
      )}
      {adminAdding && (
        <div style={{ ...editBox, marginTop: 12 }}>
          <FeatureRequestDraftForm draft={adminAddDraft} setDraft={setAdminAddDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <BtnAccent onClick={adminAdd} disabled={busy}>{busy ? "Saving…" : "Save request"}</BtnAccent>
            <BtnGhost onClick={() => { setAdminAdding(false); setAdminAddDraft(emptyFeatureRequestDraft); }} disabled={busy}>Cancel</BtnGhost>
          </div>
        </div>
      )}

      {/* Member-side: + Submit form (always available, separate from admin pencil) */}
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
            <BtnAccent onClick={memberSubmit} disabled={submitting || !submitTitle.trim()}>
              {submitting ? "Submitting…" : "Submit"}
            </BtnAccent>
            <BtnGhost
              onClick={() => { setSubmitOpen(false); setSubmitTitle(""); setSubmitBody(""); }}
              disabled={submitting}
            >
              Cancel
            </BtnGhost>
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

function byVotes(a: FeatureRequest, b: FeatureRequest): number {
  return b.upvote_count - a.upvote_count;
}

const fieldStyle: React.CSSProperties = {
  width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
  padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
  fontFamily: font, fontSize: 13, outline: "none",
};

const editBox: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: 4, padding: "12px 14px",
};
