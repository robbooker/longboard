"use client";

import React, { useState } from "react";
import { CardHeader, BtnAccent, BtnGhost, smallBtn, PublishPill } from "@/components/boardroom/shared";
import RoadmapDraftForm, {
  type RoadmapDraft,
  emptyRoadmapDraft,
  roadmapRowToDraft,
  roadmapDraftToPayload,
} from "@/components/boardroom/drafts/RoadmapDraftForm";

const font = "var(--font-labels)";

export type RoadmapItem = {
  id: string;
  cohort?: string;
  title: string;
  status: string;
  sort_order: number;
  is_published?: boolean;
};

export default function RoadmapCard({
  cohort, isAdmin, items,
}: {
  cohort: string;
  isAdmin: boolean;
  items: RoadmapItem[];
}) {
  const [rows, setRows] = useState<RoadmapItem[]>(items);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<RoadmapDraft>(emptyRoadmapDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<RoadmapDraft>(emptyRoadmapDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function exitEdit() { setEditing(false); setAdding(false); setEditingId(null); setError(null); }

  function startRow(r: RoadmapItem) {
    setEditingId(r.id);
    setEditDraft(roadmapRowToDraft({
      title: r.title, status: r.status, is_published: r.is_published ?? true,
    }));
  }

  async function add() {
    setError(null);
    if (!addDraft.title.trim()) { setError("Title is required"); return; }
    setBusy(true);
    try {
      const nextSort = (rows.reduce((m, r) => Math.max(m, r.sort_order), 0) || 0) + 10;
      const res = await fetch("/api/admin/boardroom/roadmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, ...roadmapDraftToPayload(addDraft), sort_order: nextSort }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => [...rs, data as RoadmapItem].sort(bySort));
      setAddDraft(emptyRoadmapDraft); setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "add_failed");
    } finally { setBusy(false); }
  }

  async function save(id: string) {
    setError(null);
    if (!editDraft.title.trim()) { setError("Title is required"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/roadmap/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(roadmapDraftToPayload(editDraft)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setRows((rs) => rs.map((r) => r.id === id ? (data as RoadmapItem) : r).sort(bySort));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this roadmap item?")) return;
    setError(null); setBusy(true);
    try {
      const res = await fetch(`/api/admin/boardroom/roadmap/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setRows((rs) => rs.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "delete_failed");
    } finally { setBusy(false); }
  }

  async function swap(id: string, direction: "up" | "down") {
    setError(null);
    const sorted = [...rows].sort(bySort);
    const idx = sorted.findIndex((r) => r.id === id);
    const nIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || nIdx < 0 || nIdx >= sorted.length) return;
    const a = sorted[idx], b = sorted[nIdx];
    const aNew = b.sort_order, bNew = a.sort_order;

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
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: aNew }),
        }),
        fetch(`/api/admin/boardroom/roadmap/${b.id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: bNew }),
        }),
      ]);
      if (!resA.ok || !resB.ok) {
        setRows(prev);
        throw new Error(`swap failed (HTTP ${resA.status}/${resB.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "swap_failed");
    } finally { setBusy(false); }
  }

  const sorted = [...rows].sort(bySort);

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <CardHeader
        title="Roadmap"
        isAdmin={isAdmin}
        editing={editing}
        onToggle={() => editing ? exitEdit() : setEditing(true)}
      />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {sorted.length === 0 && !adding ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No roadmap items yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((r, idx) => editing && editingId === r.id ? (
            <div key={r.id} style={editBox}>
              <RoadmapDraftForm draft={editDraft} setDraft={setEditDraft} />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <BtnAccent onClick={() => save(r.id)} disabled={busy}>{busy ? "Saving…" : "Save"}</BtnAccent>
                <BtnGhost onClick={() => setEditingId(null)} disabled={busy}>Cancel</BtnGhost>
              </div>
            </div>
          ) : (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              paddingBottom: 10, borderBottom: "1px solid var(--border)",
            }}>
              {isAdmin && editing && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button
                    onClick={() => swap(r.id, "up")}
                    disabled={busy || idx === 0}
                    aria-label="Move up"
                    style={arrowBtn(busy || idx === 0)}
                  >▲</button>
                  <button
                    onClick={() => swap(r.id, "down")}
                    disabled={busy || idx === sorted.length - 1}
                    aria-label="Move down"
                    style={arrowBtn(busy || idx === sorted.length - 1)}
                  >▼</button>
                </div>
              )}
              {r.is_published === false && <PublishPill on={false} />}
              <StatusPill status={r.status} />
              <span style={{ fontSize: 13, color: "var(--text-primary)", flex: 1 }}>
                {r.title}
              </span>
              {isAdmin && editing && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => startRow(r)} disabled={busy} style={smallBtn("var(--text-secondary)")}>EDIT</button>
                  <button onClick={() => remove(r.id)} disabled={busy} style={smallBtn("var(--danger)")}>DELETE</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && editing && !adding && !editingId && (
        <div style={{ marginTop: 12 }}>
          <BtnGhost onClick={() => setAdding(true)}>+ Add item</BtnGhost>
        </div>
      )}

      {adding && (
        <div style={{ ...editBox, marginTop: 12 }}>
          <RoadmapDraftForm draft={addDraft} setDraft={setAddDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <BtnAccent onClick={add} disabled={busy}>{busy ? "Saving…" : "Save item"}</BtnAccent>
            <BtnGhost onClick={() => { setAdding(false); setAddDraft(emptyRoadmapDraft); }} disabled={busy}>Cancel</BtnGhost>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { label, color } = describe(status);
  return (
    <span style={{
      display: "inline-block", minWidth: 76, textAlign: "center",
      fontSize: 9, padding: "3px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1,
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function describe(status: string): { label: string; color: string } {
  switch (status) {
    case "shipped":   return { label: "Shipped",   color: "var(--accent)" };
    case "in_flight": return { label: "In Flight", color: "var(--warning)" };
    case "next":      return { label: "Next",      color: "var(--text-primary)" };
    case "later":     return { label: "Later",     color: "var(--text-secondary)" };
    default:          return { label: status,      color: "var(--text-secondary)" };
  }
}

function bySort(a: RoadmapItem, b: RoadmapItem): number {
  return a.sort_order - b.sort_order;
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

const editBox: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--border)",
  borderRadius: 4, padding: "12px 14px",
};
