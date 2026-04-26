"use client";

import React, { useState } from "react";

const font = "var(--font-labels)";

export type BoardroomTask = {
  id: string;
  title: string;
  due_date: string | null;
  is_done: boolean;
};

export default function TasksCard({ initialTasks }: { initialTasks: BoardroomTask[] }) {
  const [tasks, setTasks] = useState<BoardroomTask[]>(initialTasks);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Add-task form state.
  const [addOpen, setAddOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDue, setDraftDue] = useState("");
  const [adding, setAdding] = useState(false);

  async function toggle(id: string) {
    setError(null);
    setBusyId(id);

    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, is_done: !t.is_done } : t)));

    try {
      const res = await fetch(`/api/boardroom/tasks/${id}/toggle`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setTasks(prev);
      setError(e instanceof Error ? e.message : "toggle_failed");
    } finally {
      setBusyId(null);
    }
  }

  async function add() {
    setError(null);
    const title = draftTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      const res = await fetch("/api/boardroom/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, due_date: draftDue || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      // Prepend so the new task is visible immediately. The server-side
      // ordering on next page load is is_done asc → due_date asc → created
      // desc, so for the active session this prepend is consistent.
      setTasks((ts) => [data as BoardroomTask, ...ts]);
      setDraftTitle("");
      setDraftDue("");
      setAddOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "add_failed");
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    setBusyId(id);
    const prev = tasks;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/boardroom/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setTasks(prev);
      setError(e instanceof Error ? e.message : "delete_failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 14,
      }}>
        <div style={{
          fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
          textTransform: "uppercase", fontWeight: 600,
        }}>
          My Tasks
        </div>
        {!addOpen && (
          <button
            onClick={() => setAddOpen(true)}
            style={{
              fontSize: 10, color: "var(--accent)", background: "transparent",
              border: "1px solid var(--accent)", borderRadius: 3,
              padding: "3px 10px", letterSpacing: 1, textTransform: "uppercase",
              fontWeight: 700, cursor: "pointer", fontFamily: font,
            }}
          >
            + Add task
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {tasks.length === 0 && !addOpen ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No tasks yet.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {tasks.map((t) => (
            <li key={t.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={t.is_done}
                disabled={busyId === t.id}
                onChange={() => toggle(t.id)}
                style={{ cursor: busyId === t.id ? "wait" : "pointer", accentColor: "var(--accent)" }}
              />
              <span style={{
                flex: 1, fontSize: 13,
                color: t.is_done ? "var(--text-secondary)" : "var(--text-primary)",
                textDecoration: t.is_done ? "line-through" : "none",
              }}>
                {t.title}
              </span>
              {t.due_date && (
                <span style={{
                  fontSize: 10, color: "var(--text-secondary)", letterSpacing: 0.5,
                  border: "1px solid var(--border)", borderRadius: 3, padding: "2px 6px",
                }}>
                  {fmtDue(t.due_date)}
                </span>
              )}
              <button
                onClick={() => remove(t.id)}
                disabled={busyId === t.id}
                aria-label="Delete task"
                title="Delete"
                style={{
                  background: "none", border: "none",
                  color: "var(--text-secondary)",
                  fontSize: 14, lineHeight: 1, padding: "0 2px",
                  cursor: busyId === t.id ? "wait" : "pointer",
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {addOpen && (
        <div style={{
          marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            placeholder="Task title"
            disabled={adding}
            autoFocus
            style={fieldStyle}
            onKeyDown={(e) => { if (e.key === "Enter" && draftTitle.trim()) add(); }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="date"
              value={draftDue}
              onChange={(e) => setDraftDue(e.target.value)}
              disabled={adding}
              style={{ ...fieldStyle, flex: 1 }}
            />
            <button
              onClick={add}
              disabled={adding || !draftTitle.trim()}
              style={{
                background: "var(--accent)", color: "var(--bg)", border: "none",
                padding: "6px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
                fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
                cursor: adding ? "wait" : "pointer",
                opacity: adding || !draftTitle.trim() ? 0.6 : 1,
              }}
            >
              {adding ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setAddOpen(false); setDraftTitle(""); setDraftDue(""); }}
              disabled={adding}
              style={{
                background: "transparent", color: "var(--text-primary)",
                border: "1px solid var(--border)",
                padding: "6px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
                fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDue(date: string): string {
  try {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return date;
  }
}

const fieldStyle: React.CSSProperties = {
  background: "var(--bg)", border: "1px solid var(--border)",
  padding: "6px 10px", borderRadius: 3, color: "var(--text-primary)",
  fontFamily: font, fontSize: 13, outline: "none",
  width: "100%",
};
