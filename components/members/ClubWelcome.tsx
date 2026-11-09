"use client";

import { useState } from "react";
import styles from "./JoinClub.module.css";

type State = "ready" | "name" | "used" | "expired" | "invalid" | "unavailable" | "sent" | "longboard" | "no_access";

const GAINERS = "/chat?room=gainers";
const LONGBOARD = `/login?next=${encodeURIComponent(GAINERS)}`;
const RESEND_MESSAGES: Record<string, string> = {
  too_many_links: "We've sent a few links already. Please check your inbox (and spam), or try again in an hour.",
  email_unavailable: "We couldn't send the email just now. Please try again in a minute.",
};

/** #390: the welcome link's page: one button to open the club chat, then a chat name if needed. */
export default function ClubWelcome({ token, initialState, fontClass }: { token: string | null; initialState: State; fontClass: string }) {
  const [state, setState] = useState<State>(initialState);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/members/join/welcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        if (!body.needsName) return window.location.assign(body.next ?? GAINERS);
        setName(typeof body.name === "string" ? body.name : "");
        return setState("name");
      }
      if (body.error === "used" || body.error === "session_used") return setState("used");
      if (body.error === "expired") return setState("expired");
      if (body.error === "invalid") return setState("invalid");
      if (body.error === "longboard_account") return setState("longboard");
      if (body.error === "no_access") return setState("no_access");
      setError("Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const newLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/members/join/welcome/resend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) return setState("sent");
      if (body.error === "longboard_account") return setState("longboard");
      if (body.error === "no_access") return setState("no_access");
      setError(RESEND_MESSAGES[body.error] ?? "Something went wrong. Please try again, or use a sign-in code below.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/chat/member", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: name.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return setError(typeof body.error === "string" ? body.error : "Something went wrong. Please try again.");
      window.location.assign(GAINERS);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const codeSignIn = (
    <a className={styles.link} href="/join/club">
      Sign in with a code instead
    </a>
  );

  return (
    <div className={`${styles.page} ${fontClass}`} data-welcome-state={state}>
      <header className={styles.header}>
        <span className={styles.wordmark}>
          <span aria-hidden="true" className={styles.mark}>B</span> BOOKER STOCK CLUB
        </span>
        <span className={styles.note}>MEMBER CHAT</span>
      </header>
      <main className={styles.main}>
        <section className={styles.intro}>
          <p className={styles.eyebrow}>WELCOME TO THE CLUB</p>
          <h1>Welcome to the Booker Stock Club.</h1>
          <p className={styles.lead}>
            Your membership comes with the Gainers room, the Gainers Table, the News Feed, the Reader and the Booker Stock Club room.
            One tap and you&rsquo;re in. No password needed.
          </p>
        </section>
        <section className={styles.card} aria-live="polite">
          {state === "ready" && (
            <div>
              <h2>You&rsquo;re all set.</h2>
              <p className={styles.muted}>Open the chat on this device. You&rsquo;ll stay signed in here.</p>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void open()}>
                {busy ? "Opening…" : "Open the club chat"}
              </button>
            </div>
          )}
          {state === "name" && (
            <form onSubmit={(e) => { e.preventDefault(); void saveName(); }}>
              <h2>Pick your chat name</h2>
              <p className={styles.muted}>This is how other members see you. You can change it later.</p>
              <label className={styles.label} htmlFor="join-name">Chat name</label>
              <input id="join-name" className={styles.input} autoComplete="nickname" minLength={2} maxLength={28} required value={name} onChange={(e) => setName(e.target.value)} />
              <button className={styles.button} type="submit" disabled={busy || name.trim().length < 2}>
                {busy ? "Saving…" : "Go to the Gainers room"}
              </button>
            </form>
          )}
          {(state === "used" || state === "expired") && (
            <div>
              <h2>{state === "used" ? "This link was already used." : "This link has expired."}</h2>
              <p className={styles.muted}>
                Each welcome link works once, for 7 days. We can email a fresh one to your purchase email.
              </p>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void newLink()}>
                {busy ? "Sending…" : "Email me a new link"}
              </button>
              {codeSignIn}
            </div>
          )}
          {state === "sent" && (
            <div>
              <h2>Check your email.</h2>
              <p className={styles.muted}>We sent a new link to your purchase email. Tap its button to open the club chat.</p>
            </div>
          )}
          {state === "invalid" && (
            <div>
              <h2>We don&rsquo;t recognize this link.</h2>
              <p className={styles.muted}>Make sure you opened the whole link from your welcome email, or sign in with a code we email you.</p>
              <a className={styles.button} href="/join/club">Sign in with a code</a>
            </div>
          )}
          {state === "unavailable" && (
            <div>
              <h2>We couldn&rsquo;t check your link just now.</h2>
              <p className={styles.muted}>Please try again in a minute.</p>
              <button className={styles.button} type="button" onClick={() => window.location.reload()}>Try again</button>
            </div>
          )}
          {state === "longboard" && (
            <div>
              <h2>You already have a Longboard account.</h2>
              <p className={styles.muted}>Sign in with Longboard using this email; your club membership is already on your account.</p>
              <a className={styles.button} href={LONGBOARD}>Sign in with Longboard</a>
            </div>
          )}
          {state === "no_access" && (
            <div>
              <h2>This membership isn&rsquo;t active.</h2>
              <p className={styles.muted}>It may have been refunded or canceled. Write to us and we&rsquo;ll help.</p>
            </div>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </section>
      </main>
      <footer className={styles.footer}>
        <span>BOOKER STOCK CLUB · CLUB.ROBBOOKER.COM</span>
        <a href="mailto:contact@longboardai.com">Need a hand? ↗</a>
      </footer>
    </div>
  );
}
