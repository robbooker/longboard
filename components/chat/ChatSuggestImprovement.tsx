"use client";
import { useState, type FormEvent } from "react";
import { IMPROVEMENT_MAX } from "@/lib/chatImprovements";
import pageStyles from "./ChatPageView.module.css";
import styles from "./ChatSuggestImprovement.module.css";

// #352: the button at the top of What's New. What's typed goes to the private Admins room and nowhere else.
export default function ChatSuggestImprovement() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const empty = !text.trim();
  const close = () => {
    setOpen(false);
    setText("");
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (empty || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat/improvement-suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestion: text }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.error === "string" && data.error.includes(" ") ? data.error : "That didn't work. Please try again.");
      close();
      setSent(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!open)
    return (
      <div className={styles.bar} data-suggest-improvement>
        <button
          type="button"
          className={pageStyles.button}
          onClick={() => {
            setSent(false);
            setOpen(true);
          }}
        >
          Suggest an Improvement
        </button>
        {sent && (
          <p className={styles.thanks} role="status">
            Thanks. Your suggestion went to the admins.
          </p>
        )}
      </div>
    );
  return (
    <form className={styles.box} onSubmit={submit} noValidate data-suggest-improvement-form>
      <label>
        What would make the chat better? Your suggestion and your chat name go to the admins only.
        <textarea value={text} maxLength={IMPROVEMENT_MAX} rows={3} autoFocus onChange={(event) => setText(event.target.value)} />
      </label>
      {error && (
        <p className={pageStyles.error} role="alert">
          {error}
        </p>
      )}
      <div className={pageStyles.formActions}>
        <button type="submit" className={`${pageStyles.primary} ${styles.send}`} disabled={empty || busy}>
          {busy ? "Sending…" : "Send"}
        </button>
        <button type="button" className={pageStyles.quiet} onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  );
}
