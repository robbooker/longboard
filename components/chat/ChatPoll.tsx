"use client";
// #328 Polls: the poll card shown in place of a poll message's text, the shared poll store, and the
// "New poll" form for the room and thread composers. Polls are read in small batches as cards
// mount; a vote anywhere sends a "polls" signal on the room's realtime channel and only that card
// re-reads. Without a live connection the existing reconcile schedule (the "reactions" topic, the
// same one reactions use) keeps cards current; no timer of its own.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import { CHAT_POLL_EVENT, type ChatPollEventDetail } from "@/lib/chatRealtimeChannels";
import {
  nextPollSelection,
  pollQuestionFromBody,
  POLL_MAX_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  validatePollDraft,
  type ChatPoll,
} from "@/lib/chatPolls";
import { useChatUpdates } from "./ChatUpdates";
import styles from "./ChatPoll.module.css";

type Entry = ChatPoll | "none";
const keyOf = (room: ChatRoom, messageId: string) => `${room}:${messageId}`;

async function pollRequest(body: unknown, signal?: AbortSignal) {
  const response = await fetch("/api/chat/polls", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.message || "Polls are unavailable. Try again.");
  return data;
}

type Store = {
  get: (key: string) => Entry | undefined;
  set: (key: string, value: Entry) => void;
  subscribe: (key: string, listener: () => void) => () => void;
};
function pollStore(): Store {
  const rows = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    get: (key) => rows.get(key),
    set: (key, value) => {
      rows.set(key, value);
      listeners.get(key)?.forEach((listener) => listener());
    },
    subscribe: (key, listener) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      return () => set.delete(listener);
    },
  };
}

type PollContext = {
  store: Store;
  register: (room: ChatRoom, messageId: string) => () => void;
  vote: (room: ChatRoom, messageId: string, optionIds: string[]) => Promise<void>;
  close: (room: ChatRoom, messageId: string) => Promise<void>;
  seed: (room: ChatRoom, poll: ChatPoll) => void;
};
const Context = createContext<PollContext | null>(null);
export const useChatPolls = () => useContext(Context);

/** One per chat shell, next to the reactions provider. */
export function ChatPollProvider({ children }: { children: ReactNode }) {
  const updates = useChatUpdates();
  const [store] = useState(pollStore);
  const targets = useRef(new Map<string, { room: ChatRoom; messageId: string; count: number }>());
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Writes bump the version so a read that started before them can't put older counts back.
  const version = useRef(0);
  const read = useCallback(
    async (keys: string[]) => {
      const started = version.current;
      const byRoom = new Map<ChatRoom, string[]>();
      for (const key of keys) {
        const target = targets.current.get(key);
        if (target) byRoom.set(target.room, [...(byRoom.get(target.room) ?? []), target.messageId]);
      }
      await Promise.all(
        [...byRoom].flatMap(([room, ids]) =>
          Array.from({ length: Math.ceil(ids.length / 100) }, (_, i) =>
            ids.slice(i * 100, i * 100 + 100),
          ).map(async (batch) => {
            try {
              const { polls } = (await pollRequest({ action: "read", room, messageIds: batch })) as {
                polls: ChatPoll[];
              };
              if (started !== version.current) return;
              const found = new Map(polls.map((poll) => [poll.messageId, poll]));
              for (const id of batch) store.set(keyOf(room, id), found.get(id) ?? "none");
            } catch {
              // Cards keep what they show; a card never read falls back to the message text.
              for (const id of batch) if (!store.get(keyOf(room, id))) store.set(keyOf(room, id), "none");
            }
          }),
        ),
      );
    },
    [store],
  );
  const queue = useCallback(
    (key: string) => {
      pending.current.add(key);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const keys = [...pending.current];
        pending.current.clear();
        if (keys.length) void read(keys);
      }, 50);
    },
    [read],
  );
  const register = useCallback(
    (room: ChatRoom, messageId: string) => {
      const key = keyOf(room, messageId);
      const item = targets.current.get(key);
      targets.current.set(key, { room, messageId, count: (item?.count ?? 0) + 1 });
      if (!item) queue(key);
      return () => {
        const now = targets.current.get(key);
        if (now && now.count > 1) now.count--;
        else targets.current.delete(key);
      };
    },
    [queue],
  );
  useEffect(() => {
    const signal = (event: Event) => {
      const { room, messageId } = (event as CustomEvent<ChatPollEventDetail>).detail ?? {};
      if (room && messageId && targets.current.has(keyOf(room, messageId))) queue(keyOf(room, messageId));
    };
    window.addEventListener(CHAT_POLL_EVENT, signal);
    // Reconciles on the reactions schedule: every 5 s while not live, every minute while live, and
    // after reconnects. Nothing is read while no poll is on screen.
    const stop = updates?.watch(
      async () => {
        if (targets.current.size && !document.hidden) await read([...targets.current.keys()]);
      },
      ["reactions"],
      false,
      5000,
      60000,
      "rooms",
    );
    return () => {
      window.removeEventListener(CHAT_POLL_EVENT, signal);
      clearTimeout(timer.current);
      stop?.();
    };
  }, [queue, read, updates]);
  const write = useCallback(
    async (room: ChatRoom, messageId: string, body: Record<string, unknown>) => {
      version.current++;
      const { poll } = (await pollRequest({ room, messageId, ...body })) as { poll: ChatPoll | null };
      version.current++;
      store.set(keyOf(room, messageId), poll ?? "none");
    },
    [store],
  );
  const context = useMemo<PollContext>(
    () => ({
      store,
      register,
      vote: (room, messageId, optionIds) => write(room, messageId, { action: "vote", optionIds }),
      close: (room, messageId) => write(room, messageId, { action: "close" }),
      seed: (room, poll) => {
        version.current++;
        store.set(keyOf(room, poll.messageId), poll);
      },
    }),
    [store, register, write],
  );
  return <Context.Provider value={context}>{children}</Context.Provider>;
}

const noSubscribe = () => () => undefined;

/**
 * The poll on a "📊 Poll: …" message. Until it is read it shows the question; a message that turns
 * out not to be a poll shows `fallback` (its ordinary text).
 */
export function ChatPollCard({
  room,
  messageId,
  body,
  disabled = false,
  fallback,
}: {
  room: ChatRoom;
  messageId: string;
  body: string;
  /** No voting (paused room, no member name yet). */
  disabled?: boolean;
  fallback: ReactNode;
}) {
  const context = useContext(Context);
  const key = keyOf(room, messageId);
  const entry = useSyncExternalStore(
    context ? (listener) => context.store.subscribe(key, listener) : noSubscribe,
    () => context?.store.get(key),
    () => undefined,
  );
  const register = context?.register;
  useEffect(() => register?.(room, messageId), [register, room, messageId]);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const headingId = useId();
  if (!context || entry === "none") return <>{fallback}</>;
  if (!entry)
    return (
      <section
        className={styles.poll}
        aria-busy="true"
        aria-labelledby={headingId}
        data-poll-message={messageId}
      >
        <p className={styles.kind}>Poll</p>
        <h3 id={headingId} className={styles.question}>
          {pollQuestionFromBody(body)}
        </h3>
        <p className={styles.note}>Loading poll…</p>
      </section>
    );
  const poll = entry;
  const voted = poll.myVotes.length > 0;
  // Choosing: not voted yet on an open poll, or changing a vote.
  const choosing = !poll.closed && (!voted || selection !== null);
  const chosen = selection ?? (voted ? poll.myVotes : []);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      setSelection(null);
      setConfirmClose(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Polls are unavailable. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const submit = (optionIds: string[]) => run(() => context.vote(room, messageId, optionIds));
  const pick = (optionId: string) => {
    if (disabled || busy) return;
    // One answer, first vote: a tap votes, like Telegram.
    if (!poll.multi && !voted) return void submit([optionId]);
    setSelection(nextPollSelection({ multi: poll.multi, myVotes: chosen }, optionId));
  };
  const changed =
    selection !== null &&
    (selection.length !== poll.myVotes.length || selection.some((id) => !poll.myVotes.includes(id)));
  const kind = [
    poll.closed ? "Final results" : "Poll",
    poll.anonymous ? "Anonymous" : "Visible votes",
    poll.multi ? "Several answers" : "One answer",
  ].join(" · ");
  return (
    <section
      className={styles.poll}
      aria-labelledby={headingId}
      data-poll-message={messageId}
      data-poll-closed={poll.closed || undefined}
      data-poll-results={poll.results || undefined}
    >
      <p className={styles.kind}>{kind}</p>
      <h3 id={headingId} className={styles.question}>
        {poll.question}
      </h3>
      {choosing ? (
        <div
          className={styles.choices}
          role="group"
          aria-label={poll.multi ? "Choose one or more answers" : "Choose one answer"}
        >
          {poll.options.map((option) => {
            const on = chosen.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                className={styles.choice}
                aria-pressed={on}
                data-poll-option={option.id}
                disabled={disabled || busy}
                onClick={() => pick(option.id)}
              >
                <span className={styles.mark} data-multi={poll.multi || undefined} aria-hidden="true" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <ol className={styles.results} aria-label="Results">
          {poll.options.map((option) => {
            const mine = poll.myVotes.includes(option.id);
            return (
              <li key={option.id} data-poll-result={option.id} data-mine={mine || undefined}>
                <div className={styles.resultLine}>
                  <span className={styles.percent}>{option.percent ?? 0}%</span>
                  <span className={styles.label}>
                    {option.label}
                    {mine && <span className={styles.yours}> ✓ your vote</span>}
                  </span>
                  <span className={styles.count}>
                    {option.votes ?? 0} {option.votes === 1 ? "vote" : "votes"}
                  </span>
                </div>
                <span className={styles.bar} aria-hidden="true">
                  <span style={{ width: `${option.percent ?? 0}%` }} />
                </span>
                {option.people && option.people.length > 0 && (
                  <p className={styles.people} data-poll-people>
                    {option.people.map((person) => person.name).join(", ")}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className={styles.footer}>
        <span className={styles.total} data-poll-total>
          {poll.results
            ? `${poll.total ?? 0} ${poll.total === 1 ? "person" : "people"} voted`
            : "Vote to see the results"}
        </span>
        {choosing && (poll.multi || voted) && (
          <button
            type="button"
            className={styles.primary}
            disabled={disabled || busy || !chosen.length || (voted && !changed)}
            onClick={() => void submit(chosen)}
          >
            {voted ? "Save vote" : "Vote"}
          </button>
        )}
        {choosing && voted && (
          <button type="button" disabled={busy} onClick={() => setSelection(null)}>
            Cancel
          </button>
        )}
        {!choosing && voted && !poll.closed && (
          <>
            <button type="button" disabled={disabled || busy} onClick={() => setSelection(poll.myVotes)}>
              Change vote
            </button>
            <button type="button" disabled={disabled || busy} onClick={() => void submit([])}>
              Take back vote
            </button>
          </>
        )}
        {poll.canClose &&
          (confirmClose ? (
            <span className={styles.confirm} role="group" aria-label="Close this poll?">
              <span>Close it? No one can vote after.</span>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => void run(() => context.close(room, messageId))}
              >
                Close poll
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirmClose(false)}>
                Keep open
              </button>
            </span>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmClose(true)}>
              Close poll…
            </button>
          ))}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * "New poll": a question, 2–10 answers, anonymous (default) or visible votes, one or several
 * answers. Sent as a message in the room, or in the thread when `replyTo` is set.
 */
export function ChatPollComposer({
  room,
  replyTo,
  open,
  onClose,
  onCreated,
}: {
  room: ChatRoom;
  replyTo?: string | null;
  open: boolean;
  onClose: () => void;
  onCreated?: (message: PublicChatMessage) => void;
}) {
  const context = useContext(Context);
  const dialog = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [anonymous, setAnonymous] = useState(true);
  const [multi, setMulti] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clientId = useRef<string | null>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) {
      node.showModal();
      node.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    }
    if (!open && node?.open) node.close();
  }, [open]);
  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    setAnonymous(true);
    setMulti(false);
    setError("");
    clientId.current = null;
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const draft = validatePollDraft({ question, options, anonymous, multi });
    if (!draft.ok) return setError(draft.error);
    setBusy(true);
    setError("");
    // Kept across retries of this draft, so a retry after a lost answer is the same poll.
    clientId.current ??= crypto.randomUUID();
    try {
      const data = (await pollRequest({
        action: "create",
        room,
        ...draft.poll,
        ...(replyTo ? { replyTo } : {}),
        clientId: clientId.current,
      })) as { message: PublicChatMessage; poll: ChatPoll | null };
      if (data.poll) context?.seed(room, data.poll);
      // The room and the open thread merge it exactly like a live message from someone else.
      window.dispatchEvent(
        new CustomEvent("chat-room-event", { detail: { eventType: "INSERT", new: data.message, old: {} } }),
      );
      onCreated?.(data.message);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The poll didn't send. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={styles.composer}
      aria-labelledby={`${id}-title`}
      data-poll-composer
      // Closing (Cancel, Escape, or after sending) starts the next poll empty.
      onClose={() => {
        reset();
        onClose();
      }}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <form onSubmit={submit}>
        <h2 id={`${id}-title`}>{replyTo ? "New poll in this thread" : "New poll"}</h2>
        <label className={styles.field}>
          <span>Question</span>
          <textarea
            value={question}
            maxLength={POLL_QUESTION_MAX}
            rows={2}
            placeholder="Ask a question"
            onChange={(event) => setQuestion(event.target.value)}
          />
        </label>
        <fieldset className={styles.answers}>
          <legend>Answers</legend>
          {options.map((value, index) => (
            <div key={index} className={styles.answer}>
              <input
                value={value}
                maxLength={POLL_OPTION_MAX}
                aria-label={`Answer ${index + 1}`}
                placeholder={`Answer ${index + 1}`}
                onChange={(event) =>
                  setOptions((current) => current.map((o, i) => (i === index ? event.target.value : o)))
                }
              />
              {options.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove answer ${index + 1}`}
                  onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {options.length < POLL_MAX_OPTIONS && (
            <button type="button" className={styles.addAnswer} onClick={() => setOptions((c) => [...c, ""])}>
              + Add an answer
            </button>
          )}
        </fieldset>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(event) => setAnonymous(event.target.checked)}
          />
          <span>
            Anonymous voting
            <small>
              {anonymous ? "No one sees who voted for what." : "Everyone sees who voted for each answer."}
            </small>
          </span>
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={multi} onChange={(event) => setMulti(event.target.checked)} />
          <span>
            Allow several answers
            <small>{multi ? "People can pick more than one." : "People pick one answer."}</small>
          </span>
        </label>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy ? "Sending…" : "Send poll"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
