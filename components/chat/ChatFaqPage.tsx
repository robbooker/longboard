"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  FAQ_ANSWER_MAX,
  FAQ_QUESTION_MAX,
  FAQ_TOPIC_MAX,
  searchFaqItems,
  type ChatFaqItem,
} from "@/lib/chatFaq";
import { tokenizeChatMessage } from "@/lib/publicChat";
import pageStyles from "./ChatPageView.module.css";
import styles from "./ChatFaqPage.module.css";

// #332 LB-FAQ: the FAQ, a page rather than a room: questions with their answers and a search box
// over only these items. Admins add, edit and remove items here (the routes enforce it). "Suggest a
// topic" posts to the private Admins room; suggestions never appear on this page.

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" && data.error.includes(" ") ? data.error : "That didn't work. Please try again.");
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

function ItemForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: { question: string; answer: string };
  submitLabel: string;
  onSubmit: (draft: { question: string; answer: string }) => Promise<void>;
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
        <input value={draft.question} maxLength={FAQ_QUESTION_MAX} onChange={(event) => setDraft({ ...draft, question: event.target.value })} />
      </label>
      <label>
        Answer
        <textarea value={draft.answer} maxLength={FAQ_ANSWER_MAX} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} />
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
            className={pageStyles.button}
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
        <input value={topic} maxLength={FAQ_TOPIC_MAX} autoFocus onChange={(event) => setTopic(event.target.value)} />
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
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/chat/faq", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body) => {
        setItems(Array.isArray(body.items) ? body.items : []);
        setCanManage(body.canManage === true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);
  const shown = useMemo(() => searchFaqItems(items ?? [], query), [items, query]);

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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the FAQ"
            aria-label="Search the FAQ"
          />
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
        {items && !canManage && <SuggestTopic />}
        {adding && (
          <div className={styles.formBox}>
            <ItemForm
              initial={{ question: "", answer: "" }}
              submitLabel="Save question"
              onCancel={() => setAdding(false)}
              onSubmit={async (draft) => {
                const { item } = await send("/api/chat/faq", "POST", draft);
                setItems((current) => [...(current ?? []), item]);
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
              <li key={item.id} className={styles.item} data-faq-item>
                {editing === item.id ? (
                  <ItemForm
                    initial={{ question: item.question, answer: item.answer }}
                    submitLabel="Save changes"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (draft) => {
                      const { item: saved } = await send("/api/chat/faq", "PATCH", { id: item.id, ...draft });
                      setItems((current) => current?.map((row) => (row.id === saved.id ? saved : row)) ?? null);
                      setEditing(null);
                    }}
                  />
                ) : (
                  <>
                    <h2 className={styles.question}>{item.question}</h2>
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
                            if (!window.confirm(`Delete “${item.question}” from the FAQ for everyone?`)) return;
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
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
