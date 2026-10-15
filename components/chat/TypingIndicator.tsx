"use client";
import type { ChatRoom } from "@/lib/publicChat";
import styles from "./TypingIndicator.module.css";
import { useTypingLabel } from "./room/useTyping";

/** A quiet line just above a composer. Renders nothing visible until someone types. */
export default function TypingIndicator(props: {
  channel: string | null;
  selfId: string | null | undefined;
  resolveName: (memberId: string) => string | null | undefined | Promise<string | null | undefined>;
  room?: ChatRoom;
  clearKey?: string | null;
}) {
  const label = useTypingLabel(props);
  return (
    <p className={styles.typing} aria-live="polite" data-chat-typing={label ? "true" : undefined}>
      {label}
    </p>
  );
}
