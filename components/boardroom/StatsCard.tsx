"use client";

import React, { useState } from "react";
import { CardHeader, BtnAccent, BtnGhost, Field, Input } from "@/components/boardroom/shared";

const font = "var(--font-labels)";

export type BoardroomStats = {
  total_sales_display: string;
  total_sales_subtext: string | null;
  collected_display: string;
  collected_subtext: string | null;
  members_display: string;
  members_subtext: string | null;
  new_leads_display: string;
  new_leads_subtext: string | null;
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

function statsToDraft(s: BoardroomStats | null): Draft {
  return {
    total_sales_display: s?.total_sales_display ?? "$0",
    total_sales_subtext: s?.total_sales_subtext ?? "",
    collected_display:   s?.collected_display ?? "$0",
    collected_subtext:   s?.collected_subtext ?? "",
    members_display:     s?.members_display ?? "0 / 0",
    members_subtext:     s?.members_subtext ?? "",
    new_leads_display:   s?.new_leads_display ?? "0",
    new_leads_subtext:   s?.new_leads_subtext ?? "",
  };
}

export default function StatsCard({
  cohort, isAdmin, stats,
}: {
  cohort: string;
  isAdmin: boolean;
  stats: BoardroomStats | null;
}) {
  const [savedStats, setSavedStats] = useState<BoardroomStats | null>(stats);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(statsToDraft(stats));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft({ ...draft, [k]: v }); }

  function startEdit() {
    setError(null);
    setDraft(statsToDraft(savedStats));
    setEditing(true);
  }

  async function save() {
    setError(null); setBusy(true);
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
      setSavedStats(data as BoardroomStats);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  // Empty-state fallback so the card never renders blank.
  const display: BoardroomStats = savedStats ?? statsToDraft(null);

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <CardHeader
        title="Stats & Revenue"
        isAdmin={isAdmin}
        editing={editing}
        onToggle={() => editing ? setEditing(false) : startEdit()}
      />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {editing ? (
        <>
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
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <BtnAccent onClick={save} disabled={busy}>{busy ? "Saving…" : "Save stats"}</BtnAccent>
            <BtnGhost onClick={() => { setEditing(false); setError(null); }} disabled={busy}>Cancel</BtnGhost>
          </div>
        </>
      ) : (
        <div className="boardroom-stats-grid" style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
        }}>
          <Metric label="Total Sales"     value={display.total_sales_display} subtext={display.total_sales_subtext} />
          <Metric label="Collected"        value={display.collected_display}    subtext={display.collected_subtext} />
          <Metric label="Members"          value={display.members_display}      subtext={display.members_subtext} />
          <Metric label="New Leads Today"  value={display.new_leads_display}    subtext={display.new_leads_subtext} />
        </div>
      )}

      <style>{`
        @media (max-width: 720px) {
          .boardroom-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

function Metric({ label, value, subtext }: { label: string; value: string; subtext: string | null }) {
  return (
    <div style={{
      background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4,
      padding: "14px 16px",
    }}>
      <div style={{
        fontSize: 9, color: "var(--text-secondary)", letterSpacing: 1.5,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22, color: "var(--text-primary)", fontWeight: 600,
        letterSpacing: 0.5, lineHeight: 1.1,
      }}>
        {value}
      </div>
      {subtext && (
        <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 6, letterSpacing: 0.3 }}>
          {subtext}
        </div>
      )}
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
