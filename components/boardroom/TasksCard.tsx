"use client";

import { useState } from "react";

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

  async function toggle(id: string) {
    setError(null);
    setBusyId(id);

    // Optimistic flip — revert if the server says no.
    const prev = tasks;
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, is_done: !t.is_done } : t)));

    try {
      const res = await fetch(`/api/boardroom/tasks/${id}/toggle`, { method: "POST" });
      if (!res.ok) {
        // The toggle endpoint ships in Phase 4A Commit 6. Until then a
        // 404 is expected; surface it so it's obvious in dev rather
        // than failing silently. After Commit 6 this branch only fires
        // on real errors.
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

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 14,
      }}>
        My Tasks
      </div>

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {tasks.length === 0 ? (
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtDue(date: string): string {
  // YYYY-MM-DD → "Apr 29" form. Server-rendered dates use the user's
  // locale; this matches.
  try {
    const d = new Date(date + "T00:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return date;
  }
}
