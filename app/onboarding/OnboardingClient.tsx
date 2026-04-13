"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

type Phase = "loading" | "expired" | "ready" | "submitting" | "done";

export default function OnboardingClient() {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") === "reset" ? "reset" : "invite";

  const [phase, setPhase] = useState<Phase>("loading");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Supabase's browser client auto-consumes the tokens from the URL hash on
    // first load. getUser() will either return the newly-authed user or null
    // if the link has been consumed already or expired.
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user?.email) {
        setPhase("expired");
        return;
      }
      setEmail(data.user.email);
      setPhase("ready");
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setPhase("submitting");
    const supabase = createClient();

    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setError(updateErr.message);
      setPhase("ready");
      return;
    }

    // Only mark the invite accepted when the user is actually onboarding.
    // Password-reset flow hits this same page but must not flip accepted_at.
    if (mode !== "reset") {
      try {
        await fetch("/api/admin/invites/accept", { method: "POST" });
      } catch {
        // non-fatal — the account already exists, invite-row tracking is a nicety
      }
    }

    setPhase("done");
    // Full nav so the freshly-written session cookies are picked up by
    // middleware on the next request (same pattern as the login fix).
    window.location.href = mode === "reset" ? "/alpaca" : "/settings/keys";
  }

  return (
    <div style={{
      background: "var(--bg)", color: "var(--text-primary)", fontFamily: font,
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 3, marginBottom: 8 }}>
            LONGBOARD.AI
          </div>
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
            {mode === "reset" ? "Reset Password" : "Welcome"}
          </div>
        </div>

        {phase === "loading" && (
          <div style={{ textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
            Verifying link…
          </div>
        )}

        {phase === "expired" && (
          <div style={{
            background: "var(--danger-20)", border: "1px solid var(--danger)",
            color: "var(--danger)", borderRadius: 6, padding: "14px 16px",
            fontSize: 13, lineHeight: 1.5,
          }}>
            This link has expired or has already been used. Please request a new invite from your admin,
            or use <a href="/login/forgot" style={{ color: "var(--danger)", textDecoration: "underline" }}>Forgot password</a> if
            you already have an account.
          </div>
        )}

        {(phase === "ready" || phase === "submitting" || phase === "done") && (
          <>
            <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 20 }}>
              {mode === "reset" ? (
                <>Signed in as <strong>{email}</strong>. Choose a new password to continue.</>
              ) : (
                <>Welcome to Longboard, <strong>{email}</strong>. Set a password to finish creating your
                account. You can configure broker API keys later from Settings.</>
              )}
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {error && (
                <div style={{
                  background: "var(--danger-20)", border: "1px solid var(--danger)", color: "var(--danger)",
                  padding: "8px 12px", borderRadius: 4, fontSize: 12,
                }}>
                  {error}
                </div>
              )}

              <div>
                <label style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  {mode === "reset" ? "New Password" : "Password"}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </div>

              <button
                type="submit"
                disabled={phase === "submitting" || phase === "done"}
                style={{
                  marginTop: 4, width: "100%", padding: "10px 16px",
                  background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
                  fontFamily: font, fontSize: 12, fontWeight: 700, letterSpacing: 2,
                  textTransform: "uppercase", borderRadius: 4,
                  cursor: phase === "submitting" ? "wait" : "pointer",
                  opacity: phase === "submitting" || phase === "done" ? 0.6 : 1,
                }}
              >
                {phase === "submitting" ? "Saving…" : phase === "done" ? "Redirecting…" : (mode === "reset" ? "Update Password" : "Continue")}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  color: "var(--text-primary)",
  fontFamily: font,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};
