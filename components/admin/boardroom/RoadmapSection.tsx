"use client";

import React, { useState } from "react";
import {
  SectionHeader, Card, EmptyHint, Field, Input, Select, PublishToggle, PublishPill,
  BtnRow, BtnAccent, BtnGhost, smallBtn, font,
} from "./shared";

export type RoadmapRow = {
  id: string;
  cohort: string;
  title: string;
  status: string;            // 'shipped' | 'in_flight' | 'next' | 'later'
  sort_order: number;
  is_published: boolean;
};

type Status = "shipped" | "in_flight" | "next" | "later";

type Draft = {
  title: string;
  status: Status;
  is_published: boolean;
};

const emptyDraft: Draft = { title: "", status: "next", is_published: true };

const STATUSES: readonly { value: Status; label: string }[] = [
  { value: "shipped",   label: "Shipped" },
  { value: "in_flight", label: "In Flight" },
  { value: "next",      label: "Next" },
  { value: "later",     label: "Later" },
];

export default function RoadmapSection({
  cohort, initialRows, onError,
}: {
  cohort: string;
  initialRows: RoadmapRow[];
  onError: (msg: string) => void;
}) {
  const [rows, setRows] = useState<RoadmapRow[]>(initialRows);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  function startEdit(r: RoadmapRow) {
    setEditingId(r.id);
    setEditDraft({
      title: r.title,
      status: coerceStatus(r.status),
      is_published: r.is_published,
    });
  }

  function cancelEdit() { setEditingId(null); setEditDraft(emptyDraft); }

  async function add() {
    onError("");
    if (!addDraft.title.trim()) { onError("Title is required"); return; }
    setBusy(true);
    try {
      // New rows go to the bottom: max(sort_order) + 10. Gaps of 10
      // leave room for ↑/↓ swaps without renumbering everything.
      const nextSort = (rows.reduce((m, r) => Math.max(m, r.sort_order), 0) || 0) + 10;
      const res = await fetch("/api/admin/boardroom/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...toPayload(addDraft), sort_order: nextSort }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => [...rs, data as RoadmapRow].sort(bySort));
      setAddDraft(emptyDraft); setAdding(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "add_failed");
    } finally { setBusy(false); }
  }

  async function save(id: string) {
    onError("");
    if (!editDraft.title.trim()) { onError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/roadmap/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(editDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((r) => (r.id === id ? (data as RoadmapRow) : r)).sort(bySort));
      cancelEdit();
    } catch (e) {
      onError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this roadmap item?")) return;
    onError(""); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/roadmap/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : "delete_failed");
    } finally { setBusy(false); }
  }

  // Swap sort_order with the neighbor in `direction`. Two PATCH calls;
  // if either fails the local optimistic reorder reverts.
  async function swap(id: string, direction: "up" | "down") {
    onError("");
    const sorted = [...rows].sort(bySort);
    const idx = sorted.findIndex((r) => r.id === id);
    const neighborIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || neighborIdx < 0 || neighborIdx >= sorted.length) return;

    const a = sorted[idx];
    const b = sorted[neighborIdx];
    const aNew = b.sort_order;
    const bNew = a.sort_order;

    const prev = rows;
    setRows((rs) => rs.map((r) => {
      if (r.id === a.id) return { ...r, sort_order: aNew };
      if (r.id === b.id) return { ...r, sort_order: bNew };
      return r;
    }).sort(bySort));

    setBusy(true);
    try {
      const [resA, resB] = await Promise.all([
        fetch(`/api/admin/boardroom/roadmap/${a.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: aNew }),
        }),
        fetch(`/api/admin/boardroom/roadmap/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: bNew }),
        }),
      ]);
      if (!resA.ok || !resB.ok) {
        setRows(prev);
        throw new Error(`swap failed (HTTP ${resA.status}/${resB.status})`);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "swap_failed");
    } finally { setBusy(false); }
  }

  const sorted = [...rows].sort(bySort);

  return (
    <div>
      <SectionHeader
        title="Roadmap"
        right={`${rows.length} total`}
        action={adding ? null : <BtnAccent onClick={() => setAdding(true)}>+ Add item</BtnAccent>}
      />

      {adding && (
        <Card style={{ marginBottom: 14 }}>
          <DraftForm draft={addDraft} setDraft={setAddDraft} />
          <BtnRow>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save item"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setAddDraft(emptyDraft); }} disabled={busy}>Cancel</BtnGhost>
          </BtnRow>
        </Card>
      )}

      {sorted.length === 0 ? (
        <EmptyHint>No roadmap items yet.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((r, idx) => editingId === r.id ? (
            <Card key={r.id}>
              <DraftForm draft={editDraft} setDraft={setEditDraft} />
              <BtnRow>
                <BtnAccent onClick={() => save(r.id)} disabled={busy}>{busy ? "Saving…" : "Save"}</BtnAccent>
                <BtnGhost onClick={cancelEdit} disabled={busy}>Cancel</BtnGhost>
              </BtnRow>
            </Card>
          ) : (
            <Card key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button
                    onClick={() => swap(r.id, "up")}
                    disabled={busy || idx === 0}
                    aria-label="Move up"
                    style={arrowBtn(busy || idx === 0)}
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => swap(r.id, "down")}
                    disabled={busy || idx === sorted.length - 1}
                    aria-label="Move down"
                    style={arrowBtn(busy || idx === sorted.length - 1)}
                  >
                    ▼
                  </button>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <PublishPill on={r.is_published} />
                    <StatusPill status={r.status} />
                    <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{r.title}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => startEdit(r)} disabled={busy} style={smallBtn("var(--text-secondary)")}>EDIT</button>
                  <button onClick={() => remove(r.id)} disabled={busy} style={smallBtn("var(--danger)")}>DELETE</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function DraftForm({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Field label="Title">
        <Input value={draft.title} onChange={(v) => set("title", v)} />
      </Field>
      <Field label="Status">
        <Select value={draft.status} options={STATUSES} onChange={(v) => set("status", v)} />
      </Field>
      <PublishToggle value={draft.is_published} onChange={(v) => set("is_published", v)} />
    </div>
  );
}

function toPayload(d: Draft): Record<string, unknown> {
  return {
    title: d.title.trim(),
    status: d.status,
    is_published: d.is_published,
  };
}

function bySort(a: RoadmapRow, b: RoadmapRow): number {
  return a.sort_order - b.sort_order;
}

function coerceStatus(s: string): Status {
  return s === "shipped" || s === "in_flight" || s === "later" ? s : "next";
}

function StatusPill({ status }: { status: string }) {
  const color = status === "shipped"   ? "var(--accent)"
              : status === "in_flight" ? "var(--warning)"
              : status === "later"     ? "var(--text-secondary)"
              : "var(--text-primary)";
  const label = status === "in_flight" ? "In Flight"
              : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span style={{
      display: "inline-block", minWidth: 76, textAlign: "center",
      fontSize: 9, padding: "3px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function arrowBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent", border: "1px solid var(--border)",
    color: disabled ? "var(--border)" : "var(--text-secondary)",
    width: 22, height: 18, padding: 0, lineHeight: 1, fontSize: 9,
    borderRadius: 2, cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: font,
  };
}
