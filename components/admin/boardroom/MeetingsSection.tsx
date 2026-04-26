"use client";

import React, { useState } from "react";
import {
  SectionHeader, Card, EmptyHint, PublishPill,
  RowActions, BtnRow, BtnAccent, BtnGhost,
} from "@/components/boardroom/shared";
import MeetingDraftForm, {
  type MeetingDraft,
  emptyMeetingDraft,
  meetingRowToDraft,
  meetingDraftToPayload,
} from "@/components/boardroom/drafts/MeetingDraftForm";

export type MeetingRow = {
  id: string;
  cohort: string;
  meeting_date: string;
  title: string;
  summary: string | null;
  video_url: string | null;
  duration_seconds: number | null;
  tags: string[] | null;
  is_published: boolean;
  created_at: string;
};

type Draft = MeetingDraft;
const emptyDraft = emptyMeetingDraft;

export default function MeetingsSection({
  cohort, initialRows, onError,
}: {
  cohort: string;
  initialRows: MeetingRow[];
  onError: (msg: string) => void;
}) {
  const [rows, setRows] = useState<MeetingRow[]>(initialRows);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  function startEdit(r: MeetingRow) {
    setEditingId(r.id);
    setEditDraft(meetingRowToDraft(r));
  }

  function cancelEdit() { setEditingId(null); setEditDraft(emptyDraft); }

  async function add() {
    onError("");
    if (!addDraft.title.trim() || !addDraft.meeting_date) {
      onError("Title and meeting_date are required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/boardroom/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...meetingDraftToPayload(addDraft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => [data as MeetingRow, ...rs]);
      setAddDraft(emptyDraft); setAdding(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "add_failed");
    } finally { setBusy(false); }
  }

  async function save(id: string) {
    onError("");
    if (!editDraft.title.trim() || !editDraft.meeting_date) {
      onError("Title and meeting_date are required"); return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/meetings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meetingDraftToPayload(editDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((r) => (r.id === id ? (data as MeetingRow) : r)));
      cancelEdit();
    } catch (e) {
      onError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this meeting?")) return;
    onError(""); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/meetings/${id}`, { method: "DELETE" });
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
        title="Meetings"
        right={`${rows.length} total`}
        action={adding ? null : <BtnAccent onClick={() => setAdding(true)}>+ Add meeting</BtnAccent>}
      />

      {adding && (
        <Card style={{ marginBottom: 14 }}>
          <MeetingDraftForm draft={addDraft} setDraft={setAddDraft} />
          <BtnRow>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save meeting"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setAddDraft(emptyDraft); }} disabled={busy}>Cancel</BtnGhost>
          </BtnRow>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyHint>No meetings yet.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => editingId === r.id ? (
            <Card key={r.id}>
              <MeetingDraftForm draft={editDraft} setDraft={setEditDraft} />
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
                    <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{r.title}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {fmtDate(r.meeting_date)}
                    {r.duration_seconds ? ` · ${Math.round(r.duration_seconds / 60)} min` : ""}
                    {r.tags && r.tags.length > 0 ? ` · ${r.tags.join(", ")}` : ""}
                  </div>
                  {r.summary && (
                    <div style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 6, lineHeight: 1.5 }}>
                      {r.summary}
                    </div>
                  )}
                  {r.video_url && (
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      <a href={r.video_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                        {r.video_url}
                      </a>
                    </div>
                  )}
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

function fmtDate(d: string): string {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return d; }
}
