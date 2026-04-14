"use client";

import React, { useState } from "react";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

type FormState = "idle" | "submitting" | "done" | "rate_limited" | "error";

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setState("submitting");
    try {
      const res = await fetch("/api/signup-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), message: message.trim() || undefined }),
      });
      if (res.status === 429) { setState("rate_limited"); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error === "invalid_email" ? "That email doesn't look right." : "Something went wrong. Try again in a bit.");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setErrorMsg("Network error. Try again in a bit.");
      setState("error");
    }
  }

  return (
    <div style={{
      background: "var(--bg)", color: "var(--text-primary)", fontFamily: font,
      minHeight: "100vh",
    }}>
      <style>{responsiveCss}</style>

      {/* ── Hero ── */}
      <section className="lb-hero" style={{
        maxWidth: 960, margin: "0 auto", padding: "80px 24px 60px",
      }}>
        <h1 style={{
          fontSize: 44, lineHeight: 1.15, margin: "0 0 20px",
          color: "var(--text-primary)", fontWeight: 600, letterSpacing: -0.5,
        }}>
          Your trading desk, on the web.
        </h1>
        <p style={{
          fontSize: 18, lineHeight: 1.55, margin: "0 0 32px",
          color: "var(--text-secondary)", maxWidth: 720,
        }}>
          Paper-trade with Alpaca. Trade live with TradeZero. Run research the way
          the pros do — all from one terminal-styled dashboard.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a
            href="#request-access"
            style={{
              background: "var(--accent)", color: "var(--bg)",
              padding: "12px 22px", borderRadius: 4, fontSize: 12,
              fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            Request Access
          </a>
          <a
            href="/login"
            style={{
              background: "transparent", color: "var(--text-primary)",
              border: "1px solid var(--border)",
              padding: "12px 22px", borderRadius: 4, fontSize: 12,
              fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
              textDecoration: "none",
            }}
          >
            Sign In
          </a>
        </div>
      </section>

      {/* ── Three features ── */}
      <section style={{ maxWidth: 1040, margin: "0 auto", padding: "0 24px 60px" }}>
        <div className="lb-features">
          <FeatureCard
            title="One dashboard, two brokers"
            body="Switch between Alpaca paper and TradeZero live without leaving the page. Positions, orders, P&L, and order entry — same keyboard, same workflow, same muscle memory."
          />
          <FeatureCard
            title="Research that actually ships"
            body="Polygon, SEC EDGAR, Brave, Exa, and Perplexity, orchestrated into one research workflow. Stop tab-hopping. Get a thesis, not a pile of links."
          />
          <FeatureCard
            title="A kill switch that works"
            body="One toggle disables every order across every broker. Hard env override for the truly paranoid. Because the worst trading day of your life shouldn't also be a software outage."
          />
        </div>
      </section>

      {/* ── Below the fold ── */}
      <section style={{
        maxWidth: 960, margin: "0 auto", padding: "40px 24px 80px",
        borderTop: "1px solid var(--border)",
      }}>
        <h2 style={{
          fontSize: 24, margin: "40px 0 20px", color: "var(--text-primary)",
          fontWeight: 600, letterSpacing: -0.3,
        }}>
          Built for traders who give a damn
        </h2>
        <ul style={{
          listStyle: "none", padding: 0, margin: 0, color: "var(--text-secondary)",
          fontSize: 15, lineHeight: 1.9,
        }}>
          <li>— Light and dark themes that don&apos;t fight you</li>
          <li>— Per-user encrypted broker keys (your secrets stay yours)</li>
          <li>— Invite-only — no spam signups, no scraped users</li>
          <li>
            — Built by{" "}
            <a
              href="https://twitter.com/robbooker"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              Rob Booker
            </a>
            , traded on by Rob Booker
          </li>
        </ul>
      </section>

      {/* ── Request Access ── */}
      <section
        id="request-access"
        style={{
          maxWidth: 720, margin: "0 auto", padding: "40px 24px 80px",
          borderTop: "1px solid var(--border)",
        }}
      >
        <h2 style={{
          fontSize: 24, margin: "40px 0 12px", color: "var(--text-primary)",
          fontWeight: 600, letterSpacing: -0.3,
        }}>
          Request Access
        </h2>
        <p style={{
          color: "var(--text-secondary)", fontSize: 15, lineHeight: 1.6,
          margin: "0 0 28px",
        }}>
          Longboard is invite-only while we shake out the live-trading edges.
          Drop your email and a sentence about how you trade — we&apos;ll get
          back to you.
        </p>

        {state === "done" ? (
          <div style={{
            background: "var(--accent-10)", border: "1px solid var(--accent)",
            color: "var(--accent)", borderRadius: 6, padding: "14px 16px",
            fontSize: 14, lineHeight: 1.5,
          }}>
            Thanks — we&apos;ll be in touch.
          </div>
        ) : state === "rate_limited" ? (
          <div style={{
            background: "var(--warning-10)", border: "1px solid var(--warning)",
            color: "var(--warning)", borderRadius: 6, padding: "14px 16px",
            fontSize: 14, lineHeight: 1.5,
          }}>
            Too many requests from your network. Try again in about an hour.
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {errorMsg && (
              <div style={{
                background: "var(--danger-20)", border: "1px solid var(--danger)",
                color: "var(--danger)", borderRadius: 4, padding: "8px 12px", fontSize: 13,
              }}>
                {errorMsg}
              </div>
            )}
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@domain.com"
                autoComplete="email"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>How do you trade? (optional)</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Momentum short-biased, mostly small caps. Trade roughly 3h/day pre-market + open."
                rows={4}
                style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
              />
            </div>
            <button
              type="submit"
              disabled={state === "submitting" || !email.trim()}
              style={{
                alignSelf: "flex-start",
                background: "var(--accent)", color: "var(--bg)",
                border: "none", padding: "12px 22px", borderRadius: 4,
                fontSize: 12, fontWeight: 700, letterSpacing: 1.5,
                textTransform: "uppercase", cursor: state === "submitting" ? "wait" : "pointer",
                opacity: state === "submitting" || !email.trim() ? 0.6 : 1,
                fontFamily: font,
              }}
            >
              {state === "submitting" ? "Sending…" : "Request Access"}
            </button>
          </form>
        )}
      </section>

      {/* ── Footer ── */}
      <footer style={{
        borderTop: "1px solid var(--border)", padding: "24px",
        color: "var(--text-secondary)", fontSize: 12, textAlign: "center",
      }}>
        © 2026 Longboard.ai · Built on Next.js, Supabase, and a lot of coffee ·{" "}
        <a
          href="https://github.com/robbooker/longboard"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--text-secondary)", textDecoration: "underline" }}
        >
          GitHub
        </a>
        {" · "}
        <a href="/" style={{ color: "var(--text-secondary)", textDecoration: "underline" }}>
          Status
        </a>
      </footer>
    </div>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "24px",
    }}>
      <h3 style={{
        fontSize: 16, margin: "0 0 12px", color: "var(--accent)",
        fontWeight: 600, letterSpacing: 0.2,
      }}>
        {title}
      </h3>
      <p style={{
        color: "var(--text-primary)", fontSize: 14, lineHeight: 1.6,
        margin: 0, opacity: 0.85,
      }}>
        {body}
      </p>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10, color: "var(--text-secondary)", letterSpacing: 1.5,
  textTransform: "uppercase", display: "block", marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px",
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 4, color: "var(--text-primary)",
  fontFamily: font, fontSize: 14, outline: "none", boxSizing: "border-box",
};

const responsiveCss = `
.lb-features {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(3, 1fr);
}
@media (max-width: 768px) {
  .lb-features { grid-template-columns: 1fr; }
  .lb-hero h1 { font-size: 32px !important; }
}
`;
