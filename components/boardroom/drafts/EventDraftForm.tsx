"use client";

import React from "react";
import { Field, Input, PublishToggle } from "@/components/boardroom/shared";

export type EventDraft = {
  starts_at: string;        // datetime-local string ("YYYY-MM-DDTHH:MM")
  ends_at: string;
  title: string;
  subtitle: string;
  rsvp_url: string;
  is_published: boolean;
};

export const emptyEventDraft: EventDraft = {
  starts_at: "", ends_at: "", title: "", subtitle: "", rsvp_url: "", is_published: true,
};

export function eventRowToDraft(r: {
  starts_at: string;
  ends_at: string | null;
  title: string;
  subtitle: string | null;
  rsvp_url: string | null;
  is_published: boolean;
}): EventDraft {
  return {
    starts_at: toLocalInput(r.starts_at),
    ends_at: toLocalInput(r.ends_at),
    title: r.title,
    subtitle: r.subtitle ?? "",
    rsvp_url: r.rsvp_url ?? "",
    is_published: r.is_published,
  };
}

export function eventDraftToPayload(d: EventDraft): Record<string, unknown> {
  return {
    title: d.title.trim(),
    starts_at: d.starts_at ? new Date(d.starts_at).toISOString() : null,
    ends_at: d.ends_at ? new Date(d.ends_at).toISOString() : null,
    subtitle: d.subtitle.trim() || null,
    rsvp_url: d.rsvp_url.trim() || null,
    is_published: d.is_published,
  };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventDraftForm({
  draft, setDraft,
}: {
  draft: EventDraft;
  setDraft: (d: EventDraft) => void;
}) {
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Field label="Title">
        <Input value={draft.title} onChange={(v) => set("title", v)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Starts">
          <Input type="datetime-local" value={draft.starts_at} onChange={(v) => set("starts_at", v)} />
        </Field>
        <Field label="Ends (optional)">
          <Input type="datetime-local" value={draft.ends_at} onChange={(v) => set("ends_at", v)} />
        </Field>
      </div>
      <Field label="Subtitle (e.g. '10am CT · Zoom')">
        <Input value={draft.subtitle} onChange={(v) => set("subtitle", v)} />
      </Field>
      <Field label="RSVP URL (optional)">
        <Input value={draft.rsvp_url} onChange={(v) => set("rsvp_url", v)} placeholder="https://…" />
      </Field>
      <PublishToggle value={draft.is_published} onChange={(v) => set("is_published", v)} />
    </div>
  );
}
