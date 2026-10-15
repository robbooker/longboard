"use client";
import { memo, type MouseEvent } from "react";
import { chatAvatarColor, chatInitials } from "@/lib/chatAvatar";
import { threadReplyAge } from "@/lib/chatTimestamp";
import type { ReplyPerson, ReplyThread } from "@/lib/chatReplyCounts";
import { useChatDisplayName } from "./ChatUpdates";
import styles from "./ThreadLink.module.css";

function Tile({ person }: { person: ReplyPerson }) {
  const name = useChatDisplayName(person.member, person.name);
  return (
    <span className={styles.tile} data-bot={person.bot || undefined} style={{ background: chatAvatarColor(person.key) }}>
      {chatInitials(name)}
    </span>
  );
}

/**
 * AVATARS-REST: the link under a message with replies. Up to three repliers' initials tiles
 * (newest first), the count and how long ago the last reply came. Without thread details (an
 * older server, or before the counts arrive) it shows the count alone.
 */
const ThreadLink = memo(function ThreadLink({
  count,
  thread,
  showAge = true,
  expanded,
  className,
  onClick,
}: {
  count: number;
  thread?: ReplyThread;
  /** The age uses the viewer's clock, so it waits for hydration like timestamps do. */
  showAge?: boolean;
  expanded?: boolean;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = `${count} ${count === 1 ? "reply" : "replies"}`;
  const age = thread && showAge ? threadReplyAge(thread.last) : "";
  return (
    <button
      type="button"
      className={`${className ?? ""} ${styles.link}`}
      data-has-replies
      data-thread-link
      aria-expanded={expanded}
      onClick={onClick}
    >
      {thread?.people.length ? (
        <span className={styles.tiles} aria-hidden="true">
          {thread.people.map((person) => (
            <Tile key={person.key} person={person} />
          ))}
        </span>
      ) : (
        "↳ "
      )}
      <span className={styles.count}>{label}</span>
      {age && <span className={styles.age}> · {age === "just now" ? "last reply just now" : `last ${age}`}</span>}
    </button>
  );
});
export default ThreadLink;
