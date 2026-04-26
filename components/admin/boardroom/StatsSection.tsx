"use client";

import React, { useState } from "react";
import { SectionHeader, Card, Field, Input, BtnAccent } from "./shared";

export type StatsRow = {
  cohort: string;
  total_sales_display: string;
  total_sales_subtext: string | null;
  collected_display: string;
  collected_subtext: string | null;
  members_display: string;
  members_subtext: string | null;
  new_leads_display: string;
  new_leads_subtext: string | null;
  updated_by: string | null;
  updated_at: string;
};

type Draft = {
  total_sales_display: string;
  total_sales_subtext: string;
  collected_display: string;
  collected_subtext: string;
  members_display: string;
  members_subtext: string;
  new_leads_display: string;
  new_leads_subtext: string;
};

function rowToDraft(r: StatsRow | null): Draft {
  return {
    total_sales_display: r?.total_sales_display ?? "$0",
    total_sales_subtext: r?.total_sales_subtext ?? "",
    collected_display:   r?.collected_display ?? "$0",
    collected_subtext:   r?.collected_subtext ?? "",
    members_display:     r?.members_display ?? "0 / 0",
    members_subtext:     r?.members_subtext ?? "",
    new_leads_display:   r?.new_leads_display ?? "0",
    new_leads_subtext:   r?.new_leads_subtext ?? "",
  };
}

export default function StatsSection({
  cohort, initialRow, onError,
}: {
  cohort: string;
  initialRow: StatsRow | null;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(rowToDraft(initialRow));
  const [savedDraft, setSavedDraft] = useState<Draft>(rowToDraft(initialRow));
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft);

  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft({ ...draft, [k]: v }); }

  async function save() {
    onError(""); setSaving(true);
    try {
      const payload = {
        cohort,
        total_sales_display: draft.total_sales_display,
        total_sales_subtext: draft.total_sales_subtext.trim() || null,
        collected_display:   draft.collected_display,
        collected_subtext:   draft.collected_subtext.trim() || null,
        members_display:     draft.members_display,
        members_subtext:     draft.members_subtext.trim() || null,
        new_leads_display:   draft.new_leads_display,
        new_leads_subtext:   draft.new_leads_subtext.trim() || null,
      };
      const res = await fetch("/api/admin/boardroom/stats", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setSavedDraft(rowToDraft(data as StatsRow));
    } catch (e) {
      onError(e instanceof Error ? e.message : "save_failed");
    } finally { setSaving(false); }
  }

  return (
    <div>
      <SectionHeader
        title="Stats & Revenue"
        right={initialRow ? "Singleton · text-formatted" : "Not yet seeded"}
      />
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Pair
            displayLabel="Total Sales — display" displayValue={draft.total_sales_display} onDisplay={(v) => set("total_sales_display", v)}
            subtextLabel="Total Sales — subtext" subtextValue={draft.total_sales_subtext} onSubtext={(v) => set("total_sales_subtext", v)}
            placeholderDisplay="$0" placeholderSubtext="Cohort 1 · full"
          />
          <Pair
            displayLabel="Collected — display" displayValue={draft.collected_display} onDisplay={(v) => set("collected_display", v)}
            subtextLabel="Collected — subtext" subtextValue={draft.collected_subtext} onSubtext={(v) => set("collected_subtext", v)}
            placeholderDisplay="$0" placeholderSubtext="+$396K this week"
          />
          <Pair
            displayLabel="Members — display" displayValue={draft.members_display} onDisplay={(v) => set("members_display", v)}
            subtextLabel="Members — subtext" subtextValue={draft.members_subtext} onSubtext={(v) => set("members_subtext", v)}
            placeholderDisplay="200 / 200" placeholderSubtext="Cohort 1 full"
          />
          <Pair
            displayLabel="New Leads Today — display" displayValue={draft.new_leads_display} onDisplay={(v) => set("new_leads_display", v)}
            subtextLabel="New Leads Today — subtext" subtextValue={draft.new_leads_subtext} onSubtext={(v) => set("new_leads_subtext", v)}
            placeholderDisplay="0" placeholderSubtext="vs. 12 yesterday"
          />
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14,
        }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            {dirty ? "Unsaved changes" : initialRow ? "Saved" : "Not yet seeded"}
          </div>
          <BtnAccent onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save stats"}
          </BtnAccent>
        </div>
      </Card>
    </div>
  );
}

function Pair({
  displayLabel, displayValue, onDisplay, placeholderDisplay,
  subtextLabel, subtextValue, onSubtext, placeholderSubtext,
}: {
  displayLabel: string; displayValue: string; onDisplay: (v: string) => void; placeholderDisplay: string;
  subtextLabel: string; subtextValue: string; onSubtext: (v: string) => void; placeholderSubtext: string;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Field label={displayLabel}>
        <Input value={displayValue} onChange={onDisplay} placeholder={placeholderDisplay} />
      </Field>
      <Field label={subtextLabel}>
        <Input value={subtextValue} onChange={onSubtext} placeholder={placeholderSubtext} />
      </Field>
    </div>
  );
}
