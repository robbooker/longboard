"use client";

import { useEffect, useMemo, useState } from "react";

type BugStatus = "pending" | "approved" | "ignored" | "promoted" | "archived";
type Filter = "pending" | "approved" | "ignored" | "promoted" | "all";
type Action = "approve" | "ignore" | "promote" | "archive";

type BugReport = {
  id: string;
  title: string;
  description: string;
  page_url: string | null;
  status: BugStatus;
  source: string;
  reported_by_email: string | null;
  slack_posted_at: string | null;
  slack_error: string | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  promoted_codex_task_id: string | null;
  created_at: string;
  updated_at: string;
};

const labels: Record<BugStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  ignored: "Ignored",
  promoted: "Promoted",
  archived: "Archived",
};

function formatTime(iso: string | null) {
  if (!iso) return "—";
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

export default function BugInboxClient() {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [filter, setFilter] = useState<Filter>("pending");
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pendingCount = useMemo(() => reports.filter((report) => report.status === "pending").length, [reports]);

  async function loadReports() {
    setLoading(true);
    setError(null);
    try {
      const status = filter === "all" ? "?status=all" : `?status=${filter}`;
      const res = await fetch(`/api/admin/bugs/reports${status}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setReports(data.reports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bug reports");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function act(report: BugReport, action: Action) {
    setWorkingId(report.id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/bugs/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewNote: reviewNotes[report.id] ?? "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setReports((current) => current.map((item) => item.id === report.id ? data.report : item));
      setNotice(action === "promote" ? "Promoted to Codex queue" : "Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update bug report");
    } finally {
      setWorkingId(null);
    }
  }

  return (
    <main className="bug-admin">
      <header className="bug-admin__header">
        <div>
          <p>Admin queue</p>
          <h1>Bug Inbox</h1>
        </div>
        <nav>
          <a href="/admin">Admin</a>
          <a href="/codex">Codex</a>
          <a href="/bugs">Report</a>
        </nav>
      </header>

      <div className="bug-admin__toolbar">
        <div className="bug-admin__filters" aria-label="Bug filters">
          {(["pending", "approved", "ignored", "promoted", "all"] as Filter[]).map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? "is-active" : ""}
              onClick={() => setFilter(item)}
            >
              {item === "all" ? "All" : labels[item]}
            </button>
          ))}
        </div>
        <button type="button" className="bug-admin__ghost" onClick={loadReports}>Refresh</button>
      </div>

      <div className="bug-admin__summary">
        {loading ? "Loading..." : `${pendingCount} pending in this view · ${reports.length} shown`}
      </div>

      {(notice || error) && (
        <div className={`bug-admin__notice${error ? " is-error" : ""}`}>
          {error ?? notice}
        </div>
      )}

      <section className="bug-admin__list" aria-label="Bug reports">
        {loading ? (
          <div className="bug-admin__empty">Loading bug reports...</div>
        ) : reports.length === 0 ? (
          <div className="bug-admin__empty">No bug reports here.</div>
        ) : (
          reports.map((report) => {
            const working = workingId === report.id;
            return (
              <article className={`bug-admin__item is-${report.status}`} key={report.id}>
                <div className="bug-admin__meta">
                  <span>{labels[report.status]}</span>
                  <time dateTime={report.created_at}>{formatTime(report.created_at)}</time>
                </div>
                <h2>{report.title}</h2>
                <p>{report.description}</p>

                <dl className="bug-admin__facts">
                  <div><dt>Reporter</dt><dd>{report.reported_by_email ?? "—"}</dd></div>
                  <div><dt>Page</dt><dd>{report.page_url ? <a href={report.page_url}>{report.page_url}</a> : "—"}</dd></div>
                  <div><dt>Slack</dt><dd>{report.slack_posted_at ? formatTime(report.slack_posted_at) : report.slack_error ?? "Not posted"}</dd></div>
                  <div><dt>Codex</dt><dd>{report.promoted_codex_task_id ?? "—"}</dd></div>
                </dl>

                <label htmlFor={`note-${report.id}`}>Review note</label>
                <textarea
                  id={`note-${report.id}`}
                  value={reviewNotes[report.id] ?? report.review_note ?? ""}
                  onChange={(event) => setReviewNotes((current) => ({ ...current, [report.id]: event.target.value }))}
                  rows={3}
                  maxLength={4000}
                />

                <div className="bug-admin__actions">
                  <button type="button" disabled={working} onClick={() => act(report, "promote")}>
                    {working ? "..." : "Promote to Codex"}
                  </button>
                  <button type="button" disabled={working} className="bug-admin__ghost" onClick={() => act(report, "approve")}>Approve</button>
                  <button type="button" disabled={working} className="bug-admin__danger" onClick={() => act(report, "ignore")}>Ignore</button>
                  {report.status !== "archived" && (
                    <button type="button" disabled={working} className="bug-admin__ghost" onClick={() => act(report, "archive")}>Archive</button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </section>
    </main>
  );
}
