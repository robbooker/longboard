"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Image from "next/image";
import {
  CHAT_REACTIONS,
  CHAT_REACTION_LABELS,
  isChatReaction,
  type ChatReaction,
} from "@/lib/chatMessageReactions";
import { createPortal } from "react-dom";
import type { ChatRoom } from "@/lib/publicChat";
import { CHAT_REACTION_EVENT, type ChatReactionEventDetail } from "@/lib/chatRealtimeChannels";
import { useChatUpdates } from "./ChatUpdates";
import styles from "./MessageReactions.module.css";
import ReactionDetails from "./ReactionDetails";
export type ReactionTarget = ({ kind: "room"; room: ChatRoom } | { kind: "dm"; conversationId: string }) & {
  messageId: string;
};
type Emoji = ChatReaction;
type Summary = { emoji: Emoji; count: number; mine: boolean; names: string[] };
const keyOf = (target: ReactionTarget) =>
  JSON.stringify(
    target.kind === "room"
      ? [target.kind, target.room, target.messageId]
      : [target.kind, target.conversationId, target.messageId],
  );
async function request(body: unknown, signal?: AbortSignal) {
  const r = await fetch("/api/chat/message-reactions", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      data.error === "chat_paused"
        ? "Reactions are paused in this room."
        : "Reactions unavailable. Refresh or try again.",
    );
  return data.messages as Record<string, Summary[]>;
}
/**
 * Summaries live outside React state: each message subscribes to its own key, so a batch read
 * re-renders the messages it changed, not every message on the page (a long DM has 1,000+).
 */
type SummaryStore = {
  get: () => Record<string, Summary[]>;
  update: (change: (current: Record<string, Summary[]>) => Record<string, Summary[]>) => void;
  subscribe: (listener: () => void) => () => void;
};
function summaryStore(): SummaryStore {
  let rows: Record<string, Summary[]> = {};
  const listeners = new Set<() => void>();
  return {
    get: () => rows,
    update: (change) => {
      rows = change(rows);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
const NO_SUMMARIES: Summary[] = [];
const noStore = () => () => undefined;
const Context = createContext<{
  store: SummaryStore;
  register: (target: ReactionTarget) => () => void;
  set: (target: ReactionTarget, emoji: Emoji, active: boolean) => Promise<void>;
} | null>(null);
/** Groups targets by room or DM into batches of at most 100 for one read request each. */
function batches(list: Iterable<ReactionTarget>) {
  const groups = new Map<string, ReactionTarget[]>();
  for (const target of list) {
    const group = target.kind === "room" ? `room:${target.room}` : `dm:${target.conversationId}`;
    groups.set(group, [...(groups.get(group) ?? []), target]);
  }
  return [...groups.values()].flatMap((group) =>
    Array.from({ length: Math.ceil(group.length / 100) }, (_, i) => group.slice(i * 100, i * 100 + 100)),
  );
}
/**
 * One scheduler per chat shell. Messages entering the viewport are read in one small batch;
 * a full reload of what is on screen happens only on reaction/DM signals and reconciles.
 */
export function MessageReactionProvider({ children }: { children: ReactNode }) {
  const updates = useChatUpdates();
  const targets = useRef(new Map<string, { target: ReactionTarget; count: number }>());
  const version = useRef(0);
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const reading = useRef<AbortController | null>(null);
  const readingDirect = useRef<AbortController | null>(null);
  const controllers = useRef(new Set<AbortController>());
  const [store] = useState(summaryStore);
  const read = useCallback(
    async (list: ReactionTarget[], controller: AbortController) => {
      const revision = version.current;
      controllers.current.add(controller);
      const apply = (batch: ReactionTarget[], result: Record<string, Summary[]>) => {
        if (alive.current && !controller.signal.aborted && revision === version.current)
          store.update((current) => ({
            ...current,
            ...Object.fromEntries(batch.map((t) => [keyOf(t), result[t.messageId] ?? []])),
          }));
      };
      await Promise.all(
        batches(list).map(async (batch) => {
          try {
            apply(
              batch,
              await request(
                { ...batch[0], action: "read", messageIds: batch.map((t) => t.messageId) },
                controller.signal,
              ),
            );
          } catch {
            apply(batch, {});
          }
        }),
      );
      controllers.current.delete(controller);
    },
    [store],
  );
  // Everything on screen: reaction or DM signals, reconciles and returning to the tab.
  // Timed reloads leave DM messages to loadDirect.
  const load = useCallback(
    async (why?: string) => {
      reading.current?.abort();
      if (document.hidden) return;
      const controller = new AbortController();
      reading.current = controller;
      const list = [...targets.current.values()].flatMap(({ target }) =>
        why === "timer" && target.kind === "dm" ? [] : [target],
      );
      list.forEach((target) => pending.current.delete(keyOf(target)));
      await read(list, controller);
    },
    [read],
  );
  // DM reactions are never pushed live, so on-screen DM messages keep the 5 s reload.
  const loadDirect = useCallback(
    async (why: string) => {
      if (why !== "timer" || document.hidden) return;
      const list = [...targets.current.values()].flatMap(({ target }) =>
        target.kind === "dm" ? [target] : [],
      );
      if (!list.length) return;
      readingDirect.current?.abort();
      const controller = new AbortController();
      readingDirect.current = controller;
      await read(list, controller);
    },
    [read],
  );
  // Only messages that just appeared or were just signalled.
  const queue = useCallback(
    (key: string) => {
      pending.current.add(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const list = [...pending.current].flatMap((key) => targets.current.get(key)?.target ?? []);
        pending.current.clear();
        if (list.length && !document.hidden) void read(list, new AbortController());
      }, 50);
    },
    [read],
  );
  const register = useCallback(
    (target: ReactionTarget) => {
      const key = keyOf(target);
      const item = targets.current.get(key);
      targets.current.set(key, { target, count: (item?.count ?? 0) + 1 });
      if (!item) queue(key);
      return () => {
        const item = targets.current.get(key);
        if (item && item.count > 1) item.count--;
        else targets.current.delete(key); // Its last summary stays cached for when it scrolls back.
      };
    },
    [queue],
  );
  useEffect(() => {
    alive.current = true;
    const live = controllers.current;
    // Every 5 s without a live connection; while live, room reactions arrive per message
    // (CHAT_REACTION_EVENT) and "reactions" covers older servers that send no message id.
    const stop = updates?.watch(load, ["inbox", "reactions"], false, 5000, 30000);
    const stopDirect = updates?.watch(loadDirect, [], false, 5000);
    if (!updates) void load();
    const visibility = () => {
      if (document.hidden) {
        reading.current?.abort();
        readingDirect.current?.abort();
      } else void load("visible");
    };
    const signal = (event: Event) => {
      const { room, messageId } = (event as CustomEvent<ChatReactionEventDetail>).detail ?? {};
      const key = room && messageId ? keyOf({ kind: "room", room, messageId }) : "";
      if (targets.current.has(key)) queue(key);
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener(CHAT_REACTION_EVENT, signal);
    return () => {
      alive.current = false;
      reading.current?.abort();
      readingDirect.current?.abort();
      live.forEach((controller) => controller.abort());
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener(CHAT_REACTION_EVENT, signal);
      stop?.();
      stopDirect?.();
    };
  }, [load, loadDirect, queue, updates]);
  const set = useCallback(
    async (target: ReactionTarget, emoji: Emoji, active: boolean) => {
      version.current++;
      const result = await request({ ...target, action: "set", emoji, active });
      version.current++;
      if (alive.current && targets.current.has(keyOf(target)))
        store.update((current) => ({ ...current, [keyOf(target)]: result[target.messageId] ?? [] }));
      updates?.invalidate(target.kind === "room" ? "room" : "inbox");
    },
    [updates, store],
  );
  const context = useMemo(() => ({ store, register, set }), [store, register, set]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export default function MessageReactions({
  target,
  disabled = false,
  active = true,
  compact = false,
}: {
  target: ReactionTarget;
  disabled?: boolean;
  active?: boolean;
  compact?: boolean;
}) {
  const context = useContext(Context);
  const key = keyOf(target);
  const stableTarget = useMemo(() => {
    const [kind, scope, messageId] = JSON.parse(key);
    return (
      kind === "room" ? { kind, room: scope, messageId } : { kind, conversationId: scope, messageId }
    ) as ReactionTarget;
  }, [key]); // identity is the serialized scope, never message text
  const anchor = useRef<HTMLDivElement>(null);
  const [triggerHost, setTriggerHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setTriggerHost(
      compact
        ? (anchor.current?.closest("article")?.querySelector<HTMLElement>("[data-dm-reaction-host]") ?? null)
        : null,
    );
  }, [compact, key]);
  const trigger = useRef<HTMLButtonElement>(null);
  const register = context?.register;
  useEffect(() => {
    if (!active || !register || !(triggerHost ? trigger.current : anchor.current)) return;
    let remove: (() => void) | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        remove ??= register(stableTarget);
      } else {
        remove?.();
        remove = undefined;
      }
    });
    observer.observe((compact ? anchor.current?.closest("article") : anchor.current) ?? trigger.current!);
    return () => {
      observer.disconnect();
      remove?.();
    };
  }, [active, register, stableTarget, triggerHost, compact]);
  const restoreFocus = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const id = useId();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!busy && restoreFocus.current) {
      restoreFocus.current = false;
      if (document.activeElement === document.body || anchor.current?.contains(document.activeElement))
        trigger.current?.focus({ preventScroll: true });
    }
  }, [busy, isOpen]);
  // UI-REACTION-BAR: a small bar beside the button instead of a modal. It floats (fixed) so a
  // scrolling list or a narrow panel can't clip it, and closes on Escape or an outside tap.
  useEffect(() => {
    const bar = dialog.current;
    if (!isOpen || !bar) return;
    bar.show();
    const place = () => {
      const from = (trigger.current ?? anchor.current)?.getBoundingClientRect();
      if (!from) return;
      const size = bar.getBoundingClientRect(),
        gap = 8;
      const left = Math.min(Math.max(gap, from.right - size.width), window.innerWidth - size.width - gap);
      const above = from.top - size.height - gap;
      bar.style.left = `${left}px`;
      bar.style.top = `${above >= gap ? above : Math.min(from.bottom + gap, window.innerHeight - size.height - gap)}px`;
    };
    place();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!bar.contains(target) && !trigger.current?.contains(target)) close();
    };
    // Scrolling moves the bar with its button; it closes once the button leaves the screen.
    const scrolled = (event: Event) => {
      if (bar.contains(event.target as Node)) return;
      const from = (trigger.current ?? anchor.current)?.getBoundingClientRect();
      if (!from || from.bottom < 0 || from.top > window.innerHeight) close();
      else place();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", place);
    };
    // close() only touches refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  useEffect(() => {
    setIsOpen(false);
  }, [key]);
  useEffect(() => {
    if (isOpen && (!active || disabled || !context)) {
      dialog.current?.close();
      setIsOpen(false);
    }
  }, [isOpen, active, disabled, context]);
  function close() {
    restoreFocus.current = !!dialog.current?.open;
    dialog.current?.close();
    setIsOpen(false);
  }
  const summaries = useSyncExternalStore(
    context?.store.subscribe ?? noStore,
    () => context?.store.get()[key] ?? NO_SUMMARIES,
    () => NO_SUMMARIES,
  );
  const rows = summaries.filter((row) => isChatReaction(row.emoji));
  // POLISH-REST: a chip that appears after this message's reactions loaded scales in; the chips
  // it loaded with (and any after a scroll-back remount) do not.
  const settled = useRef<{ key: string; emojis: Set<string> } | null>(null);
  if (settled.current?.key !== key) settled.current = null;
  if (!settled.current && summaries !== NO_SUMMARIES)
    settled.current = { key, emojis: new Set(rows.filter((r) => r.count > 0).map((r) => r.emoji)) };
  if (settled.current)
    for (const emoji of settled.current.emojis)
      if (!rows.some((r) => r.emoji === emoji && r.count > 0)) settled.current.emojis.delete(emoji);
  const icon = (emoji: Emoji) =>
    emoji === "rob" ? (
      <Image
        src="/chat/reactions/rob.png"
        alt=""
        aria-hidden="true"
        width={28}
        height={28}
        sizes="28px"
        draggable={false}
        className={styles.robIcon}
      />
    ) : emoji === "heart" ? (
      "❤️"
    ) : emoji === "laugh" ? (
      "😂"
    ) : target.kind === "room" ? (
      target.room.startsWith("ss-") || target.room === "shortscout" ? (
        "🍋"
      ) : (
        "🌴"
      )
    ) : (
      "👍"
    );
  async function toggle(emoji: Emoji) {
    if (!active || disabled || busy || !context) return;
    setBusy(true);
    setError("");
    try {
      await context.set(target, emoji, !rows.find((r) => r.emoji === emoji)?.mine);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save reaction.");
    } finally {
      setBusy(false);
    }
  }
  const [details, setDetails] = useState<Emoji | null>(null);
  const detailsTrigger = useRef<HTMLButtonElement | null>(null);
  const hold = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  function cancelHold() {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  }
  function showDetails(emoji: Emoji, button: HTMLButtonElement) {
    cancelHold();
    detailsTrigger.current = button;
    setDetails(emoji);
  }
  function closeDetails() {
    setDetails(null);
  }
  useLayoutEffect(() => {
    if (!details && detailsTrigger.current) {
      detailsTrigger.current.focus({ preventScroll: true });
      detailsTrigger.current = null;
    }
  }, [details]);
  useEffect(() => {
    setDetails(null);
    cancelHold();
    return cancelHold;
  }, [key, active]);
  const add = (
    <button
      ref={trigger}
      type="button"
      className={compact ? styles.compactAdd : styles.add}
      aria-label="Add reaction"
      title="Add reaction"
      disabled={!active || disabled || busy || !context}
      onClick={() => {
        setError("");
        restoreFocus.current = false;
        setIsOpen(true);
      }}
    >
      {compact ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M20.5 11.5a8.5 8.5 0 1 1-7-8.37" />
          <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01M19 2.5v6M16 5.5h6" />
        </svg>
      ) : (
        <>
          ＋ <span>Add reaction</span>
        </>
      )}
    </button>
  );
  return (
    <div
      ref={anchor}
      className={`${styles.footer} ${compact ? styles.compact : ""}`}
      data-empty={rows.every((r) => r.count <= 0) && !error}
      data-reaction-message={target.messageId}
      onKeyDown={(event) => {
        if (event.key === "Escape" && dialog.current?.open) event.stopPropagation();
      }}
    >
      {rows
        .filter((r) => r.count > 0)
        .map((r) => (
          <button
            type="button"
            key={r.emoji}
            className={styles.chip}
            data-fresh={(settled.current && !settled.current.emojis.has(r.emoji)) || undefined}
            disabled={disabled || busy}
            aria-pressed={r.mine}
            aria-label={`${r.mine ? "Remove" : "Add"} ${r.emoji} reaction, ${r.count}. ${r.names.join(", ")}${r.count > r.names.length ? ", and more" : ""}. Hold or press Shift+F10 to see everyone who reacted.`}
            title={`${r.names.join(", ")}. Hold or press Shift+F10 to see reactions`}
            aria-haspopup="dialog"
            aria-keyshortcuts="Shift+F10"
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary) return;
              cancelHold();
              suppressClick.current = false;
              const button = event.currentTarget;
              hold.current = {
                x: event.clientX,
                y: event.clientY,
                timer: setTimeout(() => {
                  suppressClick.current = true;
                  showDetails(r.emoji, button);
                }, 500),
              };
            }}
            onPointerMove={(event) => {
              if (
                hold.current &&
                Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y) > 10
              )
                cancelHold();
            }}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            onPointerLeave={cancelHold}
            onContextMenu={(event) => {
              event.preventDefault();
              suppressClick.current = true;
              showDetails(r.emoji, event.currentTarget);
            }}
            onKeyDown={(event) => {
              if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                event.preventDefault();
                showDetails(r.emoji, event.currentTarget);
              } else if (event.key === "Enter" || event.key === " ") suppressClick.current = false;
            }}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              void toggle(r.emoji);
            }}
          >
            {icon(r.emoji)} {r.count}
          </button>
        ))}
      {details && active && (
        <ReactionDetails
          key={`${key}:${details}`}
          target={stableTarget}
          emoji={details}
          icon={icon(details)}
          anchor={detailsTrigger}
          onClose={closeDetails}
        />
      )}
      {triggerHost ? createPortal(add, triggerHost) : add}
      {error && !isOpen && <span role="alert">{error}</span>}
      {isOpen && (
        <dialog
          ref={dialog}
          className={styles.picker}
          aria-labelledby={id}
          onClose={() => setIsOpen(false)}
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) close();
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            if (!busy) close();
          }}
        >
          <h2 id={id}>Add reaction</h2>
          <div className={styles.options}>
            {CHAT_REACTIONS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                aria-label={`${emoji} reaction`}
                aria-pressed={!!rows.find((r) => r.emoji === emoji)?.mine}
                disabled={disabled || busy}
                title={CHAT_REACTION_LABELS[emoji]}
                onClick={() => void toggle(emoji)}
              >
                {icon(emoji)}
                <span>{CHAT_REACTION_LABELS[emoji]}</span>
              </button>
            ))}
          </div>
          {error && <p role="alert">{error}</p>}
          <button type="button" disabled={busy} onClick={close}>
            Close
          </button>
        </dialog>
      )}
    </div>
  );
}
