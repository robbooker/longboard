"use client";

// Thank You / Subscription Confirmed (Phase 3O).
// Same DNA as BubblesHome: paper-white + ink, amber accent, serif italics
// for emphasis, mono labels, hand-drawn 2px borders + 4px offset shadows.
// typePair = "inter" is locked here, same pattern as BubblesHome.
//
// Whitelist address (rob@lightningstocks.io) is the actual sender. Stored
// once as WHITELIST_EMAIL — likely changes once we move to a branded
// sender domain. Global DashboardNav and the global .scanline overlay are
// both suppressed on /thanks; the page ships its own internal sticky nav.

import React from "react";
import Link from "next/link";

const WHITELIST_EMAIL = "rob@lightningstocks.io";

const bg = "#FCFBF8";
const surface = "#FFFFFF";
const fg = "#0F0E0C";
const ink = "#0F0E0C";
const cream = "#FCFBF8";
const amber = "#F5A524";
const amberSoft = "#FFF6E0";
const gold = "#B8860B";
const mute = "rgba(15,14,12,0.62)";
const line = "rgba(15,14,12,0.14)";

const fonts = {
  display: "Helvetica, 'Helvetica Neue', Arial, sans-serif",
  body: "Helvetica, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'Courier New', Courier, monospace",
};

const HOLIDAYS_2026 = new Set([
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25",
  "2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25",
]);
const HOLIDAYS_2027 = new Set([
  "2027-01-01","2027-01-18","2027-02-15","2027-03-26","2027-05-31",
  "2027-06-18","2027-07-05","2027-09-06","2027-11-25","2027-12-24",
]);

function isHoliday(d: Date): boolean {
  const k = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return HOLIDAYS_2026.has(k) || HOLIDAYS_2027.has(k);
}

function nyParts(date: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

function computeNextTradingDay(): Date {
  const now = new Date();
  const ny = nyParts(now);
  const y = parseInt(ny.year, 10);
  const m = parseInt(ny.month, 10);
  const d = parseInt(ny.day, 10);
  const hour = parseInt(ny.hour, 10);
  const minute = parseInt(ny.minute, 10);

  let candidate = new Date(Date.UTC(y, m - 1, d));
  const todayBeforeCutoff = (hour < 9) || (hour === 9 && minute < 15);

  const advance = (date: Date): Date => {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  };
  const isWeekendOrHoliday = (date: Date): boolean => {
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) return true;
    return isHoliday(date);
  };

  if (!todayBeforeCutoff || isWeekendOrHoliday(candidate)) {
    candidate = advance(candidate);
  }
  while (isWeekendOrHoliday(candidate)) {
    candidate = advance(candidate);
  }
  return candidate;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const css = `
  @keyframes lptyPulse { 0%,55%,100% { opacity: 1 } 60%,90% { opacity: .35 } }
  @keyframes lptyStampIn {
    0%   { transform: scale(0.2) rotate(-30deg); opacity: 0; }
    60%  { transform: scale(1.1) rotate(-6deg); opacity: 1; }
    80%  { transform: scale(0.96) rotate(-7deg); }
    100% { transform: scale(1) rotate(-7deg); }
  }
  @keyframes lptyDrop {
    from { transform: translateY(-12px); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  @keyframes lptyConfettiFall {
    from { transform: translateY(-80px) rotate(0deg); opacity: 0; }
    20%  { opacity: 1; }
    to   { transform: translateY(20px) rotate(360deg); opacity: 1; }
  }
  .lpty-stamp { animation: lptyStampIn .9s cubic-bezier(.2,.8,.2,1) both; }
  .lpty-h1    { animation: lptyDrop .55s ease-out .35s both; }
  .lpty-sub   { animation: lptyDrop .55s ease-out .55s both; }
  .lpty-card  { animation: lptyDrop .55s ease-out .75s both; }
  .lpty-confetti span {
    position: absolute;
    animation: lptyConfettiFall 1.2s ease-out both;
  }
  .lpty-cta { transition: transform .12s ease, filter .15s ease; cursor: pointer; }
  .lpty-cta:hover { transform: translateY(-1px); filter: brightness(1.04); }
  .lpty-link { transition: opacity .12s ease; cursor: pointer; }
  .lpty-link:hover { opacity: .55; }
  .lpty-card-hov { transition: transform .15s ease, box-shadow .15s ease; }
  .lpty-card-hov:hover { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 ${ink}; }

  /* Same shared-padding pattern as BubblesHome (--bub-hpad). All section
     padding strings consume var(--ty-hpad); a single media query swaps
     the desktop 48px gutter for 24px on mobile. */
  .ty-page { --ty-hpad: 48px; }

  /* Suppress global scanline overlay while /thanks is mounted. Same
     reasoning as BubblesHome — the paper-white aesthetic doesn't want
     a dark-mode scanline on top. */
  .scanline { display: none; }

  @media (max-width: 768px) {
    .ty-page { --ty-hpad: 24px; }

    /* Internal nav: stack wordmark over a wrapping link cluster. */
    .ty-nav-inner { flex-direction: column; gap: 16px; align-items: center; }
    .ty-nav-links { gap: 18px !important; flex-wrap: wrap; justify-content: center; }

    /* Hero stamp + sub copy: shrink the top padding so the stamp doesn't
       eat half the viewport before the headline shows up. */
    .ty-hero { padding-top: 56px !important; padding-bottom: 48px !important; }

    /* Countdown card: let the digit row drop below the date block on
       narrow screens. Center the digits so the wrap doesn't look pushed. */
    .ty-countdown-row { justify-content: flex-start !important; }

    /* "What Happens Next" 3-up: collapse to one column, drop dividers. */
    .ty-3up { grid-template-columns: 1fr !important; }
    .ty-3up-cell { padding-left: 0 !important; padding-right: 0 !important; padding-top: 28px !important; padding-bottom: 28px !important; border-right: none !important; border-bottom: 1px solid ${line}; }
    .ty-3up-cell:last-child { border-bottom: none; }

    /* "While You Wait" 3-up cards. */
    .ty-cards { grid-template-columns: 1fr !important; }

    /* "Refer a Friend" two-column grid -> stack. */
    .ty-refer-grid { grid-template-columns: 1fr !important; gap: 40px !important; }

    /* Knock the giant 56px refer headline down. */
    .ty-refer-headline { font-size: 38px !important; letter-spacing: -1.4px !important; }
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
      <span>LONGBOARD<span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500, color: gold }}>AI</span></span>
    </div>
  );
}

export default function ThankYou() {
  const tradingDay = React.useMemo(() => computeNextTradingDay(), []);
  const tdY = tradingDay.getUTCFullYear();
  const tdM = tradingDay.getUTCMonth();
  const tdD = tradingDay.getUTCDate();
  const dayName = tradingDay.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const monthName = tradingDay.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  // 9:15 ET = 13:15 UTC during EST, 14:15 UTC during EDT.
  const tzNameForTradingDay = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", timeZoneName: "short",
  }).formatToParts(tradingDay).find((p) => p.type === "timeZoneName")?.value || "EST";
  const utcOffsetHours = tzNameForTradingDay === "EDT" ? 13 : 14;
  const targetUTC = React.useMemo(
    () => new Date(Date.UTC(tdY, tdM, tdD, utcOffsetHours, 15, 0)),
    [tdY, tdM, tdD, utcOffsetHours],
  );

  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  let diffMs = targetUTC.getTime() - now;
  if (diffMs < 0) diffMs = 0;
  const totalSeconds = Math.floor(diffMs / 1000);
  const dDays = Math.floor(totalSeconds / 86400);
  const dHours = Math.floor((totalSeconds % 86400) / 3600);
  const dMins = Math.floor((totalSeconds % 3600) / 60);
  const dSecs = totalSeconds % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  // Confetti dots — deterministic positions via a seeded LCG-ish so the
  // server render and the first client render agree on layout.
  const palette = [amber, ink, gold, "#E85D5D", "#3A86A8"];
  const seed = (i: number) => {
    const a = Math.sin(i * 9301 + 49297) * 233280;
    return a - Math.floor(a);
  };
  const dots = [];
  for (let i = 0; i < 28; i++) {
    const left = seed(i) * 100;
    const top = seed(i + 99) * 100;
    const size = 6 + seed(i + 7) * 12;
    const rot = seed(i + 23) * 360;
    const col = palette[Math.floor(seed(i + 41) * palette.length)];
    const shape = Math.floor(seed(i + 53) * 3); // 0 dot, 1 square, 2 line
    dots.push({ left, top, size, rot, col, shape, i });
  }

  return (
    <div className="ty-page" data-screen-label="Thank You — Subscription Confirmed" style={{ background: bg, color: fg, fontFamily: fonts.body, minHeight: "100%", width: "100%" }}>
      <style>{css}</style>

      {/* Nav */}
      <header style={{
        borderBottom: `1px solid ${line}`,
        background: "rgba(252,251,248,0.92)",
        backdropFilter: "saturate(140%) blur(8px)",
        WebkitBackdropFilter: "saturate(140%) blur(8px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div className="ty-nav-inner" style={{ maxWidth: 1240, margin: "0 auto", padding: "22px var(--ty-hpad)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Wordmark size={18} />
          <div className="ty-nav-links" style={{ display: "flex", alignItems: "center", gap: 32, fontSize: 14 }}>
            <Link href="/learn" className="lpty-link" style={{ color: fg, textDecoration: "none" }}>Learn</Link>
            <span className="lpty-link" style={{ color: fg }}>Podcast</span>
            <span className="lpty-link" style={{ color: fg }}>Pricing</span>
            <Link
              href="/login"
              className="lpty-cta"
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

      {/* HERO — confirmation */}
      <section style={{ position: "relative", overflow: "hidden" }}>
        <div className="lpty-confetti" aria-hidden="true" style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          maxWidth: 1240, margin: "0 auto",
        }}>
          {dots.map((d) => {
            const common: React.CSSProperties = {
              position: "absolute",
              left: `${d.left}%`,
              top: `${d.top * 0.6}%`,
              width: d.size, height: d.size,
              background: d.shape === 2 ? "transparent" : d.col,
              border: d.shape === 2 ? `2px solid ${d.col}` : `1.5px solid ${ink}`,
              borderRadius: d.shape === 0 ? "50%" : 0,
              transform: `rotate(${d.rot}deg)`,
              animationDelay: `${(d.i % 14) * 0.06}s`,
            };
            if (d.shape === 2) {
              common.height = 2;
              common.background = d.col;
              common.border = "none";
            }
            return <span key={d.i} style={common} />;
          })}
        </div>

        <div className="ty-hero" style={{ maxWidth: 1100, margin: "0 auto", padding: "88px var(--ty-hpad) 72px", textAlign: "center", position: "relative" }}>
          <div className="lpty-stamp" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 132, height: 132, background: amber,
            border: `3px solid ${ink}`,
            boxShadow: `6px 6px 0 ${ink}`,
            color: ink, fontSize: 88, fontWeight: 900, lineHeight: 1,
            transform: "rotate(-7deg)",
            marginBottom: 36,
          }} aria-label="Subscription confirmed">
            <span style={{ marginTop: -6 }}>✓</span>
          </div>

          <div className="lpty-h1">
            <Eyebrow color={mute}>
              <span style={{ display: "inline-block", animation: "lptyPulse 2s ease-in-out infinite", color: ink }}>●</span>{" "}
              SUBSCRIPTION CONFIRMED · WELCOME ABOARD
            </Eyebrow>

            <h1 style={{
              fontFamily: fonts.display,
              fontSize: "clamp(48px, 7.4vw, 104px)",
              lineHeight: 0.96,
              letterSpacing: -2.8,
              fontWeight: 800,
              margin: "20px auto 0",
              maxWidth: 980,
              textWrap: "balance",
              color: fg,
            }}>
              You’re in.{" "}
              <em style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500, letterSpacing: -1.6, color: fg }}>
                Welcome to the Brief.
              </em>
            </h1>
          </div>

          <p className="lpty-sub" style={{
            fontFamily: fonts.serif, fontStyle: "italic",
            fontSize: 24, lineHeight: 1.5, color: mute,
            margin: "32px auto 0", maxWidth: 760,
          }}>
            Your first report lands at <strong style={{ color: fg, fontStyle: "normal", fontFamily: fonts.body, fontWeight: 800 }}>9:15&nbsp;AM Eastern</strong>{" "}
            on <strong style={{ color: fg, fontStyle: "normal", fontFamily: fonts.body, fontWeight: 800 }}>{dayName}, {monthName} {ordinal(tdD)}</strong>.{" "}
            Coffee optional. Reading is brief.
          </p>
        </div>
      </section>

      {/* COUNTDOWN CARD */}
      <section style={{ borderTop: `1px solid ${line}`, background: surface }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "64px var(--ty-hpad)" }}>
          <div className="lpty-card" style={{
            background: ink, color: cream,
            border: `3px solid ${ink}`,
            boxShadow: `6px 6px 0 ${amber}`,
            padding: "40px 48px",
            display: "flex",
            flexWrap: "wrap",
            gap: 36,
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ flex: "1 1 320px", minWidth: 0 }}>
              <Eyebrow color={amber}>● COUNTDOWN TO YOUR FIRST BRIEF</Eyebrow>
              <div style={{
                fontFamily: fonts.display, fontSize: 40, fontWeight: 800,
                letterSpacing: -1.2, lineHeight: 1.05, marginTop: 14, color: cream,
              }}>
                {dayName}, {monthName} {ordinal(tdD)}{" "}
                <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500, color: amber }}>
                  · 9:15 ET
                </span>
              </div>
              <div style={{ fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.4, color: "rgba(252,251,248,0.55)", marginTop: 12, fontWeight: 700 }}>
                THE NEXT TRADING DAY · DELIVERED 15 MINUTES BEFORE THE BELL
              </div>
            </div>

            <div className="ty-countdown-row" style={{ display: "flex", gap: 6, alignItems: "flex-end", flexShrink: 0, flexWrap: "wrap" }}>
              {[
                { v: dDays, l: "DAYS" },
                { v: dHours, l: "HRS" },
                { v: dMins, l: "MIN" },
                { v: dSecs, l: "SEC" },
              ].map((u, i) => (
                <React.Fragment key={u.l}>
                  <div style={{
                    background: "rgba(252,251,248,0.06)",
                    border: "1px solid rgba(252,251,248,0.18)",
                    padding: "14px 14px",
                    minWidth: 78, textAlign: "center",
                  }}>
                    <div style={{
                      fontFamily: fonts.mono, fontSize: 40, fontWeight: 800,
                      color: cream, lineHeight: 1, letterSpacing: -1,
                      fontVariantNumeric: "tabular-nums",
                    }}>{pad2(u.v)}</div>
                    <div style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.6, color: amber, marginTop: 8, fontWeight: 700 }}>{u.l}</div>
                  </div>
                  {i < 3 && <div style={{ fontFamily: fonts.mono, fontSize: 28, color: "rgba(252,251,248,0.35)", paddingBottom: 28 }}>:</div>}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* WHAT HAPPENS NEXT — 3 step timeline */}
      <section style={{ borderTop: `1px solid ${line}`, background: bg }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "88px var(--ty-hpad)" }}>
          <div style={{ marginBottom: 56, maxWidth: 760 }}>
            <Eyebrow>● WHAT HAPPENS NEXT</Eyebrow>
            <h2 style={{
              fontFamily: fonts.display, fontSize: 48, fontWeight: 800,
              letterSpacing: -1.6, lineHeight: 1.02, margin: "14px 0 0",
              textWrap: "balance", color: fg,
            }}>
              Three things, <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500 }}>in order.</span>
            </h2>
          </div>

          <div className="ty-3up" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, borderTop: `1px solid ${line}` }}>
            {[
              {
                eb: "STEP 01 / RIGHT NOW",
                h: "Check your inbox.",
                b: "A short hello from us — landing in the next minute or two. If it doesn’t show up, peek in Promotions or Spam.",
              },
              {
                eb: "STEP 02 / TONIGHT",
                h: "Whitelist us so we land.",
                b: <>Add <strong style={{ fontStyle: "normal", fontFamily: fonts.body, fontWeight: 800, color: fg }}>{WHITELIST_EMAIL}</strong> to your contacts. Gmail folks: drag us into Primary. Outlook: mark as Not Junk.</>,
              },
              {
                eb: "STEP 03 / 9:15 AM ET",
                h: `Your first brief, ${dayName.toLowerCase()}.`,
                b: "One email. The #1 stock of the day, plus four more. Out the door 15 minutes before the bell.",
              },
            ].map((c, i) => (
              <div key={i} className="ty-3up-cell" style={{
                padding: "36px 32px",
                paddingLeft: i === 0 ? 0 : 32,
                paddingRight: i === 2 ? 0 : 32,
                borderRight: i < 2 ? `1px solid ${line}` : "none",
                position: "relative",
              }}>
                <div style={{
                  fontFamily: fonts.display,
                  fontSize: 96, fontWeight: 800,
                  color: amber, letterSpacing: -4, lineHeight: 0.85,
                  marginBottom: 12,
                }}>0{i + 1}</div>
                <Eyebrow>{c.eb}</Eyebrow>
                <div style={{
                  fontFamily: fonts.display, fontSize: 26, fontWeight: 700,
                  letterSpacing: -0.6, lineHeight: 1.15, margin: "14px 0 14px",
                  textWrap: "balance", color: fg,
                }}>{c.h}</div>
                <div style={{ fontFamily: fonts.serif, fontSize: 16, lineHeight: 1.6, color: mute, fontStyle: "italic" }}>{c.b}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHITELIST CALLOUT */}
      <section style={{ borderTop: `1px solid ${line}`, background: surface }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "72px var(--ty-hpad)" }}>
          <div style={{
            background: amberSoft,
            border: `2px solid ${ink}`,
            boxShadow: `4px 4px 0 ${ink}`,
            padding: "40px 44px",
            display: "flex",
            flexWrap: "wrap",
            gap: 32,
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div style={{ flex: "1 1 380px", minWidth: 0 }}>
              <Eyebrow>● A FAVOR, FROM US</Eyebrow>
              <h3 style={{
                fontFamily: fonts.display, fontSize: 32, fontWeight: 800,
                letterSpacing: -1, lineHeight: 1.1, margin: "12px 0 10px",
                color: fg, textWrap: "balance", maxWidth: 680,
              }}>
                Let’s make sure we land in your inbox, <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500 }}>not the spam pile.</span>
              </h3>
              <p style={{ fontFamily: fonts.serif, fontSize: 17, lineHeight: 1.55, color: "rgba(15,14,12,0.72)", margin: 0, fontStyle: "italic", maxWidth: 720 }}>
                Add the address below to your contacts. Two seconds of work today saves a missed trade tomorrow.
              </p>
            </div>
            <div style={{
              fontFamily: fonts.mono, fontSize: 16, fontWeight: 700,
              letterSpacing: 0.5, color: ink,
              background: cream,
              border: `2px solid ${ink}`,
              padding: "16px 22px",
              whiteSpace: "nowrap",
              flexShrink: 0,
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {WHITELIST_EMAIL}
            </div>
          </div>
        </div>
      </section>

      {/* WHILE YOU WAIT */}
      <section style={{ borderTop: `1px solid ${line}`, background: bg }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "88px var(--ty-hpad)" }}>
          <div style={{ marginBottom: 48, maxWidth: 760 }}>
            <Eyebrow>● WHILE YOU WAIT</Eyebrow>
            <h2 style={{
              fontFamily: fonts.display, fontSize: 48, fontWeight: 800,
              letterSpacing: -1.6, lineHeight: 1.02, margin: "14px 0 0",
              textWrap: "balance", color: fg,
            }}>
              A few good reads <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500 }}>for the meantime.</span>
            </h2>
          </div>

          <div className="ty-cards" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
            {[
              { kind: "ESSAY · 7 MIN", title: "Why most morning newsletters are noise.", meta: "Rob Patterson · Apr 18" },
              { kind: "PODCAST · 32 MIN", title: "How to read a pre-market tape.", meta: "Episode 11 · Apr 22" },
              { kind: "ARCHIVE", title: "Yesterday’s brief. The five names.", meta: "Issue 142 · Apr 28" },
            ].map((c, i) => (
              <a key={i} href="#" className="lpty-card-hov" style={{
                display: "block", textDecoration: "none", color: "inherit",
                background: surface, border: `2px solid ${ink}`,
                boxShadow: `4px 4px 0 ${ink}`,
                padding: "28px 26px",
              }}>
                <Eyebrow>{c.kind}</Eyebrow>
                <div style={{
                  fontFamily: fonts.display, fontSize: 24, fontWeight: 700,
                  letterSpacing: -0.5, lineHeight: 1.18, margin: "14px 0 24px",
                  textWrap: "balance", color: fg, minHeight: 84,
                }}>{c.title}</div>
                <div style={{
                  fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.4,
                  color: mute, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  paddingTop: 16, borderTop: `1px dashed ${line}`,
                }}>
                  <span>{c.meta}</span>
                  <span style={{ color: fg }}>READ →</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* REFER A FRIEND */}
      <section style={{ borderTop: `1px solid ${line}`, background: ink, color: cream }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "88px var(--ty-hpad)" }}>
          <div className="ty-refer-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }}>
            <div>
              <Eyebrow color={amber}>● TELL A FRIEND</Eyebrow>
              <h2 className="ty-refer-headline" style={{
                fontFamily: fonts.display, fontSize: 56, fontWeight: 800,
                letterSpacing: -2, lineHeight: 0.98, margin: "20px 0 0",
                textWrap: "balance", color: cream,
              }}>
                Know someone <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontWeight: 500 }}>with too many tabs open?</span>
              </h2>
              <p style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 18, lineHeight: 1.55, color: "rgba(252,251,248,0.75)", margin: "24px 0 0", maxWidth: 520 }}>
                The Brief is free. Send it to a friend who could use one fewer thing to read in the morning.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                background: "rgba(252,251,248,0.06)",
                border: "1px solid rgba(252,251,248,0.22)",
                padding: "0 8px 0 18px",
                height: 60,
              }}>
                <span style={{ flex: 1, fontFamily: fonts.mono, fontSize: 14, color: "rgba(252,251,248,0.85)", letterSpacing: 0.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  longboard.ai/?ref=you
                </span>
                <button className="lpty-cta" style={{
                  height: 44, padding: "0 18px",
                  fontFamily: fonts.body, fontSize: 12, fontWeight: 800,
                  background: amber, color: ink, border: `1.5px solid ${ink}`,
                  letterSpacing: 1.4, textTransform: "uppercase",
                }}>Copy link</button>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["Email it", "X / Twitter", "LinkedIn", "Text a friend"].map((s) => (
                  <button key={s} className="lpty-cta" style={{
                    fontFamily: fonts.body, fontSize: 13, fontWeight: 700,
                    background: "transparent", color: cream,
                    border: "1px solid rgba(252,251,248,0.30)",
                    padding: "10px 16px",
                    letterSpacing: 0.4,
                  }}>{s}</button>
                ))}
              </div>
              <div style={{ fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1, color: "rgba(252,251,248,0.55)", marginTop: 4 }}>
                NO REWARDS PROGRAM · NO POINTS · JUST A GOOD READ TO PASS ALONG
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: ink, color: "rgba(252,251,248,0.7)", borderTop: "1px solid rgba(252,251,248,0.08)" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "40px var(--ty-hpad)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 24, fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1.4, fontWeight: 700 }}>
          <Wordmark size={14} dark={true} />
          <div style={{ display: "flex", gap: 32 }}>
            <Link className="lpty-link" href="/privacy" style={{ color: "rgba(252,251,248,0.85)", textDecoration: "none" }}>PRIVACY</Link>
            <Link className="lpty-link" href="/terms" style={{ color: "rgba(252,251,248,0.85)", textDecoration: "none" }}>TERMS</Link>
          </div>
          <div style={{ color: "rgba(252,251,248,0.55)" }}>© LONGBOARD AI 2026</div>
        </div>
      </footer>
    </div>
  );
}
