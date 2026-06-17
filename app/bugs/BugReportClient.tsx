"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type BugReportStatus = "pending" | "approved" | "ignored" | "promoted" | "archived";

type BugReport = {
  id: string;
  title: string;
  description: string;
  page_url: string | null;
  status: BugReportStatus;
  created_at: string;
  updated_at: string;
  review_note: string | null;
};

const statusLabels: Record<BugReportStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  ignored: "Ignored",
  promoted: "Queued",
  archived: "Archived",
};

function formatTime(iso: string) {
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

export default function BugReportClient({ userEmail }: { userEmail: string }) {
  const [reports, setReports] = useState<BugReport[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
  }, []);

  async function loadReports() {
    setLoading(true);
    try {
      const res = await fetch("/api/bugs/reports", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setReports(data.reports ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load reports");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPageUrl(currentUrl);
    loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUrl]);

  async function submitReport(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !description.trim()) return;

    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch("/api/bugs/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, pageUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setReports((current) => [data.report, ...current]);
      setTitle("");
      setDescription("");
      setPageUrl(currentUrl);
      setNotice("Bug report sent for review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send bug report");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="bug-report">
      <section className="bug-report__header">
        <div>
          <p className="bug-report__kicker">Member feedback</p>
          <h1>Report a Bug</h1>
          <p>{userEmail}</p>
        </div>
      </section>

      <form className="bug-report__form" onSubmit={submitReport}>
        <label htmlFor="bug-title">Bug</label>
        <input
          id="bug-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={240}
          placeholder="Short version"
        />

        <label htmlFor="bug-description">What happened?</label>
        <textarea
          id="bug-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={7}
          maxLength={4000}
          placeholder="What did you expect, what did you see, and what were you doing right before it happened?"
        />

        <label htmlFor="bug-page-url">Page</label>
        <input
          id="bug-page-url"
          value={pageUrl}
          onChange={(event) => setPageUrl(event.target.value)}
          maxLength={1000}
          placeholder="https://www.longboardai.com/..."
        />

        <button type="submit" disabled={saving || !title.trim() || !description.trim()}>
          {saving ? "Sending..." : "Send Bug Report"}
        </button>
      </form>

      {(notice || error) && (
        <div className={`bug-report__notice${error ? " is-error" : ""}`}>
          {error ?? notice}
        </div>
      )}

      <section className="bug-report__recent">
        <div className="bug-report__section-title">
          <h2>Recent Reports</h2>
          <button type="button" onClick={loadReports}>Refresh</button>
        </div>

        {loading ? (
          <div className="bug-report__empty">Loading reports...</div>
        ) : reports.length === 0 ? (
          <div className="bug-report__empty">No bug reports yet.</div>
        ) : (
          <div className="bug-report__list">
            {reports.map((report) => (
              <article className={`bug-report__item is-${report.status}`} key={report.id}>
                <div className="bug-report__item-meta">
                  <span>{statusLabels[report.status]}</span>
                  <time dateTime={report.created_at}>{formatTime(report.created_at)}</time>
                </div>
                <h3>{report.title}</h3>
                <p>{report.description}</p>
                {report.review_note && <p className="bug-report__review">{report.review_note}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
