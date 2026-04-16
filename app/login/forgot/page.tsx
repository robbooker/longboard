"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboardai.com"}/onboarding?mode=reset`;

    const supabase = createClient();
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (resetErr) {
      setError(resetErr.message);
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
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
    boxSizing: "border-box",
  };

  return (
    <div style={{
      background: "var(--bg)", color: "var(--text-primary)", fontFamily: font,
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 3, marginBottom: 8 }}>LONGBOARD.AI</div>
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>Forgot Password</div>
        </div>

        {sent ? (
          <div style={{
            background: "var(--accent-20)", border: "1px solid var(--accent)", color: "var(--accent)",
            padding: "12px 14px", borderRadius: 4, fontSize: 13, lineHeight: 1.5,
          }}>
            If an account exists for <strong>{email}</strong>, a reset link is on its way.
            Check your email and click the link to set a new password.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                style={inputStyle}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: "10px 16px",
                background: "transparent",
                border: "1px solid var(--accent)",
                color: "var(--accent)",
                fontFamily: font,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 2,
                textTransform: "uppercase",
                borderRadius: 4,
                cursor: loading ? "wait" : "pointer",
                opacity: loading ? 0.6 : 1,
                marginTop: 4,
              }}
            >
              {loading ? "Sending…" : "Send Reset Link"}
            </button>
          </form>
        )}

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <Link href="/login" style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5, textDecoration: "underline" }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
