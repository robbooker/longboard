"use client";

import React, { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Full browser navigation — ensures freshly-written sb-* cookies
    // are sent with the request. router.push() uses Next.js internal
    // fetch which may read from a stale cookie jar.
    window.location.href = "/settings";
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
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>Sign In</div>
        </div>

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

          <div>
            <label style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
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
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div style={{ textAlign: "center", marginTop: 16 }}>
          <Link href="/login/forgot" style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 1.5, textDecoration: "underline" }}>
            Forgot password?
          </Link>
        </div>

        <div style={{ textAlign: "center", marginTop: 24, fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5 }}>
          INVITE ONLY
        </div>
      </div>
    </div>
  );
}
