"use client";
// #414: tapping a person's name or picture anywhere in the chat opens one shared pop-up with their
// picture at full size (the 256px file, the largest one stored) and their name under it. Someone
// without a picture (and every guest and bot) shows their usual initials tile at the same size.
// Where a name used to open a private message, the pop-up offers that as a button instead.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { chatAvatarColor, chatAvatarUrl, chatInitials } from "@/lib/chatAvatar";
import { useChatAvatar } from "./ChatUpdates";
import pageStyles from "./PublicChat.module.css";
import styles from "./MemberPictureView.module.css";
import type { ChatMessageAgent } from "@/lib/chatAgents";
import { AgentViewDetails } from "./AgentByline";

export type PicturePerson = {
  /** Their member id, when they have one: your own picture always comes from your identity. */
  memberId?: string | null;
  /** The picture name the server sent with the row. */
  path?: string | null;
  name: string;
  /** What the initials tile's colour is picked from: the same key the small tile uses. */
  colorKey: string;
  /** Bots never show a picture. */
  bot?: boolean;
  /** Buddy's tile keeps its own colours, as in the room. */
  buddy?: boolean;
  /** Where the name used to open a private message: the same action, as a button in the pop-up. */
  onMessage?: () => void;
  /** #450: an agent: the view says who runs it and offers Mute (it never shows a picture yet). */
  agent?: ChatMessageAgent;
};
type OpenPictureView = (person: PicturePerson, trigger?: HTMLElement | null) => void;
const PictureView = createContext<OpenPictureView | null>(null);
/** Opens the pop-up; null outside a chat (names and pictures then stay plain). */
export const useMemberPictureView = () => useContext(PictureView);
export const pictureViewLabel = (name: string) => `View ${name}’s profile picture`;

/** One pop-up for the whole chat session. `theme` and `palette` are the chat's current look. */
export function MemberPictureProvider({
  theme,
  palette,
  children,
}: {
  theme?: string;
  palette?: string;
  children: ReactNode;
}) {
  const [person, setPerson] = useState<PicturePerson | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const open = useCallback<OpenPictureView>((next, from) => {
    trigger.current = from ?? null;
    setPerson(next);
  }, []);
  const close = useCallback(() => {
    setPerson(null);
    // Back to the name or picture that opened it, without moving the conversation.
    const from = trigger.current;
    trigger.current = null;
    if (from?.isConnected) from.focus({ preventScroll: true });
  }, []);
  return (
    <PictureView.Provider value={open}>
      {children}
      {person && (
        <div
          className={pageStyles.themeScope}
          data-theme={theme}
          data-palette={palette}
          style={{ display: "contents" }}
        >
          <PictureDialog person={person} onClose={close} />
        </div>
      )}
    </PictureView.Provider>
  );
}

function PictureDialog({ person, onClose }: { person: PicturePerson; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const current = useChatAvatar(person.memberId, person.path);
  const url = person.bot ? null : chatAvatarUrl(current, 256);
  const [failed, setFailed] = useState<string | null>(null);
  const picture = url && failed !== url ? url : null;
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!node.open) node.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (node.open) node.close();
    };
  }, []);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={heading}
      data-member-picture-view=""
      // Keys stay inside the pop-up: Escape closes it and nothing behind it (a thread, a list).
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      // Closed by the browser itself (not by the handlers above): keep the page's state in step.
      onClose={(event) => {
        event.stopPropagation();
        if (!event.currentTarget.open) onClose();
      }}
      // A click or tap outside the card lands on the dialog itself (its backdrop).
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className={styles.card}>
        <button ref={closeButton} type="button" className={styles.close} aria-label="Close" onClick={close}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        {picture ? (
          <span className={styles.picture} data-avatar="picture">
            {/* eslint-disable-next-line @next/next/no-img-element -- a fixed, already-sized storage file */}
            <img
              src={picture}
              alt={`${person.name}’s profile picture`}
              width={256}
              height={256}
              decoding="async"
              draggable={false}
              onError={() => setFailed(picture)}
            />
          </span>
        ) : (
          <span
            className={styles.picture}
            data-avatar="initials"
            data-bot={person.buddy || undefined}
            aria-hidden="true"
            style={person.buddy ? undefined : { background: chatAvatarColor(person.colorKey) }}
          >
            <span>{chatInitials(person.name)}</span>
          </span>
        )}
        <h2 id={heading} className={styles.name}>
          {person.name}
        </h2>
        {person.agent && <AgentViewDetails agent={person.agent} buttonClass={styles.message} />}
        {person.onMessage && (
          <button
            type="button"
            className={styles.message}
            onClick={() => {
              const message = person.onMessage;
              close();
              message?.();
            }}
          >
            Message privately
          </button>
        )}
      </div>
    </dialog>
  );
}

/**
 * A person's name as a button that opens the pop-up. `children` is what is shown when it differs
 * from the name (a picture before it, "@Buddy"). Outside a chat it is plain text.
 */
export function PictureName({
  person,
  className,
  hidden,
  children,
}: {
  person: PicturePerson;
  className?: string;
  /** The name is on screen only for screen readers (a grouped message): no stop for the Tab key. */
  hidden?: boolean;
  children?: ReactNode;
}) {
  const open = useMemberPictureView();
  if (!open) return <span className={className}>{children ?? person.name}</span>;
  return (
    <button
      type="button"
      className={className ? `${styles.nameButton} ${className}` : styles.nameButton}
      title={pictureViewLabel(person.name)}
      data-picture-view=""
      tabIndex={hidden ? -1 : undefined}
      onClick={(event) => open(person, event.currentTarget)}
    >
      {children ?? person.name}
    </button>
  );
}
