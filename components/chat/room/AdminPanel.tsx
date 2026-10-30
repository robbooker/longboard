"use client";
import dynamic from "next/dynamic";
import styles from "../PublicChat.module.css";
import { roomHasSummaries, type ChatRoom } from "@/lib/publicChat";
import type { RoomAdmin } from "./useRoomAdmin";

const ChatReportReview = dynamic(() => import("../ChatReportReview"), {
  ssr: false,
  loading: () => <p role="status">Loading reported conversations…</p>,
});

/** The owner control panel opened from the ••• menu's "Admin controls". */
export default function AdminPanel({
  room,
  roomLabel,
  roomPaused,
  admin,
}: {
  room: ChatRoom;
  roomLabel: string;
  roomPaused: boolean;
  admin: RoomAdmin;
}) {
  const {
    setAdminOpen,
    adminState,
    adminAction,
    adminFeedback,
    adminReason,
    setAdminReason,
    summaries,
    setRoomOpen,
    summarizeNow,
    syncShortScout,
  } = admin;
  return (
    <aside
      id="longboard-chat-admin-panel"
      className={styles.adminPanel}
      aria-label="Longboard Chat owner controls"
      aria-busy={Boolean(adminAction)}
    >
      <div className={styles.adminHeading}>
        <div>
          <span>{roomLabel.toUpperCase()} · OWNER CONTROL</span>
          <strong>{roomPaused ? "ROOM PAUSED" : "ROOM OPEN"}</strong>
        </div>
        <button
          className={styles.adminClose}
          type="button"
          aria-label="Close owner controls"
          onClick={() => setAdminOpen(false)}
        >
          ×
        </button>
      </div>
      <p className={styles.adminCopy}>
        Only your authenticated Longboard account can use these controls. Pausing this room keeps its history
        readable and stops messages and reactions here.
      </p>
      {!roomPaused ? (
        <label className={styles.adminReason}>
          <span>Optional public notice</span>
          <input
            value={adminReason}
            maxLength={240}
            placeholder="Chat temporarily paused by Longboard."
            onChange={(event) => setAdminReason(event.target.value)}
          />
        </label>
      ) : null}
      <div className={styles.adminActions}>
        <button
          className={roomPaused ? styles.reopenButton : styles.pauseButton}
          type="button"
          disabled={Boolean(adminAction)}
          onClick={() => void setRoomOpen(roomPaused)}
        >
          {adminAction === "room" ? "WORKING…" : roomPaused ? "REOPEN CHAT" : "PAUSE CHAT"}
        </button>
        {roomHasSummaries(room) && (
          <button
            className={styles.summaryButton}
            type="button"
            disabled={Boolean(adminAction)}
            onClick={() => void summarizeNow()}
          >
            {adminAction === "summary" ? "SUMMARIZING…" : "SUMMARIZE NOW"}
          </button>
        )}
        <button
          className={styles.summaryButton}
          type="button"
          disabled={Boolean(adminAction)}
          onClick={() => void syncShortScout()}
        >
          {adminAction === "shortscout" ? "SYNCING…" : "SYNC SHORTSCOUT"}
        </button>
      </div>
      <p className={styles.adminFeedback} data-state={adminState} aria-live="polite">
        {adminFeedback}
      </p>
      <ChatReportReview />
      {roomHasSummaries(room) && (
        <div className={styles.summaryList}>
          <span>PRIVATE DAILY SUMMARIES</span>
          {summaries.length ? (
            summaries.slice(0, 3).map((summary) => (
              <details key={summary.id}>
                <summary>
                  {summary.summary_date} · {summary.message_count} messages
                </summary>
                <p>{summary.summary_text}</p>
              </details>
            ))
          ) : (
            <p>No summaries yet.</p>
          )}
        </div>
      )}
    </aside>
  );
}
