import { RUNNER_WATCH_LABEL, RUNNER_WATCH_ROOM_PATH, runnerWatchReportParts } from "@/lib/chatRunnerWatchText";
import Link from "next/link";
import styles from "./RunnerWatch.module.css";

const when = (value: string) =>
  new Date(value).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET";

/** #341: one report. All of it is React text; the only anchors are checked http or https links. */
export default function RunnerWatchReport(props: { tickers: string[]; summary: string; fullText: string; alert: boolean; at: string; notPosted: boolean }) {
  const title = props.tickers.length ? props.tickers.join(", ") : "Runner Risk Watch update";
  return (
    <main className={styles.page} data-runner-report>
      <div className={styles.column}>
        <Link className={styles.back} href={RUNNER_WATCH_ROOM_PATH}>
          ← Back to Runner Watch
        </Link>
        <p className={styles.kicker}>Runner Risk Watch{props.alert ? " · Alert" : ""}</p>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.time}>{when(props.at)}</p>
        <p className={styles.label} data-runner-label>
          {RUNNER_WATCH_LABEL}
        </p>
        {props.notPosted && <p className={styles.notice}>Not posted in the room. Only admins can see this page.</p>}
        <p className={styles.summary}>{props.summary}</p>
        <div className={styles.report} data-runner-text>
          {runnerWatchReportParts(props.fullText).map((part, index) =>
            part.kind === "link" ? (
              <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow">
                {part.value}
              </a>
            ) : (
              <span key={index}>{part.value}</span>
            ),
          )}
        </div>
        <p className={styles.footnote}>{RUNNER_WATCH_LABEL}</p>
      </div>
    </main>
  );
}
