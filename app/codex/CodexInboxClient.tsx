"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type CodexTaskStatus = "open" | "in_progress" | "done" | "archived";

type CodexTask = {
  id: string;
  list: "longboard";
  title: string;
  notes: string | null;
  status: CodexTaskStatus;
  source: string;
  created_by_email: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  completed_by: string | null;
  outcome: string | null;
  created_at: string;
  updated_at: string;
};

const statusLabels: Record<CodexTaskStatus, string> = {
  open: "Queued",
  in_progress: "Working",
  done: "Done",
  archived: "Archived",
};

function formatTime(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function CodexInboxClient({ userEmail }: { userEmail: string }) {
  const [tasks, setTasks] = useState<CodexTask[]>([]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [filter, setFilter] = useState<"active" | "done" | "all">("active");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visibleTasks = useMemo(() => {
    if (filter === "all") return tasks;
    if (filter === "done") return tasks.filter((task) => task.status === "done");
    return tasks.filter((task) => task.status === "open" || task.status === "in_progress");
  }, [filter, tasks]);

  async function loadTasks() {
    setLoading(true);
    try {
      const status = filter === "active" ? "" : `?status=${filter === "all" ? "all" : "done"}`;
      const res = await fetch(`/api/codex/tasks${status}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setTasks(json.tasks ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/codex/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed, notes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not add task");
      setTitle("");
      setNotes("");
      setNotice("Queued for Codex");
      setFilter("active");
      setTasks((current) => [...current, json.task]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add task");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(task: CodexTask) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditNotes(task.notes ?? "");
  }

  async function updateTask(id: string, payload: Record<string, unknown>) {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/codex/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not update task");
      setTasks((current) => current.map((task) => task.id === id ? json.task : task));
      setNotice("Saved");
      setError(null);
      return json.task as CodexTask;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update task");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(id: string) {
    const updated = await updateTask(id, { title: editTitle, notes: editNotes });
    if (updated) {
      setEditingId(null);
      setEditTitle("");
      setEditNotes("");
    }
  }

  async function markDone(id: string) {
    await updateTask(id, { status: "done", outcome: "Checked off from the web inbox." });
  }

  async function reopen(id: string) {
    await updateTask(id, { status: "open", outcome: null });
  }

  return (
    <main className="codex-inbox">
      <section className="codex-inbox__hero">
        <div>
          <p className="codex-inbox__kicker">Private queue</p>
          <h1>Codex Inbox</h1>
          <p>{userEmail}</p>
        </div>
        <a href="/admin" className="codex-inbox__link">Admin</a>
      </section>

      <form className="codex-inbox__composer" onSubmit={addTask}>
        <label htmlFor="codex-task-title">Task</label>
        <textarea
          id="codex-task-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What should Codex work on?"
          rows={3}
          maxLength={500}
        />
        <label htmlFor="codex-task-notes">Notes</label>
        <textarea
          id="codex-task-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional context, links, or acceptance criteria"
          rows={4}
          maxLength={4000}
        />
        <button type="submit" disabled={saving || !title.trim()}>
          {saving ? "Queuing..." : "Add to Longboard Queue"}
        </button>
      </form>

      <div className="codex-inbox__toolbar">
        <div className="codex-inbox__segments" aria-label="Task filters">
          <button type="button" className={filter === "active" ? "is-active" : ""} onClick={() => setFilter("active")}>Active</button>
          <button type="button" className={filter === "done" ? "is-active" : ""} onClick={() => setFilter("done")}>Done</button>
          <button type="button" className={filter === "all" ? "is-active" : ""} onClick={() => setFilter("all")}>All</button>
        </div>
        <button type="button" className="codex-inbox__ghost" onClick={loadTasks}>Refresh</button>
      </div>

      {(notice || error) && (
        <div className={`codex-inbox__notice${error ? " is-error" : ""}`}>
          {error ?? notice}
        </div>
      )}

      <section className="codex-inbox__list" aria-label="Codex task queue">
        {loading ? (
          <div className="codex-inbox__empty">Loading queue...</div>
        ) : visibleTasks.length === 0 ? (
          <div className="codex-inbox__empty">No tasks here.</div>
        ) : (
          visibleTasks.map((task) => (
            <article className={`codex-inbox__task is-${task.status}`} key={task.id}>
              <div className="codex-inbox__task-head">
                <span>{statusLabels[task.status]}</span>
                <time dateTime={task.created_at}>{formatTime(task.created_at)}</time>
              </div>

              {editingId === task.id ? (
                <div className="codex-inbox__edit">
                  <textarea value={editTitle} onChange={(event) => setEditTitle(event.target.value)} rows={3} maxLength={500} />
                  <textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} rows={4} maxLength={4000} />
                  <div className="codex-inbox__task-actions">
                    <button type="button" onClick={() => saveEdit(task.id)} disabled={saving || !editTitle.trim()}>Save</button>
                    <button type="button" className="codex-inbox__ghost" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <h2>{task.title}</h2>
                  {task.notes && <p>{task.notes}</p>}
                  {task.outcome && <p className="codex-inbox__outcome">{task.outcome}</p>}
                  <div className="codex-inbox__task-actions">
                    <button type="button" onClick={() => startEdit(task)}>Edit</button>
                    {task.status === "done" ? (
                      <button type="button" className="codex-inbox__ghost" onClick={() => reopen(task.id)}>Reopen</button>
                    ) : (
                      <button type="button" className="codex-inbox__ghost" onClick={() => markDone(task.id)}>Check Off</button>
                    )}
                  </div>
                </>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
