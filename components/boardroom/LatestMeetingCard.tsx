"use client";

import React, { useState } from "react";
import { CardHeader, BtnAccent, BtnGhost, smallBtn, PublishPill } from "@/components/boardroom/shared";
import MeetingDraftForm, {
  type MeetingDraft,
  emptyMeetingDraft,
  meetingRowToDraft,
  meetingDraftToPayload,
} from "@/components/boardroom/drafts/MeetingDraftForm";

const font = "var(--font-labels)";

export type Meeting = {
  id: string;
  cohort?: string;
  title: string;
  summary: string | null;
  video_url: string | null;
  duration_seconds: number | null;
  tags: string[] | null;
  meeting_date: string;
  is_published?: boolean;
};

export default function LatestMeetingCard({
  cohort, isAdmin, meeting,
}: {
  cohort: string;
  isAdmin: boolean;
  meeting: Meeting | null;
}) {
  const [row, setRow] = useState<Meeting | null>(meeting);
  const [editing, setEditing] = useState(false);
  const [editingRow, setEditingRow] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<MeetingDraft>(emptyMeetingDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function exitEdit() { setEditing(false); setEditingRow(false); setAdding(false); setError(null); }

  function startRow() {
    if (!row) return;
    setEditingRow(true);
    setDraft(meetingRowToDraft({
      meeting_date: row.meeting_date,
      title: row.title,
      summary: row.summary,
      video_url: row.video_url,
      duration_seconds: row.duration_seconds,
      tags: row.tags,
      is_published: row.is_published ?? true,
    }));
  }

  async function add() {
    setError(null);
    if (!draft.title.trim() || !draft.meeting_date) {
      setError("Title and meeting date are required"); return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/boardroom/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...meetingDraftToPayload(draft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      // The new meeting becomes the visible "latest" if its date is
      // newer (or there's no current meeting). Server-side rendering on
      // next refresh will canonicalize anyway.
      setRow(data as Meeting);
      setDraft(emptyMeetingDraft); setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "add_failed");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!row) return;
    setError(null);
    if (!draft.title.trim() || !draft.meeting_date) {
      setError("Title and meeting date are required"); return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/meetings/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meetingDraftToPayload(draft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRow(data as Meeting);
      setEditingRow(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!row) return;
    if (!confirm("Delete this meeting? The previous meeting will become the visible latest after refresh.")) return;
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/meetings/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      // Empty state until next page load reveals the previous meeting.
      setRow(null);
      setEditingRow(false);
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
        title="Latest Meeting"
        isAdmin={isAdmin}
        editing={editing}
        onToggle={() => editing ? exitEdit() : setEditing(true)}
      />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {editingRow && row ? (
        <div style={editBox}>
          <MeetingDraftForm draft={draft} setDraft={setDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <BtnAccent onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</BtnAccent>
            <BtnGhost onClick={() => setEditingRow(false)} disabled={busy}>Cancel</BtnGhost>
          </div>
        </div>
      ) : adding ? (
        <div style={editBox}>
          <MeetingDraftForm draft={draft} setDraft={setDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save meeting"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setDraft(emptyMeetingDraft); }} disabled={busy}>Cancel</BtnGhost>
          </div>
        </div>
      ) : !row ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No meetings posted yet.
        </div>
      ) : (
        <>
          <VideoPlaceholder videoUrl={row.video_url} />
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              {row.is_published === false && <PublishPill on={false} />}
              <div style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 500 }}>
                {row.title}
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: row.summary ? 8 : 0 }}>
              {fmtDate(row.meeting_date)}
              {row.duration_seconds ? ` · ${fmtDuration(row.duration_seconds)}` : ""}
            </div>
            {row.summary && (
              <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.55, marginBottom: 8 }}>
                {row.summary}
              </div>
            )}
            {row.tags && row.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {row.tags.map((t) => (
                  <span key={t} style={{
                    fontSize: 10, padding: "2px 8px", border: "1px solid var(--border)",
                    color: "var(--text-secondary)", borderRadius: 10, letterSpacing: 0.5,
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {isAdmin && editing && !editingRow && !adding && (
        <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
          {row && (
            <>
              <button onClick={startRow} disabled={busy} style={smallBtn("var(--text-secondary)")}>EDIT</button>
              <button onClick={remove} disabled={busy} style={smallBtn("var(--danger)")}>DELETE</button>
            </>
          )}
          <button
            onClick={() => { setDraft(emptyMeetingDraft); setAdding(true); }}
            disabled={busy}
            style={smallBtn("var(--accent)")}
          >
            + ADD NEW
          </button>
        </div>
      )}
    </div>
  );
}

function VideoPlaceholder({ videoUrl }: { videoUrl: string | null }) {
  return (
    <div style={{
      position: "relative", width: "100%", paddingBottom: "56.25%",
      background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: 4, overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        {videoUrl ? (
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 56, height: 56, borderRadius: "50%",
              background: "var(--accent)", color: "var(--bg)",
              fontSize: 22, textDecoration: "none",
            }}
          >
            ▶
          </a>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: "50%",
            background: "var(--surface)", border: "2px solid var(--border)",
            color: "var(--text-secondary)", fontSize: 22,
          }}>
            ▶
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDate(d: string): string {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return d;
  }
}

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

const editBox: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: 4, padding: "12px 14px",
};
