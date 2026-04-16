"use client";

import { useState, type FormEvent } from "react";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok" }
  | { kind: "err"; message: string };

// Client-side gate — same regex as the server so the UX error fires
// before the round-trip. Server is the source of truth; this just
// shortcuts the common typo case.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setStatus({ kind: "err", message: "That doesn't look like an email address." });
      return;
    }
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (res.ok) {
        setStatus({ kind: "ok" });
        setEmail("");
        return;
      }
      const payload = await res.json().catch(() => ({}));
      const err = typeof payload?.error === "string" ? payload.error : "server_error";
      setStatus({
        kind: "err",
        message: err === "invalid_email" ? "That doesn't look like an email address." : "Something went wrong. Try again in a moment.",
      });
    } catch {
      setStatus({ kind: "err", message: "Network error. Try again in a moment." });
    }
  }

  const submitting = status.kind === "submitting";

  return (
    <>
      <form onSubmit={onSubmit} noValidate>
        <input
          type="email"
          name="email"
          placeholder="you@yourbrokerage.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          aria-label="Email address"
          autoComplete="email"
        />
        <button type="submit" disabled={submitting}>
          {submitting ? "Subscribing…" : "Subscribe →"}
        </button>
      </form>
      {status.kind === "ok" && (
        <p className="newsletter-status ok">You're on the list. Wednesday mornings.</p>
      )}
      {status.kind === "err" && (
        <p className="newsletter-status err">{status.message}</p>
      )}
    </>
  );
}
