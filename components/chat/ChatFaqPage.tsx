"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  FAQ_ANSWER_MAX,
  FAQ_QUESTION_MAX,
  FAQ_TOPIC_MAX,
  faqAnchorId,
  faqIdFromHash,
  faqItemTitle,
  faqToggleAllLabel,
  searchFaqItems,
  toggleAllFaqOpen,
  toggleFaqOpen,
  type ChatFaqItem,
} from "@/lib/chatFaq";
import { tokenizeChatMessage } from "@/lib/publicChat";
import { takeLinkedFaqHash } from "./hooks/useChatPages";
import pageStyles from "./ChatPageView.module.css";
import styles from "./ChatFaqPage.module.css";

// #332 LB-FAQ: the FAQ, a page rather than a room: questions with their answers and a search box
// over only these items. Admins add, edit and remove items here (the routes enforce it). "Suggest a
// topic" posts to the private Admins room and, #338, waits for review on Marketing HQ; a suggestion only
// reaches this page when an admin approves it. Admins get the same button, so they can try the process.
// #411: only the questions show at first; each opens and closes its own answer (+ / −), one button opens
// or closes them all, a search opens the answers it finds, and /chat?page=faq#faq-<id> opens one question.

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string" && data.error.includes(" ")
        ? data.error
        : "That didn't work. Please try again.",
    );
  return data;
}

/** Plain text: React escapes it, line breaks come from CSS and only http(s) addresses become links. */
function Answer({ text }: { text: string }) {
  return (
    <p className={styles.answer}>
      {tokenizeChatMessage(text).map((part, index) =>
        part.kind === "link" ? (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.value}
          </a>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </p>
  );
}

/**
 * One question and its answer. The answer is hidden="until-found" while closed, so the browser's own
 * find-in-page still reaches it and opens it (beforematch); where that isn't supported it is plain hidden.
 */
function FaqEntry({
  item,
  open,
  onToggle,
  onReveal,
  children,
}: {
  item: ChatFaqItem;
  open: boolean;
  onToggle: (id: string) => void;
  onReveal: (id: string) => void;
  children: ReactNode;
}) {
  const region = useRef<HTMLDivElement>(null);
  const anchor = faqAnchorId(item.id);
  useLayoutEffect(() => {
    const element = region.current;
    if (!element) return;
    if (open) element.removeAttribute("hidden");
    else element.setAttribute("hidden", "until-found");
  }, [open]);
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    const reveal = () => onReveal(item.id);
    element.addEventListener("beforematch", reveal);
    return () => element.removeEventListener("beforematch", reveal);
  }, [item.id, onReveal]);
  return (
    <>
      <h2 className={styles.question}>
        <button
          type="button"
          id={`${anchor}-question`}
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={`${anchor}-answer`}
          onClick={() => onToggle(item.id)}
          data-faq-toggle
        >
          <span className={styles.questionText} data-faq-question>
            {faqItemTitle(item)}
          </span>
          <span className={styles.sign} aria-hidden="true" data-faq-sign>
            {open ? "\u2212" : "+"}
          </span>
        </button>
      </h2>
      <div
        ref={region}
        id={`${anchor}-answer`}
        role="region"
        aria-labelledby={`${anchor}-question`}
        className={styles.answerBox}
        data-faq-answer
      >
        <div className={styles.answerInner}>{children}</div>
      </div>
    </>
  );
}

function ItemForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { question: string; answer: string; topic: string };
  submitLabel: string;
  onSubmit: (draft: { question: string; answer: string; topic: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onSubmit(draft);
    } catch (caught) {
      setError((caught as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className={styles.form} onSubmit={submit} noValidate data-faq-form>
      <label>
        Question
        <input
          value={draft.question}
          maxLength={FAQ_QUESTION_MAX}
          onChange={(event) => setDraft({ ...draft, question: event.target.value })}
        />
      </label>
      <label>
        Topic (optional)
        <input
          value={draft.topic}
          maxLength={FAQ_TOPIC_MAX}
          onChange={(event) => setDraft({ ...draft, topic: event.target.value })}
          data-faq-topic
        />
      </label>
      <label>
        Answer
        <textarea
          value={draft.answer}
          maxLength={FAQ_ANSWER_MAX}
          onChange={(event) => setDraft({ ...draft, answer: event.target.value })}
        />
      </label>
      {error && (
        <p className={pageStyles.error} role="alert">
          {error}
        </p>
      )}
      <div className={pageStyles.formActions}>
        <button type="submit" className={pageStyles.primary} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className={pageStyles.quiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SuggestTopic() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await send("/api/chat/faq/suggestions", "POST", { topic });
      setTopic("");
      setOpen(false);
      setSent(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <>
        {sent && (
          <p className={styles.thanks} role="status">
            Thanks. Your suggestion went to the admins.
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={`${pageStyles.button} ${pageStyles.suggest}`}
            onClick={() => {
              setSent(false);
              setOpen(true);
            }}
          >
            Suggest a topic
          </button>
        </div>
      </>
    );
  return (
    <form className={`${styles.form} ${styles.formBox}`} onSubmit={submit} noValidate data-faq-suggest>
      <label>
        What should the FAQ cover? Your suggestion and your chat name go to the admins.
        <input
          value={topic}
          maxLength={FAQ_QUESTION_MAX}
          autoFocus
          onChange={(event) => setTopic(event.target.value)}
        />
      </label>
      {error && (
        <p className={pageStyles.error} role="alert">
          {error}
        </p>
      )}
      <div className={pageStyles.formActions}>
        <button type="submit" className={pageStyles.primary} disabled={busy}>
          {busy ? "Sending…" : "Send to admins"}
        </button>
        <button type="button" className={pageStyles.quiet} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ChatFaqPage() {
  const [items, setItems] = useState<ChatFaqItem[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  // #411: the questions whose answers are open; none at first. A search opens what it finds and
  // clearing it puts back what was open before.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const beforeSearch = useRef<Set<string> | null>(null);
  const [scrollTo, setScrollTo] = useState<{ id: string } | null>(null);
  const toggle = useCallback((id: string) => setOpen((current) => toggleFaqOpen(current, id)), []);
  const reveal = useCallback(
    (id: string) => setOpen((current) => (current.has(id) ? current : new Set(current).add(id))),
    [],
  );
  // A link to one question: open it and scroll to it, once the items are here.
  const goTo = useCallback(
    (hash: string, list: ChatFaqItem[]) => {
      const id = faqIdFromHash(hash);
      if (!id || !list.some((item) => item.id === id)) return;
      reveal(id);
      setScrollTo({ id });
    },
    [reveal],
  );
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/chat/faq", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body) => {
        const list: ChatFaqItem[] = Array.isArray(body.items) ? body.items : [];
        setItems(list);
        setCanManage(body.canManage === true);
        const linked = takeLinkedFaqHash();
        goTo(faqIdFromHash(window.location.hash) ? window.location.hash : linked, list);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [goTo]);
  // A question's link followed while the FAQ is open (a link in a message, or Back to one).
  useEffect(() => {
    if (!items) return;
    const follow = () => goTo(window.location.hash, items);
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [items, goTo]);
  useEffect(() => {
    if (!scrollTo) return;
    const entry = document.getElementById(faqAnchorId(scrollTo.id));
    entry?.scrollIntoView({ block: "start" });
    entry?.querySelector<HTMLButtonElement>("[data-faq-toggle]")?.focus({ preventScroll: true });
  }, [scrollTo]);
  const shown = useMemo(() => searchFaqItems(items ?? [], query), [items, query]);
  const shownIds = useMemo(() => shown.map((item) => item.id), [shown]);
  const changeQuery = (next: string) => {
    setQuery(next);
    if (next.trim()) {
      if (!beforeSearch.current) beforeSearch.current = open;
      setOpen(new Set(searchFaqItems(items ?? [], next).map((item) => item.id)));
    } else if (beforeSearch.current) {
      setOpen(beforeSearch.current);
      beforeSearch.current = null;
    }
  };

  if (failed)
    return (
      <div className={pageStyles.page}>
        <p className={pageStyles.empty} role="status">
          The FAQ isn’t available right now. Please try again in a moment.
        </p>
      </div>
    );
  if (!items)
    return (
      <div className={pageStyles.page}>
        <p className={pageStyles.empty} role="status">
          Opening the FAQ…
        </p>
      </div>
    );

  const searching = !!query.trim();
  return (
    <div className={pageStyles.page} data-faq-page>
      <div className={styles.column}>
        <div className={styles.bar}>
          <input
            type="search"
            className={styles.search}
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Search the FAQ"
            aria-label="Search the FAQ"
          />
          {shown.length > 0 && (
            <button
              type="button"
              className={pageStyles.quiet}
              onClick={() => setOpen((current) => toggleAllFaqOpen(current, shownIds))}
              data-faq-toggle-all
            >
              {faqToggleAllLabel(open, shownIds)}
            </button>
          )}
          {canManage && !adding && (
            <button
              type="button"
              className={pageStyles.primary}
              onClick={() => {
                setEditing(null);
                setAdding(true);
              }}
            >
              Add a question
            </button>
          )}
        </div>
        <SuggestTopic />
        {adding && (
          <div className={styles.formBox}>
            <ItemForm
              initial={{ question: "", answer: "", topic: "" }}
              submitLabel="Save question"
              onCancel={() => setAdding(false)}
              onSubmit={async (draft) => {
                const { item } = await send("/api/chat/faq", "POST", draft);
                setItems((current) => [...(current ?? []), item]);
                reveal(item.id);
                setAdding(false);
              }}
            />
          </div>
        )}
        {error && (
          <p className={pageStyles.error} role="alert">
            {error}
          </p>
        )}
        {searching && (
          <p className={styles.count} role="status" data-faq-count={shown.length}>
            {shown.length === 0
              ? `Nothing in the FAQ matches “${query.trim()}”.`
              : shown.length === 1
                ? "1 question matches."
                : `${shown.length} questions match.`}
          </p>
        )}
        {!searching && items.length === 0 && <p className={pageStyles.empty}>No questions yet.</p>}
        {shown.length > 0 && (
          <ul className={styles.items}>
            {shown.map((item) => (
              <li key={item.id} id={faqAnchorId(item.id)} className={styles.item} data-faq-item>
                {editing === item.id ? (
                  <ItemForm
                    initial={{ question: item.question, answer: item.answer, topic: item.topic ?? "" }}
                    submitLabel="Save changes"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (draft) => {
                      const { item: saved } = await send("/api/chat/faq", "PATCH", { id: item.id, ...draft });
                      setItems(
                        (current) => current?.map((row) => (row.id === saved.id ? saved : row)) ?? null,
                      );
                      setEditing(null);
                    }}
                  />
                ) : (
                  <FaqEntry item={item} open={open.has(item.id)} onToggle={toggle} onReveal={reveal}>
                    <Answer text={item.answer} />
                    {canManage && (
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={pageStyles.quiet}
                          onClick={() => {
                            setAdding(false);
                            setEditing(item.id);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={pageStyles.quiet}
                          onClick={async () => {
                            if (!window.confirm(`Delete “${item.question}” from the FAQ for everyone?`))
                              return;
                            setError("");
                            try {
                              await send(`/api/chat/faq?id=${encodeURIComponent(item.id)}`, "DELETE");
                              setItems((current) => current?.filter((row) => row.id !== item.id) ?? null);
                            } catch (caught) {
                              setError((caught as Error).message);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </FaqEntry>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
