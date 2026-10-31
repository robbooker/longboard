"use client";
import { RUNNER_WATCH_ROOM_PATH } from "@/lib/chatRunnerWatchText";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./RunnerWatch.module.css";

type Held = { id: string; tickers: string[]; summary: string; received_at: string };

/** #341: buttons, so nothing here needs a deploy or a database login. */
export default function RunnerWatchAdmin(props: { enabled: boolean; alertsOnly: boolean; maxPerHour: number; maxPerDay: number; mainAlertsOnly: boolean; mainMaxPerDay: number; postedLastHour: number; held: Held[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/runner-watch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) setError("That didn't work. Please try again.");
      router.refresh();
    } catch {
      setError("That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className={styles.page}>
      <div className={styles.column}>
        <a className={styles.back} href={RUNNER_WATCH_ROOM_PATH}>← Back to Runner Watch</a>
        <h1 className={styles.title}>Runner Watch feed</h1>
        <section className={styles.section}>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <strong data-feed-state>{props.enabled ? "The feed is on" : "The feed is off"}</strong>
              <p className={styles.hint}>{props.enabled ? "Updates from Jake's report are posted." : "Updates are refused and nothing is posted or saved in any room."}</p>
            </div>
            <button className={styles.button} data-feed-toggle disabled={busy} onClick={() => send({ action: "settings", enabled: !props.enabled })}>
              {props.enabled ? "Switch feed off" : "Switch feed on"}
            </button>
          </div>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <strong>{props.alertsOnly ? "Posting alerts only" : "Posting every update"}</strong>
              <p className={styles.hint}>{props.alertsOnly ? "Updates not marked as alerts are saved, not posted." : "Updates are posted whether or not they're marked as alerts."}</p>
            </div>
            <button className={styles.button} data-alerts-toggle disabled={busy} onClick={() => send({ action: "settings", alertsOnly: !props.alertsOnly })}>
              {props.alertsOnly ? "Post every update" : "Post alerts only"}
            </button>
          </div>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <strong>{props.mainAlertsOnly ? "LB and SS get alerts only" : "LB and SS get every update"}</strong>
              <p className={styles.hint}>At most {props.mainMaxPerDay} a day in each room, either way. Runner Watch isn&apos;t affected.</p>
            </div>
            <button className={styles.button} data-main-toggle disabled={busy} onClick={() => send({ action: "settings", mainAlertsOnly: !props.mainAlertsOnly })}>
              {props.mainAlertsOnly ? "Send LB and SS every update" : "Send LB and SS alerts only"}
            </button>
          </div>
          <p className={styles.hint}>{props.postedLastHour} posted in the last hour. Limits: {props.maxPerHour} an hour, {props.maxPerDay} a day.</p>
        </section>
        <section className={styles.section}>
          <h2>Held back ({props.held.length})</h2>
          {props.held.length === 0 && <p className={styles.hint}>Nothing is being held back.</p>}
          {props.held.map((item) => (
            <div className={styles.row} key={item.id} data-held-row>
              <div className={styles.rowText}>
                <a href={`/runner-watch/${item.id}`}>{item.tickers.join(", ") || "No ticker"}</a>: {item.summary.slice(0, 160)}
              </div>
              <button className={styles.button} data-held-post disabled={busy} onClick={() => send({ action: "post", id: item.id })}>
                Post now
              </button>
            </div>
          ))}
          {error && <p className={styles.error}>{error}</p>}
        </section>
      </div>
    </main>
  );
}
