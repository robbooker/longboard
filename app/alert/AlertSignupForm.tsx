"use client";

import { FormEvent, useId, useState } from "react";

type SubmitStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "success" }
  | { state: "error"; message: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function messageFor(error: unknown): string {
  if (error === "invalid_email") return "That email address did not look valid. Check it and try again.";
  return "The signup did not go through. Try again in a moment.";
}

export default function AlertSignupForm({
  compact = false,
  source = "alert_landing",
}: {
  compact?: boolean;
  source?: string;
}) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<SubmitStatus>({ state: "idle" });

  const trimmedEmail = email.trim();
  const hasClientError = touched && trimmedEmail.length > 0 && !EMAIL_RE.test(trimmedEmail);
  const helperId = `${id}-helper`;
  const isSubmitting = status.state === "submitting";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);

    if (!EMAIL_RE.test(trimmedEmail)) {
      setStatus({ state: "error", message: messageFor("invalid_email") });
      return;
    }

    setStatus({ state: "submitting" });

    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, source }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data?.ok === true) {
        setStatus({ state: "success" });
        return;
      }

      setStatus({ state: "error", message: messageFor(data?.error) });
    } catch {
      setStatus({ state: "error", message: messageFor("subscription_failed") });
    }
  }

  if (status.state === "success") {
    return (
      <div className={compact ? "alert-success is-compact" : "alert-success"} role="status">
        <span className="alert-success__mark" aria-hidden="true">OK</span>
        <div>
          <strong>Email saved.</strong>
          <span>The SMS step comes next.</span>
        </div>
      </div>
    );
  }

  return (
    <form
      className={compact ? "alert-form is-compact" : "alert-form"}
      data-state={status.state === "error" || hasClientError ? "error" : status.state}
      onSubmit={onSubmit}
      noValidate
    >
      <label htmlFor={id}>Email address</label>
      <div className="alert-form__row">
        <input
          id={id}
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onBlur={() => setTouched(true)}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status.state === "error") setStatus({ state: "idle" });
          }}
          placeholder="you@example.com"
          aria-describedby={helperId}
          aria-invalid={hasClientError || status.state === "error"}
          aria-required="true"
          data-state={
            hasClientError || status.state === "error"
              ? "error"
              : trimmedEmail && EMAIL_RE.test(trimmedEmail)
                ? "success"
                : undefined
          }
        />
        <button type="submit" disabled={isSubmitting} data-state={isSubmitting ? "loading" : undefined}>
          {isSubmitting ? "Saving..." : "Get the alert"}
        </button>
      </div>
      <p id={helperId} className="alert-form__helper" aria-live="polite">
        {status.state === "error" || hasClientError
          ? status.state === "error"
            ? status.message
            : messageFor("invalid_email")
          : "Start with email. SMS details come on the next step."}
      </p>
    </form>
  );
}
