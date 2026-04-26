"use client";

import React, { useState } from "react";
import {
  SectionHeader, Card, EmptyHint, PublishPill,
  RowActions, BtnRow, BtnAccent, BtnGhost,
} from "@/components/boardroom/shared";
import AnnouncementDraftForm, {
  type AnnouncementDraft,
  emptyAnnouncementDraft,
  announcementRowToDraft,
  announcementDraftToPayload,
} from "@/components/boardroom/drafts/AnnouncementDraftForm";

export type AnnouncementRow = {
  id: string;
  cohort: string;
  title: string;
  body: string | null;
  kind: string;             // 'info' | 'success' | 'warning'
  posted_at: string;
  is_published: boolean;
};

type Draft = AnnouncementDraft;
const emptyDraft = emptyAnnouncementDraft;

export default function AnnouncementsSection({
  cohort, initialRows, onError,
}: {
  cohort: string;
  initialRows: AnnouncementRow[];
  onError: (msg: string) => void;
}) {
  const [rows, setRows] = useState<AnnouncementRow[]>(initialRows);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  function startEdit(r: AnnouncementRow) {
    setEditingId(r.id);
    setEditDraft(announcementRowToDraft(r));
  }

  function cancelEdit() { setEditingId(null); setEditDraft(emptyDraft); }

  async function add() {
    onError("");
    if (!addDraft.title.trim()) { onError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/boardroom/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...announcementDraftToPayload(addDraft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => [data as AnnouncementRow, ...rs]);
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
      const res = await fetch(`/api/admin/boardroom/announcements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(announcementDraftToPayload(editDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((r) => (r.id === id ? (data as AnnouncementRow) : r)));
      cancelEdit();
    } catch (e) {
      onError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    onError(""); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/announcements/${id}`, { method: "DELETE" });
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
        title="Announcements"
        right={`${rows.length} total`}
        action={adding ? null : <BtnAccent onClick={() => setAdding(true)}>+ Add announcement</BtnAccent>}
      />

      {adding && (
        <Card style={{ marginBottom: 14 }}>
          <AnnouncementDraftForm draft={addDraft} setDraft={setAddDraft} />
          <BtnRow>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save announcement"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setAddDraft(emptyDraft); }} disabled={busy}>Cancel</BtnGhost>
          </BtnRow>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyHint>No announcements yet.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => editingId === r.id ? (
            <Card key={r.id}>
              <AnnouncementDraftForm draft={editDraft} setDraft={setEditDraft} />
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
                    <KindPill kind={r.kind} />
                    <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{r.title}</div>
                  </div>
                  {r.body && (
                    <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 4 }}>
                      {r.body}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                    {fmtTime(r.posted_at)}
                  </div>
                </div>
                <RowActions onEdit={() => startEdit(r)} onDelete={() => remove(r.id)} disabled={busy} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function KindPill({ kind }: { kind: string }) {
  const color = kind === "success" ? "var(--accent)"
              : kind === "warning" ? "var(--warning)"
              : "var(--text-secondary)";
  return (
    <span style={{
      fontSize: 9, padding: "2px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600,
    }}>
      {kind}
    </span>
  );
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}
