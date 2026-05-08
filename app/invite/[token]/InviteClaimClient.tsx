"use client";

import React, { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const font = "var(--font-labels)";

type Phase = "ready" | "submitting" | "done";

export default function InviteClaimClient({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    const res = await fetch("/api/invites/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(messageForError(data.error, data.message));
      setPhase("ready");
      return;
    }

    const supabase = createClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: data.email,
      password,
    });

    if (signInErr) {
      setError("Your password was saved, but sign-in failed. Go to login and use the password you just set.");
      setPhase("ready");
      return;
    }

    setPhase("done");
    window.location.href = "/command2";
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
            Create Your Password
          </div>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 20 }}>
          Set a password to finish activating your Longboard account.
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
            <label style={labelStyle}>Password</label>
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
            <label style={labelStyle}>Confirm Password</label>
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
            disabled={phase !== "ready"}
            style={{
              marginTop: 4, width: "100%", padding: "10px 16px",
              background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
              fontFamily: font, fontSize: 12, fontWeight: 700, letterSpacing: 2,
              textTransform: "uppercase", borderRadius: 4,
              cursor: phase === "submitting" ? "wait" : "pointer",
              opacity: phase !== "ready" ? 0.6 : 1,
            }}
          >
            {phase === "submitting" ? "Saving..." : phase === "done" ? "Redirecting..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}

function messageForError(code?: string, message?: string) {
  if (code === "invite_not_available" || code === "invalid_invite") {
    return "This invite is not available. Ask an admin to reset it and send you a fresh link.";
  }
  if (code === "password_too_short") return "Password must be at least 8 characters.";
  return message ?? "Something went wrong. Please try again.";
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-secondary)",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  display: "block",
  marginBottom: 6,
};

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
};
