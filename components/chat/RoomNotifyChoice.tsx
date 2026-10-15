"use client";
import {
  ROOM_NOTIFY_OPTIONS,
  roomNotifyAvailable,
  roomNotifyLevel,
  type RoomNotifyLevel,
} from "@/lib/chatRoomNotify";
import type { ChatRoom } from "@/lib/publicChat";
import { useState } from "react";
import { useSharedChatActivity } from "./ChatActivityContext";
import ChatIcon from "./ChatIcon";
import chatStyles from "./PublicChat.module.css";
import styles from "./RoomNotifyChoice.module.css";

const ICONS = { all: "bell", mentions: "at", muted: "bellOff" } as const;

/**
 * ROOM-NOTIFY: All messages / Mentions only / Muted for one room. "menu" sits under
 * "This room" in the desktop ••• menu; "sheet" in the phone room info sheet. Hidden until
 * the server reports room levels (before the migration, every room is "all").
 */
export default function RoomNotifyChoice({ room, variant }: { room: ChatRoom; variant: "menu" | "sheet" }) {
  const activity = useSharedChatActivity();
  const [pending, setPending] = useState<{ room: ChatRoom; level: RoomNotifyLevel } | null>(null);
  const [error, setError] = useState("");
  if (!roomNotifyAvailable(activity.data)) return null;
  const saved = roomNotifyLevel(activity.data.roomLevels, room);
  const current = pending?.room === room ? pending.level : saved;
  async function choose(level: RoomNotifyLevel) {
    if (level === current || pending) return;
    setError("");
    setPending({ room, level });
    try {
      // Saves, then refreshes the bell and badges (the read path reloads activity).
      await activity.read({ kind: "roomLevel", room, level });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this room’s notifications.");
    } finally {
      setPending(null);
    }
  }
  const options = ROOM_NOTIFY_OPTIONS.map((option) => (
    <button
      key={option.value}
      type="button"
      className={variant === "menu" ? chatStyles.menuItem : styles.option}
      aria-pressed={current === option.value}
      aria-busy={pending?.level === option.value || undefined}
      onClick={() => void choose(option.value)}
    >
      <span className={variant === "menu" ? chatStyles.menuIconLabel : styles.optionLabel}>
        <ChatIcon name={ICONS[option.value]} />
        <span>
          {option.label}
          {variant === "sheet" && <small>{option.hint}</small>}
        </span>
      </span>
      {variant === "menu" && <span aria-hidden="true">{current === option.value ? "✓" : ""}</span>}
    </button>
  ));
  return variant === "menu" ? (
    <div role="group" aria-label="Room notifications" data-room-notify={current}>
      <div className={styles.menuLabel}>Notifications</div>
      {options}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  ) : (
    <section className={chatStyles.phoneSheetSection} aria-label="Notifications" data-room-notify={current}>
      <h3>Notifications</h3>
      <div className={styles.options} role="group" aria-label="Room notifications">
        {options}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
