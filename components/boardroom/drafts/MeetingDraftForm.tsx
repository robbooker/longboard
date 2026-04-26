"use client";

import React from "react";
import { Field, Input, Textarea, PublishToggle } from "@/components/boardroom/shared";

export type MeetingDraft = {
  meeting_date: string;
  title: string;
  summary: string;
  video_url: string;
  duration_seconds: string;     // string in form, parsed to int on submit
  tags: string;                 // comma-separated input → array on submit
  is_published: boolean;
};

export const emptyMeetingDraft: MeetingDraft = {
  meeting_date: "", title: "", summary: "", video_url: "",
  duration_seconds: "", tags: "", is_published: true,
};

export function meetingRowToDraft(r: {
  meeting_date: string;
  title: string;
  summary: string | null;
  video_url: string | null;
  duration_seconds: number | null;
  tags: string[] | null;
  is_published: boolean;
}): MeetingDraft {
  return {
    meeting_date: r.meeting_date,
    title: r.title,
    summary: r.summary ?? "",
    video_url: r.video_url ?? "",
    duration_seconds: r.duration_seconds == null ? "" : String(r.duration_seconds),
    tags: (r.tags ?? []).join(", "),
    is_published: r.is_published,
  };
}

export function meetingDraftToPayload(d: MeetingDraft): Record<string, unknown> {
  const dur = d.duration_seconds.trim();
  const tags = d.tags.split(",").map((t) => t.trim()).filter(Boolean);
  return {
    title: d.title.trim(),
    meeting_date: d.meeting_date || null,
    summary: d.summary.trim() || null,
    video_url: d.video_url.trim() || null,
    duration_seconds: dur ? Number(dur) : null,
    tags,
    is_published: d.is_published,
  };
}

export default function MeetingDraftForm({
  draft, setDraft,
}: {
  draft: MeetingDraft;
  setDraft: (d: MeetingDraft) => void;
}) {
  const set = <K extends keyof MeetingDraft>(k: K, v: MeetingDraft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Field label="Title">
        <Input value={draft.title} onChange={(v) => set("title", v)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Meeting date">
          <Input type="date" value={draft.meeting_date} onChange={(v) => set("meeting_date", v)} />
        </Field>
        <Field label="Duration (seconds, optional)">
          <Input type="number" value={draft.duration_seconds} onChange={(v) => set("duration_seconds", v)} placeholder="3600" />
        </Field>
      </div>
      <Field label="Summary (optional)">
        <Textarea value={draft.summary} onChange={(v) => set("summary", v)} rows={3} />
      </Field>
      <Field label="Video URL (optional)">
        <Input value={draft.video_url} onChange={(v) => set("video_url", v)} placeholder="https://…" />
      </Field>
      <Field label="Tags (comma-separated)">
        <Input value={draft.tags} onChange={(v) => set("tags", v)} placeholder="strategy, q&a" />
      </Field>
      <PublishToggle value={draft.is_published} onChange={(v) => set("is_published", v)} />
    </div>
  );
}
