"use client";
import { useEffect, useState } from "react";
import styles from "./PublicChat.module.css";
type Report = { id: string; reason: string; created_at: string };
type Review = { report: Report & { reporter_id: string }; messages: { id: string; sender_id: string; body: string }[]; members: { id: string; display_name: string }[] };
export default function ChatReportReview() {
  const [reports, setReports] = useState<Report[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/chat/reports", { cache: "no-store" }).then(async (res) => {
      if (!res.ok) throw new Error("Reports could not load.");
      const result = await res.json();
      if (!cancelled) setReports(result.reports ?? []);
    }).catch((e) => { if (!cancelled) setError(e.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return <div className={styles.summaryList}>
    <span>REPORTED PRIVATE CONVERSATIONS</span>
    {loading ? <p>Loading reports…</p> : !reports.length ? <p>No reports.</p> : reports.map((report) => <div key={report.id}>
      <button type="button" className={styles.textButton} onClick={async () => {
        setError(""); setReview(null);
        try {
          const response = await fetch(`/api/chat/reports?id=${report.id}`, { cache: "no-store" });
          if (!response.ok) throw new Error("This report could not load.");
          setReview(await response.json());
        } catch (e) { setError(e instanceof Error ? e.message : "Report unavailable."); }
      }}>{new Date(report.created_at).toLocaleDateString()} · Review report</button><p>{report.reason}</p>
    </div>)}
    {review ? <details open><summary>Reported conversation · latest 100 messages</summary>
      <p>Reason: {review.report.reason}</p>
      {review.messages.map((m) => <p key={m.id}><strong>{review.members.find((member) => member.id === m.sender_id)?.display_name ?? "Member"}{m.sender_id === review.report.reporter_id ? " (reporter)" : ""}:</strong> {m.body}</p>)}
    </details> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
