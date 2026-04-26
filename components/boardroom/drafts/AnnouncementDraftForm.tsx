"use client";

import React from "react";
import { Field, Input, Textarea, Select, PublishToggle } from "@/components/boardroom/shared";

export type AnnouncementKind = "info" | "success" | "warning";

export type AnnouncementDraft = {
  title: string;
  body: string;
  kind: AnnouncementKind;
  is_published: boolean;
};

export const emptyAnnouncementDraft: AnnouncementDraft = {
  title: "", body: "", kind: "info", is_published: true,
};

export const ANNOUNCEMENT_KINDS: readonly { value: AnnouncementKind; label: string }[] = [
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
];

export function announcementRowToDraft(r: {
  title: string;
  body: string | null;
  kind: string;
  is_published: boolean;
}): AnnouncementDraft {
  return {
    title: r.title,
    body: r.body ?? "",
    kind: (r.kind === "success" || r.kind === "warning") ? r.kind : "info",
    is_published: r.is_published,
  };
}

export function announcementDraftToPayload(d: AnnouncementDraft): Record<string, unknown> {
  return {
    title: d.title.trim(),
    body: d.body.trim() || null,
    kind: d.kind,
    is_published: d.is_published,
  };
}

export default function AnnouncementDraftForm({
  draft, setDraft,
}: {
  draft: AnnouncementDraft;
  setDraft: (d: AnnouncementDraft) => void;
}) {
  const set = <K extends keyof AnnouncementDraft>(k: K, v: AnnouncementDraft[K]) =>
    setDraft({ ...draft, [k]: v });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Field label="Title">
        <Input value={draft.title} onChange={(v) => set("title", v)} />
      </Field>
      <Field label="Body (optional)">
        <Textarea value={draft.body} onChange={(v) => set("body", v)} rows={3} />
      </Field>
      <Field label="Kind">
        <Select value={draft.kind} options={ANNOUNCEMENT_KINDS} onChange={(v) => set("kind", v)} />
      </Field>
      <PublishToggle value={draft.is_published} onChange={(v) => set("is_published", v)} />
    </div>
  );
}
