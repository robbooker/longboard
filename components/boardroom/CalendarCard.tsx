"use client";

import React, { useState } from "react";
import { CardHeader, BtnAccent, BtnGhost, smallBtn, PublishPill } from "@/components/boardroom/shared";
import EventDraftForm, {
  type EventDraft,
  emptyEventDraft,
  eventRowToDraft,
  eventDraftToPayload,
} from "@/components/boardroom/drafts/EventDraftForm";

const font = "var(--font-labels)";

export type CalendarEvent = {
  id: string;
  cohort?: string;
  title: string;
  subtitle: string | null;
  starts_at: string;
  ends_at: string | null;
  rsvp_url: string | null;
  is_published?: boolean;
};

export default function CalendarCard({
  cohort, isAdmin, events,
}: {
  cohort: string;
  isAdmin: boolean;
  events: CalendarEvent[];
}) {
  const [rows, setRows] = useState<CalendarEvent[]>(events);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<EventDraft>(emptyEventDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EventDraft>(emptyEventDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function exitEdit() {
    setEditing(false);
    setAdding(false);
    setEditingId(null);
    setError(null);
  }

  function startRow(r: CalendarEvent) {
    setEditingId(r.id);
    setEditDraft(eventRowToDraft({
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      title: r.title,
      subtitle: r.subtitle,
      rsvp_url: r.rsvp_url,
      is_published: r.is_published ?? true,
    }));
  }

  async function add() {
    setError(null);
    if (!addDraft.title.trim() || !addDraft.starts_at) {
      setError("Title and start time are required"); return;
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
      setRows((rs) => [...rs, data as CalendarEvent].sort(byStart));
      setAddDraft(emptyEventDraft); setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "add_failed");
    } finally { setBusy(false); }
  }

  async function save(id: string) {
    setError(null);
    if (!editDraft.title.trim() || !editDraft.starts_at) {
      setError("Title and start time are required"); return;
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
      setRows((rs) => rs.map((r) => r.id === id ? (data as CalendarEvent) : r).sort(byStart));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this event?")) return;
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/events/${id}`, { method: "DELETE" });
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
        title="Calendar"
        isAdmin={isAdmin}
        editing={editing}
        onToggle={() => editing ? exitEdit() : setEditing(true)}
      />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {rows.length === 0 && !adding ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No upcoming events.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((e) => editing && editingId === e.id ? (
            <div key={e.id} style={editBox}>
              <EventDraftForm draft={editDraft} setDraft={setEditDraft} />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <BtnAccent onClick={() => save(e.id)} disabled={busy}>{busy ? "Saving…" : "Save"}</BtnAccent>
                <BtnGhost onClick={() => setEditingId(null)} disabled={busy}>Cancel</BtnGhost>
              </div>
            </div>
          ) : (
            <EventRow
              key={e.id}
              event={e}
              isAdmin={isAdmin && editing}
              busy={busy}
              onEdit={() => startRow(e)}
              onDelete={() => remove(e.id)}
            />
          ))}
        </div>
      )}

      {isAdmin && editing && !adding && !editingId && (
        <div style={{ marginTop: 12 }}>
          <BtnGhost onClick={() => setAdding(true)}>+ Add event</BtnGhost>
        </div>
      )}

      {adding && (
        <div style={{ ...editBox, marginTop: 12 }}>
          <EventDraftForm draft={addDraft} setDraft={setAddDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save event"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setAddDraft(emptyEventDraft); }} disabled={busy}>Cancel</BtnGhost>
          </div>
        </div>
      )}
    </div>
  );
}

function EventRow({
  event, isAdmin, busy, onEdit, onDelete,
}: {
  event: CalendarEvent;
  isAdmin: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const start = new Date(event.starts_at);
  const month = start.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
  const day = start.toLocaleDateString(undefined, { day: "numeric" });
  const timeLine = fmtTimeRange(event.starts_at, event.ends_at);
  const drafted = event.is_published === false;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <DatePill month={month} day={day} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {drafted && <PublishPill on={false} />}
          <div style={{
            fontSize: 14, color: "var(--text-primary)", fontWeight: 500,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {event.title}
          </div>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
          {timeLine}
        </div>
        {event.subtitle && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
            {event.subtitle}
          </div>
        )}
      </div>
      {isAdmin ? (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onEdit} disabled={busy} style={smallBtn("var(--text-secondary)")}>EDIT</button>
          <button onClick={onDelete} disabled={busy} style={smallBtn("var(--danger)")}>DELETE</button>
        </div>
      ) : event.rsvp_url ? (
        <a
          href={event.rsvp_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 10, color: "var(--accent)", textDecoration: "none",
            border: "1px solid var(--accent)", borderRadius: 3,
            padding: "3px 10px", letterSpacing: 1, textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          RSVP
        </a>
      ) : null}
    </div>
  );
}

function DatePill({ month, day }: { month: string; day: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minWidth: 48, padding: "6px 8px",
      background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 9, color: "var(--accent)", letterSpacing: 1, fontWeight: 700 }}>
        {month}
      </div>
      <div style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 600, lineHeight: 1.1 }}>
        {day}
      </div>
    </div>
  );
}

function byStart(a: CalendarEvent, b: CalendarEvent): number {
  return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
}

/** Format event time(s) in America/Chicago. CT is the canonical event
 *  timezone — Longboard meetings happen on Houston time, so a member
 *  visiting from another timezone should see "what time the call is",
 *  not "what time it is for them right now". Returns one of:
 *    "10:00 AM CT"               (no ends_at)
 *    "10:00 AM – 11:00 AM CT"    (with ends_at)
 *    "" if starts_at is unparseable.
 */
function fmtTimeRange(startsAt: string, endsAt: string | null): string {
  const start = fmtTime(startsAt);
  if (!start) return "";
  const end = endsAt ? fmtTime(endsAt) : null;
  return end ? `${start} – ${end} CT` : `${start} CT`;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

const editBox: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: 4, padding: "12px 14px",
};
