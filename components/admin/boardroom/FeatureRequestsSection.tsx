"use client";

import React, { useState } from "react";
import {
  SectionHeader, Card, EmptyHint, PublishPill,
  RowActions, BtnRow, BtnAccent, BtnGhost,
} from "@/components/boardroom/shared";
import FeatureRequestDraftForm, {
  type FeatureRequestDraft,
  emptyFeatureRequestDraft,
  featureRequestRowToDraft,
  featureRequestDraftToPayload,
} from "@/components/boardroom/drafts/FeatureRequestDraftForm";

export type FeatureRequestRow = {
  id: string;
  cohort: string;
  title: string;
  body: string | null;
  upvote_count: number;
  submitted_by: string | null;
  is_published: boolean;
  created_at: string;
};

type Draft = FeatureRequestDraft;
const emptyDraft = emptyFeatureRequestDraft;

export default function FeatureRequestsSection({
  cohort, initialRows, onError,
}: {
  cohort: string;
  initialRows: FeatureRequestRow[];
  onError: (msg: string) => void;
}) {
  const [rows, setRows] = useState<FeatureRequestRow[]>(initialRows);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  function startEdit(r: FeatureRequestRow) {
    setEditingId(r.id);
    setEditDraft(featureRequestRowToDraft(r));
  }

  function cancelEdit() { setEditingId(null); setEditDraft(emptyDraft); }

  async function add() {
    onError("");
    if (!addDraft.title.trim()) { onError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/boardroom/feature-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...featureRequestDraftToPayload(addDraft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => [data as FeatureRequestRow, ...rs].sort(byVotes));
      setAddDraft(emptyDraft); setAdding(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "add_failed");
    } finally { setBusy(false); }
  }

  async function save(id: string) {
    onError("");
    if (!editDraft.title.trim()) { onError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/feature-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(featureRequestDraftToPayload(editDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((r) => (r.id === id ? (data as FeatureRequestRow) : r)).sort(byVotes));
      cancelEdit();
    } catch (e) {
      onError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function togglePublish(r: FeatureRequestRow) {
    onError(""); setBusy(true);
    const next = !r.is_published;
    try {
      const res = await fetch(`/api/admin/boardroom/feature-requests/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((x) => (x.id === r.id ? (data as FeatureRequestRow) : x)));
    } catch (e) {
      onError(e instanceof Error ? e.message : "toggle_failed");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this feature request?")) return;
    onError(""); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/feature-requests/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "delete_failed");
    } finally { setBusy(false); }
  }

  return (
    <div>
      <SectionHeader
        title="Feature Requests"
        right={`${rows.length} total · admin moderates publish`}
        action={adding ? null : <BtnAccent onClick={() => setAdding(true)}>+ Seed request</BtnAccent>}
      />

      {adding && (
        <Card style={{ marginBottom: 14 }}>
          <FeatureRequestDraftForm draft={addDraft} setDraft={setAddDraft} />
          <BtnRow>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save request"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setAddDraft(emptyDraft); }} disabled={busy}>Cancel</BtnGhost>
          </BtnRow>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyHint>No feature requests yet.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => editingId === r.id ? (
            <Card key={r.id}>
              <FeatureRequestDraftForm draft={editDraft} setDraft={setEditDraft} />
              <BtnRow>
                <BtnAccent onClick={() => save(r.id)} disabled={busy}>{busy ? "Saving…" : "Save"}</BtnAccent>
                <BtnGhost onClick={cancelEdit} disabled={busy}>Cancel</BtnGhost>
              </BtnRow>
            </Card>
          ) : (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <PublishPill on={r.is_published} />
                    <span style={{
                      fontSize: 11, color: "var(--accent)", letterSpacing: 0.5,
                      border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 3,
                    }}>
                      ▲ {r.upvote_count}
                    </span>
                    <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{r.title}</div>
                  </div>
                  {r.body && (
                    <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5 }}>
                      {r.body}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => togglePublish(r)}
                    disabled={busy}
                    style={{
                      background: "transparent",
                      border: `1px solid ${r.is_published ? "var(--warning)" : "var(--accent)"}`,
                      color: r.is_published ? "var(--warning)" : "var(--accent)",
                      padding: "4px 10px", borderRadius: 3, fontFamily: "var(--font-labels)", fontSize: 10,
                      fontWeight: 700, letterSpacing: 1, cursor: busy ? "wait" : "pointer",
                    }}
                  >
                    {r.is_published ? "UNPUBLISH" : "PUBLISH"}
                  </button>
                  <RowActions onEdit={() => startEdit(r)} onDelete={() => remove(r.id)} disabled={busy} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function byVotes(a: FeatureRequestRow, b: FeatureRequestRow): number {
  return b.upvote_count - a.upvote_count;
}
