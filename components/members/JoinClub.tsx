"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./JoinClub.module.css";

type Step = "confirming" | "onetap" | "email" | "code" | "name" | "longboard" | "slow" | "inactive";

const POLL_MS = 2500;
const POLL_FOR_MS = 90_000;

const MESSAGES: Record<string, string> = {
  no_purchase: "We can't find a Booker Stock Club purchase for that email yet.",
  no_access: "That purchase doesn't include chat access right now. Write to us and we'll sort it out.",
  too_many_codes: "That's a lot of codes. Please wait a few minutes and try again.",
  email_unavailable: "We couldn't send the email just now. Please try again in a minute.",
  wrong_code: "That code isn't right. Check the latest email and try again.",
  code_expired: "That code has expired. Send yourself a new one.",
  too_many_attempts: "Too many tries with that code. Send yourself a new one.",
};
const message = (error: unknown) =>
  (typeof error === "string" && MESSAGES[error]) || "Something went wrong. Please try again.";

/** #384: the Booker Stock Club sign-up: confirm the purchase, email a code, pick a chat name. */
export default function JoinClub({ sessionId, initialEmail, fontClass }: { sessionId: string | null; initialEmail: string | null; fontClass: string }) {
  const [step, setStep] = useState<Step>(sessionId || initialEmail ? "confirming" : "email");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const pollEmail = useRef<string | null>(sessionId ? null : initialEmail);

  const sendCode = useCallback(async (to: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/members/join/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: to }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setSentTo(to);
        setStep("code");
      } else if (body.error === "no_purchase") {
        // The webhook may still be on its way: wait for it, then send.
        pollEmail.current = to;
        setStep("confirming");
      } else if (body.error === "longboard_account") setStep("longboard");
      else setError(message(body.error));
    } catch {
      setError(message(null));
    } finally {
      setBusy(false);
    }
  }, []);

  // "We're confirming your purchase…": ask every few seconds until the purchase is in.
  useEffect(() => {
    if (step !== "confirming") return;
    let stopped = false;
    const started = Date.now();
    const query = () =>
      sessionId && !pollEmail.current ? `session_id=${encodeURIComponent(sessionId)}` : `email=${encodeURIComponent(pollEmail.current ?? "")}`;
    const tick = async () => {
      if (stopped) return;
      try {
        const response = await fetch(`/api/members/join/status?${query()}`, { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (stopped) return;
        if (body.status === "signed_in") return window.location.assign("/chat?room=gainers");
        if (body.status === "longboard_account") return setStep("longboard");
        if (body.status === "inactive") return setStep("inactive");
        if (body.status === "ready") {
          const to = typeof body.email === "string" ? body.email : pollEmail.current;
          if (to) {
            setEmail(to);
            // Came back from waiting after they asked for a code: send it now.
            if (pollEmail.current) return void sendCode(to);
          }
          // #390: straight from checkout, no chat account yet: one tap, no email to type.
          return setStep(body.oneTap === true ? "onetap" : "email");
        }
      } catch {
        /* keep trying */
      }
      if (Date.now() - started > POLL_FOR_MS) return setStep("slow");
      setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      stopped = true;
    };
  }, [step, sessionId, sendCode]);

  // #390: the thank-you page's one tap: a short-lived welcome token from the checkout session, spent at once.
  const openWithCheckout = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const issued = await fetch("/api/members/join/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const made = await issued.json().catch(() => ({}));
      if (!issued.ok || typeof made.token !== "string") {
        if (made.error === "longboard_account") return setStep("longboard");
        if (made.error === "no_access") return setStep("inactive");
        // Already used, too old or already signed up: the code sign-in still works.
        return setStep("email");
      }
      const response = await fetch("/api/members/join/welcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: made.token }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.error === "longboard_account") return setStep("longboard");
        if (body.error === "no_access") return setStep("inactive");
        return setStep("email");
      }
      if (body.needsName) {
        setName(typeof body.name === "string" ? body.name : "");
        return setStep("name");
      }
      window.location.assign(body.next ?? "/chat?room=gainers");
    } catch {
      setError(message(null));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/members/join/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: sentTo ?? email, code: code.trim() }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (body.error === "longboard_account") return setStep("longboard");
        return setError(message(body.error));
      }
      if (body.needsName) return setStep("name");
      window.location.assign(body.next ?? "/chat?room=gainers");
    } catch {
      setError(message(null));
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
      if (!response.ok) return setError(typeof body.error === "string" ? body.error : message(null));
      window.location.assign("/chat?room=gainers");
    } catch {
      setError(message(null));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${styles.page} ${fontClass}`} data-join-step={step}>
      <header className={styles.header}>
        <span className={styles.wordmark}>
          <span aria-hidden="true" className={styles.mark}>B</span> BOOKER STOCK CLUB
        </span>
        <span className={styles.note}>MEMBER CHAT</span>
      </header>
      <main className={styles.main}>
        <section className={styles.intro}>
          <p className={styles.eyebrow}>WELCOME TO THE CLUB</p>
          <h1>Let&rsquo;s open your club chat.</h1>
          <p className={styles.lead}>
            Your membership comes with the Gainers room, the Gainers Table, the News Feed and the Booker Stock Club room.
            Sign in once with the email you bought with.
          </p>
          <ol className={styles.steps} aria-label="Steps">
            <li className={step === "confirming" ? styles.now : ""}>Confirm your purchase</li>
            <li className={step === "onetap" || step === "email" || step === "code" ? styles.now : ""}>{step === "onetap" ? "Open the chat" : "Get a code by email"}</li>
            <li className={step === "name" ? styles.now : ""}>Pick your chat name</li>
          </ol>
        </section>
        <section className={styles.card} aria-live="polite">
          {step === "confirming" && (
            <div role="status">
              <span className={styles.spinner} aria-hidden="true" />
              <h2>We&rsquo;re confirming your purchase&hellip;</h2>
              <p className={styles.muted}>This usually takes a few seconds. Keep this page open.</p>
            </div>
          )}
          {step === "slow" && (
            <div>
              <h2>Still confirming&hellip;</h2>
              <p className={styles.muted}>
                Your payment can take a minute to reach us. Try again, or check that you used the same email you bought with.
              </p>
              <button className={styles.button} type="button" onClick={() => setStep(pollEmail.current || sessionId ? "confirming" : "email")}>
                Check again
              </button>
              <button className={styles.link} type="button" onClick={() => { pollEmail.current = null; setStep("email"); }}>
                Use a different email
              </button>
            </div>
          )}
          {step === "inactive" && (
            <div>
              <h2>This purchase isn&rsquo;t active.</h2>
              <p className={styles.muted}>It may have been refunded or canceled. Write to us and we&rsquo;ll help.</p>
            </div>
          )}
          {step === "onetap" && (
            <div>
              <h2>Your purchase is confirmed.</h2>
              <p className={styles.muted}>
                Open the club chat on this device. No password, nothing to type. We also emailed you a welcome link for later.
              </p>
              <button className={styles.button} type="button" disabled={busy} onClick={() => void openWithCheckout()}>
                {busy ? "Opening…" : "Open the club chat"}
              </button>
              <button className={styles.link} type="button" disabled={busy} onClick={() => setStep("email")}>
                Use a sign-in code instead
              </button>
            </div>
          )}
          {step === "email" && (
            <form onSubmit={(e) => { e.preventDefault(); void sendCode(email.trim()); }}>
              <h2>Your purchase email</h2>
              <p className={styles.muted}>We&rsquo;ll email you a six-digit code. No password needed.</p>
              <label className={styles.label} htmlFor="join-email">Email</label>
              <input id="join-email" className={styles.input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className={styles.button} type="submit" disabled={busy || !email.trim()}>
                {busy ? "Sending…" : "Email me a code"}
              </button>
            </form>
          )}
          {step === "code" && (
            <form onSubmit={(e) => { e.preventDefault(); void verify(); }}>
              <h2>Check your email</h2>
              <p className={styles.muted}>We sent a code to <strong>{sentTo}</strong>. It works for 10 minutes.</p>
              <label className={styles.label} htmlFor="join-code">Six-digit code</label>
              <input id="join-code" className={`${styles.input} ${styles.code}`} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
              <button className={styles.button} type="submit" disabled={busy || code.length !== 6}>
                {busy ? "Checking…" : "Open the club chat"}
              </button>
              <button className={styles.link} type="button" disabled={busy} onClick={() => sentTo && void sendCode(sentTo)}>
                Send a new code
              </button>
            </form>
          )}
          {step === "name" && (
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
          {step === "longboard" && (
            <div>
              <h2>You already have a Longboard account.</h2>
              <p className={styles.muted}>
                Sign in with Longboard using this email; your club membership is already on your account.
              </p>
              <a className={styles.button} href={`/login?next=${encodeURIComponent("/chat?room=gainers")}`}>Sign in with Longboard</a>
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
