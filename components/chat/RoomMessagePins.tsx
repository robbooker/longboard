"use client";
import { useId, useState } from "react";
import type { RoomMessagePin } from "@/lib/chatRoomMessagePins";
import type { PublicChatMessage } from "@/lib/publicChat";
import { useChatDisplayName } from "./ChatUpdates";
import styles from "./RoomMessagePins.module.css";
export type MessagePinControls = {
  canManagePins: boolean;
  pinnedIds: ReadonlySet<string>;
  busy: string | null;
  onToggle: (id: string, pinned: boolean) => void;
};
export function MessagePinButton({
  message,
  controls,
}: {
  message: PublicChatMessage;
  controls?: MessagePinControls;
}) {
  if (!controls?.canManagePins || message.pending || message.removed || message.deleted_at) return null;
  const pinned = controls.pinnedIds.has(message.id);
  return (
    <button
      type="button"
      className={styles.control}
      disabled={!!controls.busy}
      aria-label={`${pinned ? "Unpin" : "Pin"} message by ${message.author_label}`}
      aria-pressed={pinned}
      onClick={() => controls.onToggle(message.id, pinned)}
    >
      {controls.busy === message.id ? "Saving…" : pinned ? "Unpin" : "Pin"}
    </button>
  );
}
function Pin({
  pin,
  onOpen,
  controls,
}: {
  pin: RoomMessagePin;
  onOpen: (pin: RoomMessagePin, trigger: HTMLButtonElement) => void;
  controls: MessagePinControls;
}) {
  const author = useChatDisplayName(pin.memberId, pin.authorLabel);
  return (
    <li data-pinned-message-id={pin.messageId}>
      <button
        type="button"
        data-pin-jump
        className={styles.open}
        onClick={(event) => onOpen(pin, event.currentTarget)}
        aria-label={`Go to pinned message by ${author}: ${pin.preview}`}
      >
        <strong>{author}</strong>
        <span>{pin.preview}</span>
      </button>
      {controls.canManagePins && (
        <button
          type="button"
          className={styles.control}
          disabled={!!controls.busy}
          aria-label={`Unpin message by ${author}`}
          onClick={() => controls.onToggle(pin.messageId, true)}
        >
          Unpin
        </button>
      )}
    </li>
  );
}
export default function RoomMessagePins({
  pins,
  controls,
  onOpen,
  error,
  collapsible = false,
}: {
  pins: RoomMessagePin[];
  controls: MessagePinControls;
  onOpen: (pin: RoomMessagePin, trigger: HTMLButtonElement) => void;
  error: string;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  if (!pins.length && !error) return null;
  if (collapsible)
    return (
      <aside className={`${styles.strip} ${styles.quad}`} aria-label="Pinned room messages">
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={expanded}
          aria-controls={contentId}
          disabled={!pins.length}
          onClick={() => setExpanded((value) => !value)}
        >
          <span>
            Pinned messages <span className={styles.count}>{pins.length}/10</span>
          </span>
          <span aria-hidden="true" className={styles.cue}>
            {expanded ? "Hide" : "Show"} <span className={styles.chevron}>⌄</span>
          </span>
        </button>
        <div
          id={contentId}
          className={styles.reveal}
          data-expanded={expanded}
          aria-hidden={!expanded}
          inert={!expanded}
        >
          <div className={styles.revealInner}>
            {!!pins.length && (
              <ul>
                {pins.map((pin) => (
                  <Pin key={pin.messageId} pin={pin} controls={controls} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </div>
        </div>
        {error && <p role="alert">{error}</p>}
      </aside>
    );
  return (
    <aside className={styles.strip} aria-label="Pinned room messages">
      <div className={styles.heading}>
        Pinned messages <span>{pins.length}/10</span>
      </div>
      {!!pins.length && (
        <ul>
          {pins.map((pin) => (
            <Pin key={pin.messageId} pin={pin} controls={controls} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
