"use client";
import { messageLengthNotice } from "@/lib/chatMessageLimit";
import styles from "./MessageLength.module.css";

/** #367: how much room is left near the limit, or how much to cut over it. Nothing for short drafts. */
export default function MessageLengthNotice({ body, id }: { body: string; id?: string }) {
  const { text, over } = messageLengthNotice(body);
  if (!text) return null;
  return (
    <p
      id={id}
      className={styles.notice}
      data-chat-length-notice
      data-over={over}
      role={over ? "alert" : "status"}
    >
      {text}
    </p>
  );
}
