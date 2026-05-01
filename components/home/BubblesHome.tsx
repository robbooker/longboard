"use client";

// Permanent Landing — Bubbles variant (Phase 3N).
// Editorial direction: chaotic full-color cartoon does the heavy lifting in
// the hero. Below the fold the page stays paper-white + ink, with
// testimonials styled as speech bubbles to echo the illustration.
//
// Design-system props from the source artboard are locked:
//   headlineVariant = "E", typePair = "inter", all four sections shown.
// Global DashboardNav is suppressed on this route via DashboardNav itself.

import React from "react";
import Link from "next/link";

const ink = "#0F0E0C";
const bg = "#FCFBF8";          // very faintly off-white paper
const surface = "#FFFFFF";
const surface2 = "#F2F0EB";    // soft tint for cards
const fg = "#0F0E0C";
const mute = "rgba(15,14,12,0.62)";
const line = "rgba(15,14,12,0.14)";
const cream = "#FCFBF8";
const amber = "#F5A524";       // brand amber from the email artifact

const fonts = {
  display: "Helvetica, 'Helvetica Neue', Arial, sans-serif",
  body: "Helvetica, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Courier New', Courier, monospace",
};

// Headline variant E (locked).
const HEAD = [
  { t: "There are 1,000 trading apps. " },
  { t: "You only need one", i: true },
  { t: "." },
];

const css = `
  @keyframes lpwPulse { 0%,55%,100% { opacity: 1 } 60%,90% { opacity: .35 } }
  @keyframes lpbWiggle { 0%,100% { transform: rotate(-1.2deg) } 50% { transform: rotate(1.2deg) } }
  .lpw-cta { transition: transform .12s ease, background .15s ease, filter .15s ease; cursor: pointer; }
  .lpw-cta:hover { transform: translateY(-1px); filter: brightness(1.04); }
  .lpw-cta-primary:hover { background: #2a2723; filter: none; }
  .lpw-link { transition: opacity .12s ease; cursor: pointer; }
  .lpw-link:hover { opacity: .55; }
  .lpw-input:focus { outline: none; border-color: #F5A524; box-shadow: 0 0 0 3px rgba(245,165,36,0.25); }
  .lpb-bubble:nth-child(1) { transform: rotate(-1.5deg); }
  .lpb-bubble:nth-child(2) { transform: rotate(0.8deg); }
  .lpb-bubble:nth-child(3) { transform: rotate(-0.6deg); }

  /* Horizontal padding swaps via this CSS variable. Inline padding strings
     consume var(--bub-hpad) so a single media-query line below collapses
     gutters on every section at once. */
  .bub-home { --bub-hpad: 48px; }

  /* The bubbles design ships paper-white in both light and dark themes —
     the global scanline overlay (rendered from app/layout.tsx) directly
     contradicts that aesthetic in dark mode. Suppress it while the home
     page is mounted; it returns automatically on every other route. */
  .scanline { display: none; }

  @media (max-width: 768px) {
    .bub-home { --bub-hpad: 24px; }

    /* Nav: stack wordmark over a wrapping link cluster. The nav-inner
       padding stays at the inline default (22px var(--bub-hpad)) — that
       reads fine when stacked. !important on the link gap to override
       the inline desktop gap of 32. */
    .bub-nav-inner { flex-direction: column; gap: 16px; align-items: center; }
    .bub-nav-links { gap: 18px !important; flex-wrap: wrap; justify-content: center; }

    /* Three-up: collapse to one column, drop dividers, soften padding. */
    .bub-3up { grid-template-columns: 1fr !important; }
    .bub-3up-cell { padding-left: 0 !important; padding-right: 0 !important; padding-top: 28px !important; padding-bottom: 28px !important; border-right: none !important; border-bottom: 1px solid rgba(15,14,12,0.14); }
    .bub-3up-cell:last-child { border-bottom: none; }

    /* Sample-email region: stack email over the editor sidebar. */
    .bub-sample-grid { grid-template-columns: 1fr !important; gap: 40px !important; }

    /* Inside the sample email: let the +18.7% / $273.54 stat row wrap. */
    .bub-amber-bar { flex-wrap: wrap; gap: 14px; }

    /* Testimonials and the dark CTA: collapse 3-col / 2-col grids. */
    .bub-testimonials { grid-template-columns: 1fr !important; gap: 32px !important; }
    .bub-cta-grid { grid-template-columns: 1fr !important; gap: 40px !important; }

    /* Knock the giant 64px CTA headline down so it doesn't dwarf a 320px screen. */
    .bub-cta-headline { font-size: 44px !important; letter-spacing: -1.4px !important; }
  }
`;

function Eyebrow({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.8, fontWeight: 700, color: color || mute, textTransform: "uppercase" }}>{children}</div>
  );
}

function Wordmark({ size = 18, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, fontFamily: fonts.body, fontWeight: 800, fontSize: size, letterSpacing: -0.4, color: dark ? cream : fg }}>
      <span style={{
        width: size + 8, height: size + 8,
        background: amber, color: ink,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, fontSize: size - 3,
        border: `1.5px solid ${ink}`,
        boxShadow: dark ? "none" : `2px 2px 0 ${ink}`,
      }}>L</span>
      <span>LONGBOARD<span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500, color: "#B8860B" }}>AI</span></span>
    </div>
  );
}

function EmailForm({ dark = false, center = false }: { dark?: boolean; center?: boolean }) {
  return (
    <form onSubmit={(e) => e.preventDefault()} style={{
      display: "flex", flexDirection: "column", gap: 12,
      maxWidth: 580,
      margin: center ? "0 auto" : undefined,
      alignItems: center ? "center" : "stretch",
      width: "100%",
    }}>
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap",
        width: "100%",
        justifyContent: center ? "center" : "flex-start",
      }}>
        <input
          className="lpw-input"
          type="email"
          name="email"
          required
          placeholder="Enter your best email"
          style={{
            flex: "1 1 280px", minWidth: 0,
            height: 60, padding: "0 20px",
            fontSize: 16, fontFamily: fonts.body, fontWeight: 500,
            background: dark ? "rgba(252,251,248,0.06)" : "#FFFFFF",
            color: dark ? cream : fg,
            border: `2px solid ${dark ? "rgba(252,251,248,0.30)" : ink}`,
            borderRadius: 0,
            textAlign: center ? "center" : "left",
          }}
        />
        <button
          type="submit"
          className="lpw-cta"
          style={{
            height: 60, padding: "0 28px",
            fontFamily: fonts.body, fontSize: 14, fontWeight: 800,
            background: amber, color: ink,
            border: `2px solid ${ink}`,
            borderRadius: 0, whiteSpace: "nowrap",
            letterSpacing: 1.4,
            textTransform: "uppercase",
          }}
        >GET MY FREE REPORT →</button>
      </div>
      <div style={{
        fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1,
        color: dark ? "rgba(252,251,248,0.55)" : mute,
        textAlign: center ? "center" : "left",
      }}>
        NO SPAM · UNSUBSCRIBE ANYTIME · ABOUT 4 MINUTES TO READ
      </div>
    </form>
  );
}

const WHATS_IN = [
  { eb: "01 / THE TOP PICK",   h: "The #1 stock of the day.",        b: "One name, ranked by conviction. The catalyst, the float, the levels, the risk — in a paragraph you can actually trade off of." },
  { eb: "02 / THE SHORT LIST", h: "4 more stocks to watch.",         b: "The supporting cast. Each one with a real reason it’s moving — catalyst, float, volume, sentiment. No filler, no slop." },
  { eb: "03 / THE PLAN",       h: "Price targets and stop levels.",  b: "Where to get in, where to get out, and where the trade is wrong. So you’re trading a plan, not a feeling." },
];

const TESTIMONIALS = [
  { q: "I cancelled three other newsletters. This is the only one I open before the open.", n: "Marcus T.", m: "Day trader · Chicago" },
  { q: "It tells me what to look at. Not what to think. That’s the job.", n: "Priya S.", m: "Swing trader · NYC" },
  { q: "Five minutes with my coffee and I know my plan. Best four minutes of my morning.", n: "Jordan K.", m: "Prop firm · Austin" },
];

// Inline reproduction of the email — abbreviated. Uses the email's actual
// cream + amber so the artifact reads as "the email" even on the white page.
const E_BG = "#FBF8F0";
const E_BG2 = "#EFEADD";
const E_INK = "#15120B";
const E_AMB = "#F5A524";
const E_GLD = "#B8860B";

function SampleEmail() {
  return (
    <div style={{
      width: 600, maxWidth: "100%", margin: "0 auto",
      background: E_BG, border: `1px solid rgba(21,18,11,0.14)`, fontFamily: fonts.body,
      boxShadow: "0 30px 60px rgba(15,14,12,0.10)",
    }}>
      <div style={{ background: E_INK, color: E_AMB, padding: "14px 28px", fontFamily: fonts.mono, fontSize: 11, letterSpacing: 2, fontWeight: 700, display: "flex", justifyContent: "space-between" }}>
        <span>● MORNING BRIEF · 09:15 ET</span>
        <span style={{ color: "rgba(244,241,232,0.6)" }}>WED · APR 29 · 2026</span>
      </div>
      <div style={{ padding: "40px 32px 8px" }}>
        <div style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.8, color: E_GLD, fontWeight: 700, marginBottom: 18 }}>● PRE-MARKET MOVERS · ISSUE 142</div>
        <div style={{ fontSize: 44, lineHeight: 0.96, letterSpacing: -1.8, fontWeight: 800, color: E_INK }}>
          Five names<br/>
          <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500, letterSpacing: -1.2 }}>on the radar</span><br/>
          this morning.
        </div>
        <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 16, lineHeight: 1.5, color: "rgba(21,18,11,0.7)", marginTop: 18 }}>
          Ranked by conviction. One mega-cap with a real catalyst. Four more where the tape’s doing the talking.
        </div>
      </div>
      <div style={{ padding: "40px 32px 0" }}>
        <div style={{ borderTop: `2px solid ${E_AMB}`, paddingTop: 18, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.8, color: E_GLD, fontWeight: 700, marginBottom: 14 }}>
          TOP PICK · ★ HIGHEST CONVICTION
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ fontSize: 100, fontWeight: 800, color: E_AMB, letterSpacing: -5, lineHeight: 0.85 }}>01</div>
          <div style={{ paddingTop: 10 }}>
            <div style={{ fontSize: 48, fontWeight: 800, color: E_INK, letterSpacing: -2, lineHeight: 0.95 }}>NXPI</div>
            <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 15, color: "rgba(21,18,11,0.7)", marginTop: 6 }}>NXP Semiconductors N.V.</div>
          </div>
        </div>
        <div className="bub-amber-bar" style={{ marginTop: 22, background: E_AMB, padding: "20px 22px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.8, color: E_INK, fontWeight: 700, marginBottom: 4 }}>AT THE OPEN</div>
            <div style={{ fontSize: 36, fontWeight: 800, color: E_INK, letterSpacing: -1.2, lineHeight: 1 }}>+18.7<span style={{ fontSize: 22 }}>%</span></div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.8, color: "rgba(21,18,11,0.7)", fontWeight: 700, marginBottom: 4 }}>PRICE</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: E_INK, letterSpacing: -0.8, lineHeight: 1 }}>$273.54</div>
          </div>
        </div>
        <div style={{ marginTop: 24 }}>
          <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.8, color: E_GLD, fontWeight: 700, marginBottom: 8 }}>→ THE CATALYST</div>
          <div style={{ fontFamily: fonts.serif, fontSize: 15, lineHeight: 1.6, color: E_INK }}>
            Shares are up roughly <strong style={{ fontFamily: fonts.body, fontStyle: "normal" }}>19%</strong> after the company posted a strong automotive revenue forecast — signaling that demand for chips in EVs and connected vehicles is far from slowing down. <em>For a $58B mega-cap to gap this hard, the print has to be material.</em>
          </div>
        </div>
        <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ background: E_BG2, padding: "16px 18px" }}>
            <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.8, color: E_GLD, fontWeight: 700, marginBottom: 6 }}>FLOAT</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: E_INK, letterSpacing: -1, lineHeight: 1 }}>252.5M</div>
            <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 12, color: "rgba(21,18,11,0.65)", marginTop: 6 }}>Mega-cap. Not a float move.</div>
          </div>
          <div style={{ background: E_BG2, padding: "16px 18px" }}>
            <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.8, color: E_GLD, fontWeight: 700, marginBottom: 6 }}>VOLUME</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: E_INK, letterSpacing: -1, lineHeight: 1 }}>4.7M</div>
            <div style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 12, color: "rgba(21,18,11,0.65)", marginTop: 6 }}>≈5× normal pre-market.</div>
          </div>
        </div>
        <div style={{ marginTop: 28, height: 80, background: `linear-gradient(180deg, transparent 0%, ${E_BG} 100%)` }} />
        <div style={{ textAlign: "center", paddingBottom: 24, fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.6, color: "rgba(21,18,11,0.55)", fontWeight: 700 }}>
          + 4 more names · pulse · levels · sign-off
        </div>
      </div>
    </div>
  );
}

export default function BubblesHome() {
  return (
    <div className="bub-home" data-screen-label="Permanent Landing — Bubbles" style={{ background: bg, color: fg, fontFamily: fonts.body, minHeight: "100%", width: "100%" }}>
      <style>{css}</style>

      {/* Nav — sticky to the top while scrolling */}
      <header style={{
        borderBottom: `1px solid ${line}`,
        background: "rgba(252,251,248,0.92)",
        backdropFilter: "saturate(140%) blur(8px)",
        WebkitBackdropFilter: "saturate(140%) blur(8px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div className="bub-nav-inner" style={{ maxWidth: 1240, margin: "0 auto", padding: "22px var(--bub-hpad)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark size={18} />
          <div className="bub-nav-links" style={{ display: "flex", alignItems: "center", gap: 32, fontSize: 14 }}>
            <Link href="/learn" className="lpw-link" style={{ color: fg, textDecoration: "none" }}>Learn</Link>
            <span className="lpw-link" style={{ color: fg }}>Podcast</span>
            <span className="lpw-link" style={{ color: fg }}>Pricing</span>
            <Link
              href="/login"
              className="lpw-cta lpw-cta-primary"
              style={{
                background: ink, color: cream,
                padding: "10px 18px",
                fontWeight: 700, fontSize: 13, letterSpacing: 0.4,
                textTransform: "uppercase", textDecoration: "none",
                display: "inline-block",
              }}
            >Member sign in</Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section>
        <div style={{ width: "100%", background: bg, paddingTop: 32 }}>
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 var(--bub-hpad)" }}>
            <img
              src="/bubbles-illustration.png"
              alt="A chaotic, cartoony scene of overwhelmed traders surrounded by phones, charts, alerts, Discord/Twitter feeds, FedWatch, and price tickers — with a big black hand-drawn X across the whole tangle. Speech bubbles read 'did I miss the entry?!', 'what's moving now?!', 'wait, what did the Fed say?!', 'this alert just popped up…', 'this is exhausting! I can't keep up!', 'I don't know what to watch anymore!', 'is this signal real or just noise?!'"
              style={{ width: "100%", height: "auto", display: "block" }}
            />
          </div>
        </div>

        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "32px var(--bub-hpad) 96px", textAlign: "center" }}>
          <div style={{ marginBottom: 28, display: "flex", justifyContent: "center" }}>
            <Eyebrow color={mute}>
              <span style={{ display: "inline-block", animation: "lpwPulse 2s ease-in-out infinite", color: ink }}>●</span>{" "}
              THE DAILY BRIEF · 9:15 AM ET
            </Eyebrow>
          </div>

          <h1 style={{
            fontFamily: fonts.display,
            fontSize: "clamp(48px, 6.4vw, 88px)",
            lineHeight: 0.98,
            letterSpacing: -2.4,
            fontWeight: 800,
            margin: "0 auto",
            maxWidth: 1040,
            textWrap: "balance",
            color: fg,
          }}>
            {HEAD.map((seg, i) => seg.i ? (
              <em key={i} style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500, letterSpacing: -1.6 }}>{seg.t}</em>
            ) : (
              <span key={i}>{seg.t}</span>
            ))}
          </h1>

          <p style={{
            fontFamily: fonts.serif, fontStyle: "italic",
            fontSize: 22, lineHeight: 1.5, color: mute,
            margin: "32px auto 40px", maxWidth: 720,
          }}>
            One email. The #1 stock of the day, plus four more worth watching. 9:15am Eastern. Free.
          </p>

          <EmailForm center={true} />
        </div>
      </section>

      {/* THREE-UP */}
      <section style={{ borderTop: `1px solid ${line}`, background: surface }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "88px var(--bub-hpad)" }}>
          <div style={{ marginBottom: 56, maxWidth: 760 }}>
            <Eyebrow>● WHAT YOU GET</Eyebrow>
            <h2 style={{
              fontFamily: fonts.display, fontSize: 48, fontWeight: 800,
              letterSpacing: -1.6, lineHeight: 1.02, margin: "14px 0 0",
              textWrap: "balance", color: fg,
            }}>
              Here’s what you’re getting <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500 }}>for free.</span>
            </h2>
          </div>
          <div className="bub-3up" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, borderTop: `1px solid ${line}` }}>
            {WHATS_IN.map((c, i) => (
              <div key={i} className="bub-3up-cell" style={{
                padding: "36px 32px",
                paddingLeft: i === 0 ? 0 : 32,
                paddingRight: i === 2 ? 0 : 32,
                borderRight: i < 2 ? `1px solid ${line}` : "none",
              }}>
                <Eyebrow>{c.eb}</Eyebrow>
                <div style={{
                  fontFamily: fonts.display, fontSize: 24, fontWeight: 700,
                  letterSpacing: -0.6, lineHeight: 1.18, margin: "18px 0 14px",
                  textWrap: "balance", color: fg,
                }}>{c.h}</div>
                <div style={{ fontFamily: fonts.serif, fontSize: 16, lineHeight: 1.6, color: mute, fontStyle: "italic" }}>{c.b}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SAMPLE EMAIL */}
      <section style={{ borderTop: `1px solid ${line}`, background: bg }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "96px var(--bub-hpad)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
            <Eyebrow>● HERE’S TUESDAY’S</Eyebrow>
            <span style={{ fontFamily: fonts.mono, fontSize: 11, color: mute, letterSpacing: 1.4, fontWeight: 700 }}>ISSUE 142 · APR 28</span>
          </div>
          <h2 style={{
            fontFamily: fonts.display, fontSize: 48, fontWeight: 800,
            letterSpacing: -1.6, lineHeight: 1.02, margin: "14px 0 56px",
            textWrap: "balance", maxWidth: 800, color: fg,
          }}>
            See what shows up <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500 }}>at 9:15 Eastern.</span>
          </h2>

          <div className="bub-sample-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 56, alignItems: "start" }}>
            <div><SampleEmail /></div>
            <aside style={{ paddingTop: 12 }}>
              <Eyebrow>● A NOTE FROM THE EDITOR</Eyebrow>
              <div style={{ fontFamily: fonts.serif, fontSize: 17, lineHeight: 1.6, color: fg, marginTop: 16 }}>
                Every brief follows the same shape: the pulse up top, the conviction pick, four more to watch, a sign-off.
                <br/><br/>
                We don’t pretend to know what’s going to happen. We tell you what’s actually moving and why people are watching it.
              </div>
              <div style={{ marginTop: 28, paddingTop: 24, borderTop: `1px solid ${line}` }}>
                <Eyebrow color={mute}>SIGNAL OVER NOISE</Eyebrow>
                <div style={{ fontFamily: fonts.body, fontSize: 14, color: mute, marginTop: 10, lineHeight: 1.5 }}>
                  Average read time: <strong style={{ color: fg }}>3 min 47 sec</strong>.<br/>
                  Average open rate: <strong style={{ color: fg }}>62%</strong>.
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section style={{ borderTop: `1px solid ${line}`, background: surface }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "96px var(--bub-hpad)" }}>
          <div style={{ marginBottom: 56, maxWidth: 760 }}>
            <Eyebrow>● WHAT READERS ARE SAYING</Eyebrow>
            <h2 style={{
              fontFamily: fonts.display, fontSize: 48, fontWeight: 800,
              letterSpacing: -1.6, lineHeight: 1.02, margin: "14px 0 0",
              textWrap: "balance", color: fg,
            }}>
              People with screens to watch, <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500 }}>and one less newsletter to read.</span>
            </h2>
          </div>

          <div className="bub-testimonials" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 32, paddingTop: 24 }}>
            {TESTIMONIALS.map((t, i) => {
              const tints = [
                { bg: "#FFF6E0", tail: "#FFF6E0" },
                { bg: "#FFFFFF", tail: "#FFFFFF" },
                { bg: surface2, tail: surface2 },
              ];
              const tint = tints[i % tints.length];
              return (
                <figure key={i} className="lpb-bubble" style={{
                  margin: 0,
                  position: "relative",
                  background: tint.bg,
                  border: `2px solid ${ink}`,
                  padding: "32px 28px 28px",
                  boxShadow: `4px 4px 0 ${ink}`,
                  display: "flex", flexDirection: "column", gap: 20,
                }}>
                  <span aria-hidden="true" style={{
                    position: "absolute", left: 36, bottom: -18,
                    width: 28, height: 18,
                    background: tint.tail,
                    borderLeft: `2px solid ${ink}`,
                    borderRight: `2px solid ${ink}`,
                    borderBottom: `2px solid ${ink}`,
                    clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                  }} />
                  <div style={{ fontFamily: fonts.serif, fontSize: 22, lineHeight: 1.35, color: fg, letterSpacing: -0.3, fontWeight: 400 }}>
                    <span style={{ fontFamily: fonts.serif, fontStyle: "italic", color: mute, marginRight: 4 }}>“</span>
                    {t.q}
                    <span style={{ fontFamily: fonts.serif, fontStyle: "italic", color: mute, marginLeft: 2 }}>”</span>
                  </div>
                  <figcaption style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px dashed ${line}` }}>
                    <div style={{ fontFamily: fonts.body, fontWeight: 700, fontSize: 14, color: fg, letterSpacing: -0.1 }}>{t.n}</div>
                    <div style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2, color: mute, fontWeight: 600, marginTop: 4, textTransform: "uppercase" }}>{t.m}</div>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      </section>

      {/* SECOND CTA */}
      <section style={{ background: ink, color: cream }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "96px var(--bub-hpad)" }}>
          <div className="bub-cta-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
            <div>
              <Eyebrow color={"rgba(252,251,248,0.65)"}>● ONE LAST THING</Eyebrow>
              <h2 className="bub-cta-headline" style={{
                fontFamily: fonts.display, fontSize: 64, fontWeight: 800,
                letterSpacing: -2.2, lineHeight: 0.98, margin: "24px 0 0", textWrap: "balance", color: cream,
              }}>
                Your inbox tomorrow morning, <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500 }}>at 9:15 Eastern.</span>
              </h2>
              <div style={{ fontFamily: fonts.serif, fontSize: 18, lineHeight: 1.55, color: "rgba(252,251,248,0.75)", marginTop: 24, maxWidth: 480, fontStyle: "italic" }}>
                Five names ranked by conviction. The pulse. The plan. Out the door before the bell.
              </div>
            </div>
            <div>
              <form onSubmit={(e) => e.preventDefault()} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    className="lpw-input"
                    type="email"
                    name="email"
                    required
                    placeholder="you@somewhere.com"
                    style={{
                      flex: "1 1 280px", minWidth: 0,
                      height: 60, padding: "0 18px",
                      fontSize: 17, fontFamily: fonts.body,
                      background: "rgba(252,251,248,0.06)", color: cream,
                      border: "1px solid rgba(252,251,248,0.22)", borderRadius: 0,
                    }}
                  />
                  <button
                    type="submit"
                    className="lpw-cta"
                    style={{
                      height: 60, padding: "0 28px",
                      fontFamily: fonts.body, fontSize: 16, fontWeight: 700,
                      background: cream, color: ink, border: "none",
                      borderRadius: 0, whiteSpace: "nowrap",
                    }}
                  >Subscribe →</button>
                </div>
                <div style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: "rgba(252,251,248,0.55)" }}>
                  NO SPAM · UNSUBSCRIBE ANYTIME
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: ink, color: "rgba(252,251,248,0.7)", borderTop: "1px solid rgba(252,251,248,0.08)" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "40px var(--bub-hpad)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 24, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.4, fontWeight: 700 }}>
          <Wordmark size={14} dark={true} />
          <div style={{ display: "flex", gap: 32 }}>
            <span className="lpw-link" style={{ color: "rgba(252,251,248,0.85)" }}>ABOUT</span>
            <span className="lpw-link" style={{ color: "rgba(252,251,248,0.85)" }}>DISCLAIMER</span>
          </div>
          <div style={{ color: "rgba(252,251,248,0.55)" }}>© LONGBOARD AI 2026</div>
        </div>
      </footer>
    </div>
  );
}
