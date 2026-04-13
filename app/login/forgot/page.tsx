"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const bg = "#0a0e0c";
const card = "#0f1513";
const border = "#1a2420";
const green = "#00ff88";
const red = "#ff5c5c";
const dim = "#5a6168";
const textColor = "#e6f1ec";
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

    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboard-ruddy.vercel.app"}/onboarding?mode=reset`;

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
    background: card,
    border: `1px solid ${border}`,
    borderRadius: 4,
    color: textColor,
    fontFamily: font,
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <div style={{
      background: bg, color: textColor, fontFamily: font,
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: dim, letterSpacing: 3, marginBottom: 8 }}>LONGBOARD.AI</div>
          <div style={{ fontSize: 22, color: green, fontWeight: 500, letterSpacing: 1 }}>Forgot Password</div>
        </div>

        {sent ? (
          <div style={{
            background: green + "20", border: `1px solid ${green}`, color: green,
            padding: "12px 14px", borderRadius: 4, fontSize: 13, lineHeight: 1.5,
          }}>
            If an account exists for <strong>{email}</strong>, a reset link is on its way.
            Check your email and click the link to set a new password.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {error && (
              <div style={{
                background: red + "20", border: `1px solid ${red}`, color: red,
                padding: "8px 12px", borderRadius: 4, fontSize: 12,
              }}>
                {error}
              </div>
            )}

            <div>
              <label style={{ fontSize: 10, color: dim, letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
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
                border: `1px solid ${green}`,
                color: green,
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
          <Link href="/login" style={{ fontSize: 10, color: dim, letterSpacing: 1.5, textDecoration: "underline" }}>
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
