"use client";
// #507: the host's own row in the "On screen now" panel: type a ticker and press Set (or Enter) to
// put that stock on screen for everyone watching, or Clear to take it off. Admins only: members are
// never given this component, and the server refuses everyone else (/api/chat/stage/on-screen).
import { useId, useState, type FormEvent } from "react";
import { parseStageTicker } from "@/lib/chatStageLive";
import styles from "./StageMode.module.css";

/** What the panel's chips and this row use to set the stock for everyone. */
export type StageHostControls = {
  /** The room's live video has been started: only then can a stock be put on screen. */
  ready: boolean;
  busy: boolean;
  /** The last try failed: what to tell the host. */
  error: string;
  /** Sets (or, with null, clears) the stock for everyone. True when the server took it. */
  set: (symbol: string | null) => Promise<boolean>;
};

export default function StageOnScreenControl({ host, controls }: { host: string | null; controls: StageHostControls }) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputId = useId();
  const noteId = useId();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const symbol = parseStageTicker(draft);
    setInvalid(!symbol);
    if (!symbol) return;
    if (await controls.set(symbol)) setDraft("");
  };
  const off = !controls.ready || controls.busy;
  return (
    <form className={styles.onScreenSet} data-stage-on-screen-control onSubmit={(event) => void submit(event)}>
      <label htmlFor={inputId}>Stock on screen · admins only</label>
      <input
        id={inputId}
        className={`${styles.askInput} ${styles.mono}`}
        value={draft}
        maxLength={8}
        placeholder="Ticker"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={!controls.ready}
        aria-invalid={invalid || undefined}
        aria-describedby={noteId}
        data-stage-on-screen-input
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
      />
      <button type="submit" className={styles.askButton} data-stage-on-screen-set disabled={off || !draft.trim()}>
        {controls.busy ? "Setting…" : "Set"}
      </button>
      <button type="button" className={styles.barButton} data-stage-on-screen-clear disabled={off || !host} onClick={() => void controls.set(null)}>
        Clear
      </button>
      {invalid || controls.error ? (
        <p id={noteId} className={styles.broadcastError} role="alert">
          {invalid ? "That isn’t a ticker. Use letters, like APUS or BRK.B." : controls.error}
        </p>
      ) : (
        <p id={noteId} className={styles.newsNote}>
          {!controls.ready
            ? "Start live video to put a stock on screen for everyone."
            : host
              ? `${host} is on screen for everyone. Click another stock above, or type one, to change it.`
              : "Click a stock above, or type any ticker, to put it on screen for everyone."}
        </p>
      )}
    </form>
  );
}
