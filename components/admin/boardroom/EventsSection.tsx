"use client";

import React, { useState } from "react";
import {
  SectionHeader, Card, EmptyHint, PublishPill,
  RowActions, BtnRow, BtnAccent, BtnGhost,
} from "@/components/boardroom/shared";
import EventDraftForm, {
  type EventDraft,
  emptyEventDraft,
  eventRowToDraft,
  eventDraftToPayload,
} from "@/components/boardroom/drafts/EventDraftForm";

export type EventRow = {
  id: string;
  cohort: string;
  starts_at: string;
  ends_at: string | null;
  title: string;
  subtitle: string | null;
  rsvp_url: string | null;
  is_published: boolean;
  created_at: string;
};

type Draft = EventDraft;
const emptyDraft = emptyEventDraft;

export default function EventsSection({
  cohort, initialRows, onError,
}: {
  cohort: string;
  initialRows: EventRow[];
  onError: (msg: string) => void;
}) {
  const [rows, setRows] = useState<EventRow[]>(initialRows);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  function startEdit(r: EventRow) {
    setEditingId(r.id);
    setEditDraft(eventRowToDraft(r));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(emptyDraft);
  }

  async function add() {
    onError("");
    if (!addDraft.title.trim() || !addDraft.starts_at) {
      onError("Title and starts_at are required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/boardroom/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...eventDraftToPayload(addDraft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => [data as EventRow, ...rs]);
      setAddDraft(emptyDraft);
      setAdding(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "add_failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(id: string) {
    onError("");
    if (!editDraft.title.trim() || !editDraft.starts_at) {
      onError("Title and starts_at are required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eventDraftToPayload(editDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((r) => (r.id === id ? (data as EventRow) : r)));
      cancelEdit();
    } catch (e) {
      onError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this event?")) return;
    onError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/events/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Calendar Events"
        right={`${rows.length} total`}
        action={adding ? null : <BtnAccent onClick={() => setAdding(true)}>+ Add event</BtnAccent>}
      />

      {adding && (
        <Card style={{ marginBottom: 14 }}>
          <EventDraftForm draft={addDraft} setDraft={setAddDraft} />
          <BtnRow>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save event"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setAddDraft(emptyDraft); }} disabled={busy}>
              Cancel
            </BtnGhost>
          </BtnRow>
        </Card>
      )}

      {rows.length === 0 ? (
        <EmptyHint>No events yet.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => editingId === r.id ? (
            <Card key={r.id}>
              <EventDraftForm draft={editDraft} setDraft={setEditDraft} />
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
                    {fmtRange(r.starts_at, r.ends_at)}{r.subtitle ? ` · ${r.subtitle}` : ""}
                  </div>
                  {r.rsvp_url && (
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      <a href={r.rsvp_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                        {r.rsvp_url}
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

function fmtRange(starts: string, ends: string | null): string {
  const s = new Date(starts);
  const startStr = s.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  if (!ends) return startStr;
  const e = new Date(ends);
  const endStr = e.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${startStr} → ${endStr}`;
}
