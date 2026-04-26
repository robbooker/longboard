"use client";

import React, { useState } from "react";
import { CardHeader, BtnAccent, BtnGhost, smallBtn, PublishPill } from "@/components/boardroom/shared";
import AnnouncementDraftForm, {
  type AnnouncementDraft,
  emptyAnnouncementDraft,
  announcementRowToDraft,
  announcementDraftToPayload,
} from "@/components/boardroom/drafts/AnnouncementDraftForm";

const font = "var(--font-labels)";

export type Announcement = {
  id: string;
  cohort?: string;
  title: string;
  body: string | null;
  kind: string;
  posted_at: string;
  is_published?: boolean;
};

export default function AnnouncementsCard({
  cohort, isAdmin, items,
}: {
  cohort: string;
  isAdmin: boolean;
  items: Announcement[];
}) {
  const [rows, setRows] = useState<Announcement[]>(items);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<AnnouncementDraft>(emptyAnnouncementDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<AnnouncementDraft>(emptyAnnouncementDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function exitEdit() { setEditing(false); setAdding(false); setEditingId(null); setError(null); }

  function startRow(r: Announcement) {
    setEditingId(r.id);
    setEditDraft(announcementRowToDraft({
      title: r.title,
      body: r.body,
      kind: r.kind,
      is_published: r.is_published ?? true,
    }));
  }

  async function add() {
    setError(null);
    if (!addDraft.title.trim()) { setError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/boardroom/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...announcementDraftToPayload(addDraft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => [data as Announcement, ...rs]);
      setAddDraft(emptyAnnouncementDraft); setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "add_failed");
    } finally { setBusy(false); }
  }

  async function save(id: string) {
    setError(null);
    if (!editDraft.title.trim()) { setError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/announcements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(announcementDraftToPayload(editDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((r) => r.id === id ? (data as Announcement) : r));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/announcements/${id}`, { method: "DELETE" });
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
        title="Announcements"
        isAdmin={isAdmin}
        editing={editing}
        onToggle={() => editing ? exitEdit() : setEditing(true)}
      />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {rows.length === 0 && !adding ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No announcements yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((a) => editing && editingId === a.id ? (
            <div key={a.id} style={editBox}>
              <AnnouncementDraftForm draft={editDraft} setDraft={setEditDraft} />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <BtnAccent onClick={() => save(a.id)} disabled={busy}>{busy ? "Saving…" : "Save"}</BtnAccent>
                <BtnGhost onClick={() => setEditingId(null)} disabled={busy}>Cancel</BtnGhost>
              </div>
            </div>
          ) : (
            <AnnouncementRow
              key={a.id}
              item={a}
              isAdmin={isAdmin && editing}
              busy={busy}
              onEdit={() => startRow(a)}
              onDelete={() => remove(a.id)}
            />
          ))}
        </div>
      )}

      {isAdmin && editing && !adding && !editingId && (
        <div style={{ marginTop: 12 }}>
          <BtnGhost onClick={() => setAdding(true)}>+ Add announcement</BtnGhost>
        </div>
      )}

      {adding && (
        <div style={{ ...editBox, marginTop: 12 }}>
          <AnnouncementDraftForm draft={addDraft} setDraft={setAddDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save announcement"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setAddDraft(emptyAnnouncementDraft); }} disabled={busy}>Cancel</BtnGhost>
          </div>
        </div>
      )}
    </div>
  );
}

function AnnouncementRow({
  item, isAdmin, busy, onEdit, onDelete,
}: {
  item: Announcement;
  isAdmin: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const accentColor = colorFor(item.kind);
  const drafted = item.is_published === false;
  return (
    <div style={{
      display: "flex", gap: 12, paddingLeft: 12,
      borderLeft: `3px solid ${accentColor}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          {drafted && <PublishPill on={false} />}
          <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500 }}>
            {item.title}
          </div>
        </div>
        {item.body && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 4 }}>
            {item.body}
          </div>
        )}
        <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 0.5 }}>
          {fmtTime(item.posted_at)}
        </div>
      </div>
      {isAdmin && (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={onEdit} disabled={busy} style={smallBtn("var(--text-secondary)")}>EDIT</button>
          <button onClick={onDelete} disabled={busy} style={smallBtn("var(--danger)")}>DELETE</button>
        </div>
      )}
    </div>
  );
}

function colorFor(kind: string): string {
  switch (kind) {
    case "success": return "var(--accent)";
    case "warning": return "var(--warning)";
    default:        return "var(--text-secondary)";
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "numeric",
    });
  } catch {
    return iso;
  }
}

const editBox: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: 4, padding: "12px 14px",
};
