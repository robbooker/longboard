"use client";
import { useId, useState } from "react";
import type { ClarityOriginal, ClarityReviewState } from "./hooks/useClarity";
import styles from "./ClarityReview.module.css";

/** Inline review. Every send is an explicit click; nothing here sends on its own. */
export function ClarityReview({
  review,
  busy,
  sending,
  onChange,
  onRegenerate,
  onUseOriginal,
  onSend,
  onCancel,
}: {
  review: ClarityReviewState;
  busy: boolean;
  sending: boolean;
  onChange: (value: string) => void;
  onRegenerate: () => void;
  onUseOriginal: () => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [copied, setCopied] = useState("");
  const { result, suggestion } = review;
  const edited = suggestion !== result.suggestedMessage;
  const tooLong = suggestion.length > 2000;
  async function copy() {
    try {
      await navigator.clipboard.writeText(suggestion);
      setCopied("Copied.");
    } catch {
      setCopied("Copy isn't available here. Select the text and copy it.");
    }
  }
  return (
    <section className={styles.review} aria-label="Review before sending" aria-busy={busy}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>REVIEW BEFORE SENDING</span>
        <button type="button" className={styles.link} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div>
        <span className={styles.eyebrow}>INTENT</span>
        <p>{result.intent}</p>
      </div>
      {result.ambiguityDetected && result.ambiguityNote && (
        <p className={styles.ambiguity} role="status">
          <strong>Needs clarifying:</strong> {result.ambiguityNote}
        </p>
      )}
      <label className={styles.eyebrow} htmlFor={`${id}-suggestion`}>
        SUGGESTED MESSAGE {edited && <span className={styles.edited}>· edited by you</span>}
      </label>
      <textarea
        id={`${id}-suggestion`}
        className={styles.suggestion}
        value={suggestion}
        maxLength={4000}
        disabled={busy || sending}
        onChange={(event) => {
          onChange(event.target.value);
          setCopied("");
        }}
      />
      {tooLong && (
        <p className={styles.error}>Messages can be up to 2,000 characters. Shorten it before sending.</p>
      )}
      <div>
        <span className={styles.eyebrow}>WHY IT CHANGED</span>
        <p>{result.whyChanged}</p>
      </div>
      <div className={styles.actions}>
        <button type="button" onClick={onRegenerate} disabled={busy || sending}>
          {busy ? "Working…" : "Regenerate"}
        </button>
        <button type="button" onClick={onUseOriginal} disabled={busy || sending}>
          Send my original
        </button>
        <button type="button" onClick={() => void copy()} disabled={!suggestion.trim()}>
          Copy
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={onSend}
          disabled={busy || sending || !suggestion.trim() || tooLong}
        >
          {sending ? "Sending…" : "Send suggestion"}
        </button>
      </div>
      {copied && (
        <p className={styles.note} role="status">
          {copied}
        </p>
      )}
    </section>
  );
}

/** Sender-only: shows what you originally wrote and the review notes for a message you sent. */
export function ClarityOriginalNote({ original }: { original: ClarityOriginal }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.original}>
      <button
        type="button"
        className={styles.link}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide my original" : "My original"}
      </button>
      {open && (
        <div className={styles.originalBody}>
          <span className={styles.eyebrow}>ONLY YOU CAN SEE THIS</span>
          <p>{original.original_body}</p>
          {original.intent && (
            <p>
              <strong>Intent:</strong> {original.intent}
            </p>
          )}
          {original.why_changed && (
            <p>
              <strong>Why it changed:</strong> {original.why_changed}
            </p>
          )}
          {!original.used_suggestion && (
            <p className={styles.note}>You sent your original after reviewing.</p>
          )}
        </div>
      )}
    </div>
  );
}
