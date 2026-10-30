"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { isAnnouncementRoom, isRecordingRoom } from "@/lib/publicChat";
import type { ChatActivity, ChatReactionNotification } from "@/lib/chatActivity";
import {
  holdUnreadNotifications,
  noHeldNotifications,
  orderedChatNotifications,
  unreadFirstNotifications,
} from "@/lib/chatNotificationOrder";
import { CHAT_REACTION_LABELS } from "@/lib/chatMessageReactions";
import styles from "./ChatActivityBell.module.css";
import { useOptionalSharedChatActivity } from "./ChatActivityContext";
import {
  FeatureNotificationList,
  FeatureUpdateBanner,
  useFeatureNotifications,
  type FeatureInbox,
} from "./FeatureNotifications";
// Alert labels in Title Case, like the room names (D-216).
const labels = {
  main: "LB",
  social: "Social",
  shortscout: "SS",
  "lb-announcements": "LB Announcements",
  "ss-announcements": "SS Announcements",
  gainers: "Gainers",
  "lb-recordings": "LB Recordings",
  "ss-recordings": "SS Recordings",
  "whats-new": "What's New?",
  developers: "Developers",
};
function ReactionIcon({ notification: n }: { notification: ChatReactionNotification }) {
  return (
    <span className={styles.reactionIcon} aria-hidden="true">
      {n.emoji === "rob" ? (
        <Image src="/chat/reactions/rob.png" alt="" width={22} height={22} sizes="22px" />
      ) : n.emoji === "heart" ? (
        "❤️"
      ) : n.emoji === "laugh" ? (
        "😂"
      ) : n.kind === "dm" ? (
        "👍"
      ) : n.room === "shortscout" || n.room.startsWith("ss-") ? (
        "🍋"
      ) : (
        "🌴"
      )}
    </span>
  );
}
type BellProps = {
  data: ChatActivity;
  error: string;
  read: (body: Record<string, unknown>) => Promise<void>;
};
/** One bell for chat activity; Features members also get their Product updates here (UI-MENUS). */
export default function ChatActivityBell({
  productUpdates = false,
  ...props
}: BellProps & { productUpdates?: boolean }) {
  return productUpdates ? <BellWithProductUpdates {...props} /> : <Bell {...props} />;
}
function BellWithProductUpdates(props: BellProps) {
  // Same single feature-inbox load/watch the separate Features bell used; no extra requests.
  const inbox = useFeatureNotifications();
  return (
    <>
      <Bell {...props} inbox={inbox} />
      <FeatureUpdateBanner inbox={inbox} />
    </>
  );
}
// #294: the counts are filters for the list below them; "All" again each time the bell opens.
type Filter = "all" | "mention" | "dm" | "reaction";
function Bell({ data, error, read, inbox }: BellProps & { inbox?: FeatureInbox }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [updatesOpen, setUpdatesOpen] = useState(false),
    [filter, setFilter] = useState<Filter>("all");
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null);
  // D-212: the closed bell reads only its numbers; while open it asks for the lists too.
  const wantLists = useOptionalSharedChatActivity()?.wantLists;
  useEffect(() => {
    if (!open || !wantLists) return;
    wantLists(true);
    return () => wantLists(false);
  }, [open, wantLists]);
  const reactionCount = data.reactionCount ?? 0;
  // D-327: unread first. Rows unread while the panel is open stay up top until it closes, so
  // reading one never makes the list jump; the next open puts it back among the read rows.
  const ordered = orderedChatNotifications(data);
  const [held, setHeld] = useState(noHeldNotifications);
  const holding = open ? holdUnreadNotifications(ordered, held) : noHeldNotifications;
  if (holding !== held) setHeld(holding);
  const items = unreadFirstNotifications(ordered, holding).filter(
    (item) => filter === "all" || item.kind === filter,
  );
  const updates = inbox?.unread ?? 0;
  const total = data.mentionCount + data.dmCount + reactionCount + updates;
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  async function act(body: Record<string, unknown>, after?: () => void) {
    setBusy(true);
    setFailure("");
    try {
      await read(body);
      after?.();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not mark read.");
    } finally {
      setBusy(false);
    }
  }
  function revisit(isRead: boolean, body: Record<string, unknown>, open: () => void) {
    if (isRead) open();
    else void act(body, open);
  }
  return (
    <div className={styles.root} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.bell}
        aria-label={`Chat notifications, ${data.mentionCount} room alerts, ${data.dmCount} unread DMs, ${reactionCount} reactions${inbox ? `, ${updates} product updates` : ""}`}
        aria-expanded={open}
        onClick={() => {
          // Product updates start expanded only when something in them is new.
          if (!open) {
            setUpdatesOpen(updates > 0);
            setFilter("all");
          }
          setOpen(!open);
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {total > 0 && (
          <span className={styles.badge} data-important={!!inbox?.important}>
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>
      {open && (
        <section className={styles.panel} aria-label="Chat notifications">
          <header>
            <strong>Chat notifications</strong>
            <button
              aria-label="Close chat notifications"
              onClick={() => {
                setOpen(false);
                button.current?.focus();
              }}
            >
              ×
            </button>
          </header>
          {inbox && (
            <details
              className={styles.updates}
              open={updatesOpen}
              onToggle={(event) => setUpdatesOpen(event.currentTarget.open)}
            >
              <summary>
                <span>Product updates</span>
                {updates > 0 && (
                  <span className={styles.badge} data-important={inbox.important}>
                    {updates > 99 ? "99+" : updates}
                  </span>
                )}
              </summary>
              <section aria-label="Product updates">
                <FeatureNotificationList inbox={inbox} devBoard onNavigate={() => setOpen(false)} />
              </section>
            </details>
          )}
          <div className={styles.filters} role="group" aria-label="Show">
            {(
              [
                ["all", "All", data.mentionCount + data.dmCount + reactionCount],
                ["mention", "Room alerts", data.mentionCount],
                ["dm", "Unread DMs", data.dmCount],
                ["reaction", "Reactions", reactionCount],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                aria-label={`${label}, ${count}`}
                onClick={() => setFilter(value)}
              >
                {label} <span className={styles.count}>{count > 99 ? "99+" : count}</span>
              </button>
            ))}
          </div>
          {(error || failure) && <p role="alert">{failure || error}</p>}
          <button
            disabled={busy || !total}
            onClick={() =>
              void act({
                kind: "all",
                mentionThrough: data.mentionThrough,
                dmThrough: data.dmThrough,
                reactionThrough: data.reactionThrough ?? 0,
              })
            }
          >
            Mark all as read
          </button>
          <label className={styles.preferences}>
            <input
              type="checkbox"
              checked={data.replyNotifications !== false}
              disabled={busy}
              onChange={(e) => void act({ kind: "preferences", replies: e.target.checked })}
            />{" "}
            Reply alerts in this inbox
          </label>
          <p>
            Notify me when someone replies to a conversation I started or joined. This setting affects future
            alerts; existing alerts stay in your inbox.
          </p>
          {items.map((item) => {
            if (item.kind === "mention") {
              const n = item.value;
              return (
                <article key={item.key} data-unread={!n.read}>
                  <button
                    className={styles.open}
                    disabled={busy}
                    onClick={() =>
                      revisit(n.read === true, { kind: "mention", id: n.id, mentionThrough: n.seq }, () => {
                        window.location.href = `/chat?room=${n.room}#chat-message-${n.messageId}`;
                      })
                    }
                  >
                    <strong>
                      {labels[n.room]} – {n.author} –{" "}
                      {n.category === "reply"
                        ? "replied"
                        : isRecordingRoom(n.room)
                          ? "posted a recording"
                          : isAnnouncementRoom(n.room)
                            ? "posted an announcement"
                            : "mentioned you"}
                    </strong>
                    <span className={styles.preview}>{n.preview || "Shared an attachment"}</span>
                    {n.category === "reply" && (
                      <span className={styles.context}>
                        Reply to: {n.parentPreview || "An attachment or deleted message"}
                      </span>
                    )}
                  </button>
                  {n.read ? (
                    <span className={styles.read}>Read</span>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => void act({ kind: "mention", id: n.id, mentionThrough: n.seq })}
                    >
                      Mark as read
                    </button>
                  )}
                </article>
              );
            }
            if (item.kind === "dm") {
              const dm = item.value;
              return (
                <article key={item.key} data-unread={dm.unread > 0}>
                  <button
                    className={styles.open}
                    disabled={busy}
                    onClick={() =>
                      revisit(dm.unread === 0, { kind: "dm", id: dm.id, dmThrough: dm.throughSeq }, () => {
                        setOpen(false);
                        window.dispatchEvent(new CustomEvent("chat-open-dm", { detail: dm.id }));
                      })
                    }
                  >
                    <strong>
                      DM – {dm.name} – {dm.pending ? "sent a request" : "sent a message"}{" "}
                      {dm.unread > 0 && <span className={styles.badge}>{dm.unread}</span>}
                    </strong>
                    <span className={styles.preview}>{dm.preview || "Open conversation"}</span>
                  </button>
                  {dm.unread === 0 ? (
                    <span className={styles.read}>Read</span>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() => void act({ kind: "dm", id: dm.id, dmThrough: dm.throughSeq })}
                    >
                      Mark as read
                    </button>
                  )}
                </article>
              );
            }
            const n = item.value;
            return (
              <article key={item.key} data-unread={!n.read}>
                <button
                  className={styles.open}
                  disabled={busy}
                  onClick={() =>
                    revisit(n.read === true, { kind: "reaction", id: n.id, reactionThrough: n.seq }, () => {
                      if (n.kind === "room")
                        window.location.href = `/chat?room=${n.room}#chat-message-${n.messageId}`;
                      else {
                        setOpen(false);
                        window.dispatchEvent(new CustomEvent("chat-open-dm", { detail: n.conversationId }));
                      }
                    })
                  }
                >
                  <strong>
                    {n.kind === "room" ? labels[n.room] : "DM"} – {n.author} – reacted{" "}
                    <ReactionIcon notification={n} />
                    <span className={styles.reactionLabel}>{CHAT_REACTION_LABELS[n.emoji]}</span>
                  </strong>
                  <span className={styles.preview}>{n.preview || "Shared an attachment"}</span>
                  <span className={styles.context}>Reaction to your message</span>
                </button>
                {n.read ? (
                  <span className={styles.read}>Read</span>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => void act({ kind: "reaction", id: n.id, reactionThrough: n.seq })}
                  >
                    Mark as read
                  </button>
                )}
              </article>
            );
          })}
          {(filter === "all" || filter === "mention") && !data.mentions.length && (
            <p>{data.mentionCount ? "Older room alerts are not shown here." : "No recent room alerts."}</p>
          )}
          {(filter === "all" || filter === "dm") && !data.dms.length && (
            <p>{data.dmCount ? "Older direct messages are not shown here." : "No recent direct messages."}</p>
          )}
          {(filter === "all" || filter === "reaction") && !(data.reactions ?? []).length && (
            <p>
              {reactionCount ? "Older reaction alerts are not shown here." : "No recent reaction alerts."}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
