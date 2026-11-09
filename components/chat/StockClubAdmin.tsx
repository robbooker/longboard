"use client";
// #386 Booker Stock Club, admins only: today's candidates as the last 15-minute run ranked them,
// and setting today's pick by hand (which posts it and stops automatic changes for the day), or
// turning automatic picks back on. Shown under the room in place of the read-only note.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { changeLabel } from "@/lib/chatGainersFacts";
import { isPriorityCountry } from "@/lib/stockClub";
import styles from "./StockClubAdmin.module.css";

type Candidate = { ticker: string; changePct: number; country: string | null };
type State = { day: string; locked: boolean; candidates: Candidate[]; posted: string[] };

const ERRORS: Record<string, string> = {
  invalid_ticker: "Type a ticker, like ABCD.",
  no_quote: "No price for that ticker right now.",
  room_paused: "The room is paused.",
};

export function StockClubAdmin() {
  const [state, setState] = useState<State | null>(null);
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/chat/club/admin", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setState((await response.json()) as State);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const send = async (body: unknown, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch("/api/chat/club/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setNote(response.ok ? done : (ERRORS[data.error ?? ""] ?? "That didn't work. Try again."));
      if (response.ok) setTicker("");
      await load();
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const wanted = ticker.trim().toUpperCase();
    if (wanted)
      void send(
        { ticker: wanted },
        `${wanted} is posted as today's pick. Automatic picks are off for today.`,
      );
  };
  return (
    <div className={styles.panel} data-club-admin>
      <p className={styles.status}>
        <strong>Admin</strong> · Automatic picks today:{" "}
        {state ? (state.locked ? "off (set by hand)" : "on") : "…"}
        {state?.locked && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void send({ action: "resume" }, "Automatic picks are back on for today.")}
          >
            Turn automatic picks back on
          </button>
        )}
      </p>
      {!!state?.candidates.length && (
        <p className={styles.candidates} data-club-candidates>
          Ranked now:{" "}
          {state.candidates.slice(0, 6).map((c, i) => (
            <span key={c.ticker} data-priority={isPriorityCountry(c.country) || undefined}>
              {i ? " · " : ""}
              {c.ticker} {changeLabel({ price: null, changePct: c.changePct, volume: null })}
              {c.country ? ` (${c.country})` : " (country unknown)"}
            </span>
          ))}
        </p>
      )}
      <form className={styles.form} onSubmit={submit}>
        <label>
          <span>Set today&apos;s pick</span>
          <input
            value={ticker}
            onChange={(event) => setTicker(event.target.value.toUpperCase())}
            placeholder="Ticker"
            maxLength={10}
            autoComplete="off"
            spellCheck={false}
            aria-label="Ticker for today's pick"
          />
        </label>
        <button type="submit" disabled={busy || !ticker.trim()}>
          Post as today&apos;s pick
        </button>
      </form>
      {note && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
    </div>
  );
}
