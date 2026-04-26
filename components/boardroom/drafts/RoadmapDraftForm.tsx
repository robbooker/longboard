"use client";

import React from "react";
import { Field, Input, Select, PublishToggle } from "@/components/boardroom/shared";

export type RoadmapStatus = "shipped" | "in_flight" | "next" | "later";

export type RoadmapDraft = {
  title: string;
  status: RoadmapStatus;
  is_published: boolean;
};

export const emptyRoadmapDraft: RoadmapDraft = {
  title: "", status: "next", is_published: true,
};

export const ROADMAP_STATUSES: readonly { value: RoadmapStatus; label: string }[] = [
  { value: "shipped",   label: "Shipped" },
  { value: "in_flight", label: "In Flight" },
  { value: "next",      label: "Next" },
  { value: "later",     label: "Later" },
];

export function coerceRoadmapStatus(s: string): RoadmapStatus {
  return s === "shipped" || s === "in_flight" || s === "later" ? s : "next";
}

export function roadmapRowToDraft(r: {
  title: string;
  status: string;
  is_published: boolean;
}): RoadmapDraft {
  return {
    title: r.title,
    status: coerceRoadmapStatus(r.status),
    is_published: r.is_published,
  };
}

export function roadmapDraftToPayload(d: RoadmapDraft): Record<string, unknown> {
  return {
    title: d.title.trim(),
    status: d.status,
    is_published: d.is_published,
  };
}

export default function RoadmapDraftForm({
  draft, setDraft,
}: {
  draft: RoadmapDraft;
  setDraft: (d: RoadmapDraft) => void;
}) {
  const set = <K extends keyof RoadmapDraft>(k: K, v: RoadmapDraft[K]) =>
    setDraft({ ...draft, [k]: v });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Field label="Title">
        <Input value={draft.title} onChange={(v) => set("title", v)} />
      </Field>
      <Field label="Status">
        <Select value={draft.status} options={ROADMAP_STATUSES} onChange={(v) => set("status", v)} />
      </Field>
      <PublishToggle value={draft.is_published} onChange={(v) => set("is_published", v)} />
    </div>
  );
}
