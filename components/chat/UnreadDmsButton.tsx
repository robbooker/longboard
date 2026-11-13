"use client";
import { useSyncExternalStore } from "react";
import { readUnreadDms, subscribeUnreadDms, unreadDmsLabel, unreadDmsShort } from "@/lib/chatUnreadDms";
import ChatIcon from "./ChatIcon";
import styles from "./UnreadDmsButton.module.css";

const serverCount = () => 0;

/**
 * #453: a bright "3 unread DMs" button at the top of the chat, shown only while a DM is unread.
 * It reads the sidebar's own DM total (lib/chatUnreadDms.ts), so only this button redraws as it
 * changes. "header" is the computer header (the words fold to icon + number when narrow); "phone"
 * is a 44px icon with the number on it, for the phone's conversation header and list bar.
 */
export default function UnreadDmsButton({
  shape,
  onShow,
}: {
  shape: "header" | "phone";
  onShow: () => void;
}) {
  const count = useSyncExternalStore(subscribeUnreadDms, readUnreadDms, serverCount);
  const label = unreadDmsLabel(count);
  if (!label) return null;
  return (
    <button
      type="button"
      className={styles.button}
      data-unread-dms={count}
      data-shape={shape}
      aria-label={label}
      title={`${label}: show your direct messages`}
      onClick={onShow}
    >
      <ChatIcon name="mail" size={shape === "phone" ? 20 : 17} />
      {shape === "phone" ? (
        <span className={styles.count} aria-hidden="true">
          {unreadDmsShort(count)}
        </span>
      ) : (
        <>
          <span className={styles.short} aria-hidden="true">
            {unreadDmsShort(count)}
          </span>
          <span className={styles.words} aria-hidden="true">
            {label}
          </span>
        </>
      )}
    </button>
  );
}
