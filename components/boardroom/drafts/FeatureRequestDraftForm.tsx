"use client";

import React from "react";
import { Field, Input, Textarea, PublishToggle } from "@/components/boardroom/shared";

export type FeatureRequestDraft = {
  title: string;
  body: string;
  is_published: boolean;
};

export const emptyFeatureRequestDraft: FeatureRequestDraft = {
  title: "", body: "", is_published: true,
};

export function featureRequestRowToDraft(r: {
  title: string;
  body: string | null;
  is_published: boolean;
}): FeatureRequestDraft {
  return {
    title: r.title,
    body: r.body ?? "",
    is_published: r.is_published,
  };
}

export function featureRequestDraftToPayload(d: FeatureRequestDraft): Record<string, unknown> {
  return {
    title: d.title.trim(),
    body: d.body.trim() || null,
    is_published: d.is_published,
  };
}

export default function FeatureRequestDraftForm({
  draft, setDraft,
}: {
  draft: FeatureRequestDraft;
  setDraft: (d: FeatureRequestDraft) => void;
}) {
  const set = <K extends keyof FeatureRequestDraft>(k: K, v: FeatureRequestDraft[K]) =>
    setDraft({ ...draft, [k]: v });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Field label="Title">
        <Input value={draft.title} onChange={(v) => set("title", v)} />
      </Field>
      <Field label="Body (optional)">
        <Textarea value={draft.body} onChange={(v) => set("body", v)} rows={3} />
      </Field>
      <PublishToggle value={draft.is_published} onChange={(v) => set("is_published", v)} />
    </div>
  );
}
