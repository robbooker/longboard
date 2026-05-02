"use client";

import React, { useEffect, useState } from "react";
import type { MorningArchiveRow, Stock } from "@/lib/morningArchive";

type LiveTime = { clock: string; session: string; dateStr: string; weekdayLong: string };

// Static fallback strings used for SSR + first client paint pre-hydration.
// Match the original mockup so the page degrades gracefully if JS is off.
const FALLBACK: LiveTime = {
  clock: "9:42 ET",
  session: "MARKET OPEN",
  dateStr: "FRI · MAY 1 · 2026",
  weekdayLong: "Friday",
};

// NOTE: NYSE holiday handling is intentionally out of scope here — a future
// pass can layer in a holiday calendar lookup. For now weekends + standard
// 4:00 / 9:30 / 16:00 / 20:00 ET equity-session boundaries are enough.
function computeLiveTime(): LiveTime {
  const now = new Date();

  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hourRaw = timeParts.find((p) => p.type === "hour")?.value ?? "0";
  // en-US with hour12:false renders midnight as "24"; normalize to 0..23.
  const hour = Number(hourRaw) % 24;
  const minute = timeParts.find((p) => p.type === "minute")?.value ?? "00";
  const clock = `${hour}:${minute} ET`;

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(now);
  const weekday = dateParts.find((p) => p.type === "weekday")?.value ?? "";
  const month = dateParts.find((p) => p.type === "month")?.value ?? "";
  const day = dateParts.find((p) => p.type === "day")?.value ?? "";
  const year = dateParts.find((p) => p.type === "year")?.value ?? "";
  const dateStr = `${weekday.toUpperCase()} · ${month.toUpperCase()} ${day} · ${year}`;

  const weekdayLong = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(now);

  const minutesOfDay = hour * 60 + Number(minute);
  const isWeekend = weekday === "Sat" || weekday === "Sun";
  let session: string;
  if (isWeekend) session = "CLOSED";
  else if (minutesOfDay >= 4 * 60 && minutesOfDay < 9 * 60 + 30) session = "PRE-MARKET";
  else if (minutesOfDay >= 9 * 60 + 30 && minutesOfDay < 16 * 60) session = "MARKET OPEN";
  else if (minutesOfDay >= 16 * 60 && minutesOfDay < 20 * 60) session = "AFTER-HOURS";
  else session = "CLOSED";

  return { clock, session, dateStr, weekdayLong };
}

// ---------- snapshot formatting helpers ----------

function formatVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

function formatPct(n: number, decimals = 1): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return sign + n.toFixed(decimals) + "%";
}

function formatRiskFlags(flags: string[] | undefined | null): string {
  if (!flags || flags.length === 0) return "";
  return "▲ RISK FLAGS · " + flags.map((f) => f.toUpperCase()).join(" · ");
}

// "9:42 AM ET · FRI · MAY 1 · 2026" — created_at rendered in NY time.
function formatSnapshotTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);
  const hr = tParts.find((p) => p.type === "hour")?.value ?? "0";
  const min = tParts.find((p) => p.type === "minute")?.value ?? "00";
  const dp = (tParts.find((p) => p.type === "dayPeriod")?.value ?? "AM").toUpperCase();
  const dParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const wk = (dParts.find((p) => p.type === "weekday")?.value ?? "").toUpperCase();
  const mo = (dParts.find((p) => p.type === "month")?.value ?? "").toUpperCase();
  const day = dParts.find((p) => p.type === "day")?.value ?? "";
  const yr = dParts.find((p) => p.type === "year")?.value ?? "";
  return `${hr}:${min} ${dp} ET · ${wk} · ${mo} ${day} · ${yr}`;
}

type Props = {
  initialSnapshot: MorningArchiveRow | null;
};

export default function CommandCenterV2({ initialSnapshot }: Props) {
  const [mounted, setMounted] = useState(false);
  const [live, setLive] = useState<LiveTime>(FALLBACK);
  const [snapshot, setSnapshot] = useState<MorningArchiveRow | null>(initialSnapshot);

  useEffect(() => {
    setMounted(true);
    const tick = () => setLive(computeLiveTime());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Poll /api/command2/snapshot every 60s for snapshot freshness without
  // a page refresh. Aborts in-flight requests on unmount + on each new
  // tick so we don't race state updates.
  useEffect(() => {
    let cancelled = false;
    const fetchSnapshot = async () => {
      try {
        const res = await fetch("/api/command2/snapshot", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as MorningArchiveRow | null;
        if (!cancelled) setSnapshot(data);
      } catch {
        // Network blip — keep the existing snapshot, try again next tick.
      }
    };
    const id = setInterval(fetchSnapshot, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const display = mounted ? live : FALLBACK;

  // ---- derived snapshot data ----
  const stocks: Stock[] = snapshot?.stocks_json ?? [];
  const hero: Stock | null = stocks[0] ?? null;
  const rankedRows: Stock[] = stocks.slice(1, 5);
  const hasData = stocks.length > 0;

  const avgMove = hasData
    ? stocks.reduce((sum, s) => sum + (s.change_pct ?? 0), 0) / stocks.length
    : 0;
  const totalVol = stocks.reduce((sum, s) => sum + (s.volume ?? 0), 0);
  const snapshotTimeStr = snapshot?.created_at ? formatSnapshotTime(snapshot.created_at) : "";

  return (
    <div className="cc2-root">
      <style>{`
        .cc2-root{
          --cream:#F6F2E9;
          --card:#FBF8F0;
          --card-2:#EFEADD;
          --ink:#15120B;
          --ink-70:rgba(21,18,11,0.72);
          --ink-55:rgba(21,18,11,0.55);
          --ink-30:rgba(21,18,11,0.16);
          --amber:#F5A524;
          --gold:#B8860B;
          --up:oklch(0.58 0.13 148);
          --down:oklch(0.55 0.18 28);
          --paper:rgba(244,241,232,0.85);
          --paper-55:rgba(244,241,232,0.55);
          --paper-18:rgba(244,241,232,0.18);
          --cc2-hpad:28px;
          background:var(--cream);
          color:var(--ink);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
          min-height:100vh;
        }
        .cc2-root *{box-sizing:border-box}
        .cc2-root a{color:inherit;text-decoration:none}
        .cc2-root .mono{font-family:'Courier New',Courier,monospace;letter-spacing:1.6px;text-transform:uppercase;font-weight:700}
        .cc2-root .ed{font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:500}

        /* ===== TOP NAV ===== */
        .cc2-root .nav{
          background:var(--ink);color:var(--paper);
          border-bottom:1px solid #000;
        }
        .cc2-root .nav-inner{
          max-width:1480px;margin:0 auto;
          display:flex;align-items:center;gap:32px;
          padding:14px var(--cc2-hpad);
        }
        .cc2-root .brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-0.4px;font-size:18px}
        .cc2-root .brand .mark{
          width:26px;height:26px;background:var(--amber);color:var(--ink);
          display:grid;place-items:center;font-weight:900;font-size:14px;
        }
        .cc2-root .brand em{font-family:Georgia,serif;color:var(--amber);font-weight:500}
        .cc2-root .nav ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;font-size:13px;font-weight:600;color:rgba(244,241,232,0.78)}
        .cc2-root .nav ul li.active{color:var(--amber)}
        .cc2-root .nav ul li.active::before{content:"● ";font-size:9px;vertical-align:middle;margin-right:4px}
        .cc2-root .nav-right{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:12px;color:rgba(244,241,232,0.7)}
        .cc2-root .search{
          display:flex;align-items:center;gap:8px;
          background:rgba(244,241,232,0.06);
          border:1px solid rgba(244,241,232,0.14);
          padding:7px 12px;min-width:240px;
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;
          color:rgba(244,241,232,0.6);
        }
        .cc2-root .search .kbd{margin-left:auto;border:1px solid rgba(244,241,232,0.2);padding:1px 6px;font-size:10px}
        .cc2-root .live-pip{
          display:inline-flex;align-items:center;gap:6px;
          color:var(--amber);font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;font-weight:700;
        }
        .cc2-root .live-pip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 0 rgba(245,165,36,0.6);animation:cc2-pulse 1.6s infinite}
        @keyframes cc2-pulse{
          0%{box-shadow:0 0 0 0 rgba(245,165,36,0.55)}
          70%{box-shadow:0 0 0 8px rgba(245,165,36,0)}
          100%{box-shadow:0 0 0 0 rgba(245,165,36,0)}
        }
        .cc2-root .avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#F5A524,#B8860B);display:grid;place-items:center;color:var(--ink);font-weight:800;font-size:12px}

        /* ===== TICKER STRIP ===== */
        .cc2-root .strip{
          background:var(--ink);color:var(--paper);
          border-top:1px solid rgba(244,241,232,0.08);
          overflow:hidden;
          font-family:'Courier New',monospace;font-size:12px;letter-spacing:1.4px;
        }
        .cc2-root .strip-inner{
          display:flex;align-items:center;gap:0;
          padding:10px var(--cc2-hpad);
          max-width:1480px;margin:0 auto;
          white-space:nowrap;
        }
        .cc2-root .strip-tag{
          color:var(--amber);font-weight:700;margin-right:18px;
          border-right:1px solid rgba(244,241,232,0.18);padding-right:18px;
        }
        .cc2-root .ticks{display:flex;gap:24px;overflow:hidden;flex:1}
        .cc2-root .tick{display:inline-flex;align-items:baseline;gap:8px}
        .cc2-root .tick b{color:var(--paper);font-family:Helvetica,Arial,sans-serif;font-weight:800;letter-spacing:-0.3px}
        .cc2-root .tick .up{color:var(--amber)}
        .cc2-root .tick .dn{color:#E66B5C}
        .cc2-root .clock{margin-left:auto;color:rgba(244,241,232,0.55);padding-left:18px;border-left:1px solid rgba(244,241,232,0.18)}

        /* ===== PAGE HEADER ===== */
        .cc2-root .page{
          max-width:1480px;margin:0 auto;
          padding:32px var(--cc2-hpad) 12px;
        }
        .cc2-root .crumb{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.8px;color:var(--gold);font-weight:700;margin-bottom:14px}
        .cc2-root .crumb span{color:var(--ink-55);margin:0 8px}
        .cc2-root .page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:2px solid var(--amber);padding-bottom:22px}
        .cc2-root h1{
          margin:0;font-size:64px;line-height:0.94;letter-spacing:-2.6px;font-weight:800;
        }
        .cc2-root h1 .ed{display:inline;letter-spacing:-1.6px}
        .cc2-root .sub{font-family:Georgia,serif;font-style:italic;font-size:18px;color:var(--ink-70);margin-top:14px;max-width:620px;line-height:1.45}
        .cc2-root .head-meta{
          display:flex;gap:28px;align-items:flex-end;
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;color:var(--ink-55);font-weight:700;
        }
        .cc2-root .head-meta div b{display:block;font-family:Helvetica,Arial,sans-serif;font-size:22px;letter-spacing:-0.6px;color:var(--ink);margin-top:4px;font-weight:800}
        .cc2-root .head-meta div b.amb{color:var(--gold)}

        /* ===== MAIN GRID ===== */
        .cc2-root .grid{
          max-width:1480px;margin:0 auto;
          padding:28px var(--cc2-hpad) 64px;
          display:grid;grid-template-columns:2fr 1fr;gap:28px;
        }
        @media (max-width:1080px){ .cc2-root .grid{grid-template-columns:1fr} }

        /* ===== LEFT COLUMN ===== */
        .cc2-root .col-head{
          display:flex;align-items:center;justify-content:space-between;gap:16px;
          border-top:2px solid var(--amber);padding-top:16px;margin-bottom:18px;
        }
        .cc2-root .col-head .mono{font-size:11px;color:var(--gold)}

        /* HERO PICK */
        .cc2-root .hero{
          background:var(--card);border:1px solid var(--ink-30);
          padding:0;overflow:hidden;
        }
        .cc2-root .hero-top{
          display:grid;grid-template-columns:170px 1fr auto;
          align-items:center;gap:18px;
          padding:26px 28px 22px;
          border-bottom:1px solid var(--ink-30);
        }
        .cc2-root .pick-num{font-size:140px;font-weight:800;color:var(--amber);letter-spacing:-7px;line-height:0.82;font-family:Helvetica,Arial,sans-serif}
        .cc2-root .ticker-block .sym{font-size:68px;font-weight:800;letter-spacing:-3px;line-height:0.95}
        .cc2-root .ticker-block .name{font-family:Georgia,serif;font-style:italic;font-size:18px;color:var(--ink-70);margin-top:8px}
        .cc2-root .ticker-block .tags{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}
        .cc2-root .tag{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;font-weight:700;background:var(--card-2);color:var(--ink);padding:5px 9px}
        .cc2-root .tag.star{background:var(--ink);color:var(--amber)}

        .cc2-root .hero-price{text-align:right}
        .cc2-root .hero-price .mono{color:var(--gold);font-size:10px}
        .cc2-root .hero-price .pct{font-size:46px;font-weight:800;letter-spacing:-1.6px;color:var(--ink);line-height:1}
        .cc2-root .hero-price .pct b{color:var(--gold)}
        .cc2-root .hero-price .px{font-family:Helvetica;font-size:24px;font-weight:800;letter-spacing:-0.8px;margin-top:4px}
        .cc2-root .hero-price .px small{font-family:'Courier New',monospace;font-size:11px;color:var(--ink-55);letter-spacing:1.2px;font-weight:700;margin-left:6px}

        /* sparkline strip */
        .cc2-root .spark-bar{
          background:var(--ink);color:var(--paper);
          padding:18px 28px;display:grid;grid-template-columns:1fr 1.4fr 1fr;gap:24px;align-items:center;
        }
        .cc2-root .spark-bar .lbl{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--paper-55);font-weight:700;margin-bottom:6px}
        .cc2-root .spark-bar .v{font-family:Helvetica;font-size:22px;font-weight:800;letter-spacing:-0.8px;color:var(--paper)}
        .cc2-root .spark-bar .v.amb{color:var(--amber)}
        .cc2-root .spark-bar svg{width:100%;height:60px;display:block}
        .cc2-root .spark-meta{display:flex;flex-direction:column;gap:6px;font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.2px;color:var(--paper-55);font-weight:700}
        .cc2-root .spark-meta b{color:var(--paper);font-family:Helvetica,Arial,sans-serif;letter-spacing:-0.4px}

        .cc2-root .hero-body{padding:26px 28px 22px;display:grid;grid-template-columns:1.4fr 1fr;gap:28px}
        .cc2-root .catalyst h3{margin:0 0 10px;font-size:20px;letter-spacing:-0.4px;line-height:1.35}
        .cc2-root .catalyst ul{margin:0;padding-left:18px}
        .cc2-root .catalyst li{font-family:Georgia,serif;font-size:15px;line-height:1.5;color:var(--ink);margin-bottom:6px}
        .cc2-root .risks{margin-top:14px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--gold);font-weight:700;line-height:1.6}

        .cc2-root .targets{background:var(--card-2);padding:18px 20px}
        .cc2-root .targets h4{margin:0 0 12px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.6px;color:var(--gold);font-weight:700}
        .cc2-root .lvl{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:10px 0;border-top:1px solid var(--ink-30)}
        .cc2-root .lvl:first-of-type{border-top:none}
        .cc2-root .lvl .k{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;color:var(--gold);font-weight:700}
        .cc2-root .lvl .k.dn{color:var(--ink-55)}
        .cc2-root .lvl .v{font-weight:800;letter-spacing:-0.4px;font-size:18px}
        .cc2-root .lvl .v small{color:var(--ink-55);font-weight:700;font-size:13px;margin-left:4px}

        .cc2-root .hero-foot{
          border-top:1px solid var(--ink-30);
          padding:14px 28px;
          display:flex;justify-content:space-between;align-items:center;gap:14px;
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.3px;color:var(--ink-70);font-weight:700;
        }
        .cc2-root .hero-foot .actions{display:flex;gap:8px}
        .cc2-root .btn{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;font-weight:700;padding:8px 14px;border:1px solid var(--ink);background:var(--card);color:var(--ink);cursor:pointer}
        .cc2-root .btn.primary{background:var(--ink);color:var(--amber)}
        .cc2-root .btn.amber{background:var(--amber);color:var(--ink);border-color:var(--amber)}

        /* RANKED LIST */
        .cc2-root .row{
          background:var(--card);border:1px solid var(--ink-30);
          border-top:none;
          display:grid;grid-template-columns:90px 1.4fr 1fr 1.6fr auto;
          gap:18px;align-items:center;
          padding:18px 22px;
        }
        .cc2-root .row:first-of-type{border-top:1px solid var(--ink-30)}
        .cc2-root .row .num{font-size:64px;font-weight:800;color:var(--gold);letter-spacing:-3px;line-height:0.85;font-family:Helvetica,Arial,sans-serif}
        .cc2-root .row .sym{font-size:34px;font-weight:800;letter-spacing:-1.4px;line-height:1}
        .cc2-root .row .name{font-family:Georgia,serif;font-style:italic;font-size:13px;color:var(--ink-55);margin-top:4px;line-height:1.3}
        .cc2-root .row .pct{font-size:30px;font-weight:800;color:var(--gold);letter-spacing:-1px;line-height:1}
        .cc2-root .row .px{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.2px;color:var(--ink-70);font-weight:700;margin-top:6px}
        .cc2-root .row .blurb{font-size:14px;line-height:1.4;color:var(--ink);font-weight:600;letter-spacing:-0.2px}
        .cc2-root .row .blurb .micro{display:block;margin-top:6px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.2px;color:var(--gold);font-weight:700}
        .cc2-root .row svg.spark{width:88px;height:36px;display:block}
        .cc2-root .row .right{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
        .cc2-root .row .right .vol{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.2px;color:var(--ink-55);font-weight:700}
        .cc2-root .row .right .go{font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;color:var(--ink);font-weight:700;border-bottom:1px solid var(--ink)}

        /* ===== RIGHT RAIL ===== */
        .cc2-root .rail{display:flex;flex-direction:column;gap:18px}
        .cc2-root .panel{background:var(--card);border:1px solid var(--ink-30)}
        .cc2-root .panel.dark{background:var(--ink);color:var(--paper);border-color:#000}
        .cc2-root .panel-head{
          display:flex;justify-content:space-between;align-items:center;gap:10px;
          padding:14px 18px;border-bottom:1px solid var(--ink-30);
          font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.6px;font-weight:700;color:var(--gold);
        }
        .cc2-root .panel.dark .panel-head{border-color:var(--paper-18);color:var(--amber)}
        .cc2-root .panel-head .right{color:var(--ink-55);font-size:10px}
        .cc2-root .panel.dark .panel-head .right{color:var(--paper-55)}

        /* webinar */
        .cc2-root .video{
          position:relative;aspect-ratio:16/9;
          background:radial-gradient(ellipse at 30% 40%,#3a2c14 0%,#15120B 70%);
          color:var(--paper);overflow:hidden;
        }
        .cc2-root .video::before{
          content:"";position:absolute;inset:0;
          background-image:repeating-linear-gradient(0deg,rgba(244,241,232,0.04) 0 1px,transparent 1px 4px);
          pointer-events:none;
        }
        .cc2-root .video-figure{
          position:absolute;inset:0;display:grid;place-items:center;
        }
        .cc2-root .speaker{
          width:62%;aspect-ratio:1;border-radius:50%;
          background:
            radial-gradient(circle at 50% 35%, #d09a55 0%, #8b5e2c 35%, #3a2818 70%, transparent 72%),
            radial-gradient(circle at 50% 78%, #2a1f10 0%, transparent 50%);
          filter:contrast(1.05);
          position:relative;
        }
        .cc2-root .speaker::after{
          content:"";position:absolute;inset:0;border-radius:50%;
          box-shadow:inset 0 -40px 60px rgba(0,0,0,0.5),inset 0 30px 60px rgba(245,165,36,0.08);
        }
        /* chat */
        .cc2-root .chat-body{padding:6px 14px 0;max-height:260px;overflow:hidden;position:relative}
        .cc2-root .chat-body::after{content:"";position:absolute;left:0;right:0;top:0;height:24px;background:linear-gradient(var(--card),transparent);pointer-events:none}
        .cc2-root .msg{padding:8px 4px;border-bottom:1px dashed var(--ink-30);font-size:13px;line-height:1.4}
        .cc2-root .msg:last-child{border-bottom:none}
        .cc2-root .msg .who{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.3px;color:var(--gold);font-weight:700;margin-right:8px}
        .cc2-root .msg .who.mod{color:var(--ink);background:var(--amber);padding:2px 6px}
        .cc2-root .msg .who.you{color:var(--ink)}
        .cc2-root .chat-input{
          display:flex;gap:8px;align-items:center;
          padding:10px 14px;border-top:1px solid var(--ink-30);background:var(--card-2);
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.2px;color:var(--ink-55);
        }
        .cc2-root .chat-input input{flex:1;border:none;background:transparent;font:inherit;color:var(--ink);outline:none}
        .cc2-root .chat-input button{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.6px;font-weight:700;padding:6px 10px;background:var(--ink);color:var(--amber);border:none;cursor:pointer}

        /* alerts feed */
        .cc2-root .alerts .alert{
          display:grid;grid-template-columns:60px 1fr auto;gap:10px;align-items:flex-start;
          padding:12px 18px;border-top:1px solid var(--paper-18);
        }
        .cc2-root .alerts .alert:first-child{border-top:none}
        .cc2-root .alerts .t{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.2px;color:var(--paper-55);font-weight:700;padding-top:2px}
        .cc2-root .alerts .body{font-size:13px;line-height:1.4;color:var(--paper)}
        .cc2-root .alerts .body b{color:var(--amber);font-weight:800}
        .cc2-root .alerts .body em{font-family:Georgia,serif;color:var(--paper-55);font-style:italic;font-weight:500}
        .cc2-root .alerts .pct{font-family:Helvetica;font-weight:800;font-size:14px;letter-spacing:-0.4px;color:var(--amber)}
        .cc2-root .alerts .pct.dn{color:#E66B5C}

        /* market pulse mini */
        .cc2-root .pulse{display:grid;grid-template-columns:1fr 1fr;gap:0}
        .cc2-root .pulse > div{padding:14px 16px;border-top:1px solid var(--paper-18);border-right:1px solid var(--paper-18)}
        .cc2-root .pulse > div:nth-child(2n){border-right:none}
        .cc2-root .pulse > div:nth-child(-n+2){border-top:none}
        .cc2-root .pulse .lbl{font-family:'Courier New',monospace;font-size:9px;letter-spacing:1.4px;color:var(--paper-55);font-weight:700;margin-bottom:6px}
        .cc2-root .pulse .v{font-family:Helvetica;font-size:22px;font-weight:800;letter-spacing:-0.8px;line-height:1}
        .cc2-root .pulse .v.amb{color:var(--amber)}
        .cc2-root .pulse .sub{font-family:Georgia,serif;font-style:italic;font-size:11px;color:var(--paper-55);margin-top:4px}

        /* snapshot meta + empty state */
        .cc2-root .snapshot-time{
          margin-top:14px;font-family:'Courier New',monospace;font-size:10px;
          letter-spacing:1.4px;color:var(--ink-55);font-weight:700;
        }
        .cc2-root .empty-notice{
          background:var(--card);border:1px solid var(--ink-30);
          padding:32px 28px;text-align:center;
        }
        .cc2-root .empty-notice .lbl{
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;
          color:var(--gold);font-weight:700;margin-bottom:10px;
        }
        .cc2-root .empty-notice .msg{
          font-family:Georgia,serif;font-style:italic;font-size:18px;color:var(--ink-70);
        }
        .cc2-root .row .tgt{
          margin-top:2px;font-family:'Courier New',monospace;font-size:10px;
          letter-spacing:1.2px;color:var(--ink-55);font-weight:700;
        }
        .cc2-root .lvl-why{
          font-family:Georgia,serif;font-style:italic;font-size:12px;
          color:var(--ink-55);line-height:1.4;padding:0 0 8px 0;
        }

        /* footer */
        .cc2-root .foot{
          max-width:1480px;margin:0 auto;
          padding:16px var(--cc2-hpad) 32px;
          font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.4px;color:var(--ink-55);font-weight:700;
          display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;
        }

        /* ===== MOBILE (≤768) ===== */
        @media (max-width:768px){
          .cc2-root{ --cc2-hpad:16px }

          .cc2-root .nav-inner{ gap:14px }
          .cc2-root .nav ul{ display:none }
          .cc2-root .nav .search{ display:none }
          .cc2-root .nav-right{ gap:12px }
          .cc2-root .nav-right .plan-tag{ display:none }

          .cc2-root .strip{ overflow-x:auto }
          .cc2-root .ticks{ overflow:visible }

          .cc2-root .page-head{ gap:18px }
          .cc2-root h1{ font-size:38px; letter-spacing:-1.4px }
          .cc2-root h1 .ed{ letter-spacing:-0.8px }
          .cc2-root .sub{ font-size:16px; max-width:none }
          .cc2-root .head-meta{ flex-wrap:wrap; gap:14px 22px }
          .cc2-root .head-meta div b{ font-size:18px }

          .cc2-root .col-head{ flex-wrap:wrap }

          .cc2-root .hero-top{
            grid-template-columns:1fr;
            gap:14px;
            padding:22px 22px 18px;
          }
          .cc2-root .pick-num{ font-size:80px; letter-spacing:-3px; line-height:1 }
          .cc2-root .ticker-block .sym{ font-size:48px; letter-spacing:-2px }
          .cc2-root .ticker-block .name{ font-size:16px }
          .cc2-root .hero-price{ text-align:left }
          .cc2-root .hero-price .pct{ font-size:38px }

          .cc2-root .spark-bar{ grid-template-columns:1fr; padding:18px 22px; gap:14px }
          .cc2-root .spark-meta{ flex-direction:row; flex-wrap:wrap; gap:6px 16px }

          .cc2-root .hero-body{
            grid-template-columns:1fr;
            padding:22px 22px 18px;
            gap:18px;
          }

          .cc2-root .hero-foot{ padding:14px 22px; flex-wrap:wrap; gap:10px }
          .cc2-root .hero-foot .actions{ flex-wrap:wrap }

          .cc2-root .row{
            grid-template-columns:1fr;
            gap:10px;
            padding:18px;
          }
          .cc2-root .row .num{ font-size:42px; letter-spacing:-1.6px }
          .cc2-root .row .sym{ font-size:28px; letter-spacing:-1px }
          .cc2-root .row .pct{ font-size:22px }
          .cc2-root .row .right{
            flex-direction:row;
            align-items:center;
            justify-content:space-between;
            width:100%;
          }
          .cc2-root .row svg.spark{ width:72px; height:30px }

          .cc2-root .foot{ font-size:9px }
        }
      `}</style>

      {/* =============== TOP NAV =============== */}
      <nav className="nav">
        <div className="nav-inner">
          <div className="brand">
            <span className="mark">L</span>
            LONGBOARD<em>AI</em>
          </div>
          <ul>
            <li className="active">Command Center</li>
            <li>Morning Brief</li>
            <li>Screeners</li>
            <li>Watchlists</li>
            <li>Replays</li>
            <li>Education</li>
          </ul>
          <div className="nav-right">
            <span className="live-pip">{display.session} · {display.clock}</span>
            <div className="search">
              <span>🔍</span>
              <span>SEARCH TICKERS, FILINGS…</span>
              <span className="kbd">⌘K</span>
            </div>
            <span className="plan-tag">Plan: Pro</span>
            <div className="avatar">RD</div>
          </div>
        </div>
      </nav>

      {/* =============== TICKER STRIP =============== */}
      <div className="strip">
        <div className="strip-inner">
          <span className="strip-tag">● LIVE TAPE</span>
          <div className="ticks">
            <span className="tick"><b>SPY</b> 547.12 <span className="up">+0.42%</span></span>
            <span className="tick"><b>QQQ</b> 478.04 <span className="up">+0.81%</span></span>
            <span className="tick"><b>IWM</b> 218.66 <span className="dn">-0.12%</span></span>
            <span className="tick"><b>VIX</b> 14.22 <span className="dn">-3.10%</span></span>
            <span className="tick"><b>DXY</b> 102.41 <span className="up">+0.06%</span></span>
            <span className="tick"><b>BTC</b> 71,420 <span className="up">+1.84%</span></span>
            <span className="tick"><b>WTI</b> 79.10 <span className="dn">-0.55%</span></span>
            <span className="tick"><b>10Y</b> 4.18% <span className="up">+2bp</span></span>
          </div>
          <span className="clock">{display.dateStr}</span>
        </div>
      </div>

      {/* =============== PAGE HEADER =============== */}
      <section className="page">
        <div className="crumb">DASHBOARD <span>/</span> COMMAND CENTER <span>/</span> SESSION 05.01.2026</div>
        <div className="page-head">
          <div>
            <h1>Happy {display.weekdayLong},<br /><span className="ed">Boardroom Member.</span></h1>
            <p className="sub">Ranked by conviction. Movers we&apos;re watching at the open — what&apos;s real, what&apos;s noise.</p>
            {snapshotTimeStr && (
              <div className="snapshot-time">snapshot generated {snapshotTimeStr}</div>
            )}
          </div>
          <div className="head-meta">
            <div>AVG MOVE<b className="amb">{hasData ? formatPct(avgMove) : "—"}</b></div>
            <div>TOP RUNNER<b className="amb">{hero?.ticker ?? "—"}</b></div>
            <div>TOTAL VOL<b>{hasData ? formatVolume(totalVol) : "—"}</b></div>
            <div>SESSION<b>OPEN +12m</b></div>
          </div>
        </div>
      </section>

      {/* =============== MAIN GRID =============== */}
      <section className="grid">

        {/* ============== LEFT COLUMN ============== */}
        <div className="col-left">
          <div className="col-head">
            <div className="mono">★ TODAY&apos;S BOARD · 5 NAMES</div>
          </div>

          {/* HERO PICK + RANKED ROWS — render from snapshot if data exists, else empty notice */}
          {hasData && hero ? (
            <>
              <article className="hero">
                <div className="hero-top">
                  <div className="pick-num">01</div>
                  <div className="ticker-block">
                    <div className="sym">{hero.ticker}</div>
                    <div className="name">{hero.name}</div>
                    <div className="tags">
                      <span className="tag star">★ TOP PICK</span>
                      {hero.float && <span className="tag">FLOAT {hero.float}</span>}
                      {hero.confidence && <span className="tag">{hero.confidence.toUpperCase()} CONFIDENCE</span>}
                    </div>
                  </div>
                  <div className="hero-price">
                    <div className="mono">AT THE OPEN</div>
                    <div className="pct"><b>{formatPct(hero.change_pct)}</b></div>
                    <div className="px">
                      ${hero.last.toFixed(2)}
                      {hero.change_pct !== 0 && (
                        <small> · ${(hero.last / (1 + hero.change_pct / 100)).toFixed(2)} PREV</small>
                      )}
                    </div>
                  </div>
                </div>

                {/* spark bar */}
                <div className="spark-bar">
                  <div>
                    <div className="lbl">AT THE OPEN</div>
                    <div className="v amb">${hero.last.toFixed(2)}</div>
                  </div>
                  <div>
                    <svg viewBox="0 0 300 60" preserveAspectRatio="none">
                      <defs>
                        <linearGradient id="cc2-spark-grad" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0" stopColor="#F5A524" stopOpacity="0.5"></stop>
                          <stop offset="1" stopColor="#F5A524" stopOpacity="0"></stop>
                        </linearGradient>
                      </defs>
                      <path d="M0,52 L18,48 L34,50 L52,42 L70,38 L88,40 L106,30 L124,32 L142,22 L160,18 L178,22 L196,12 L214,16 L232,8 L250,10 L268,4 L286,8 L300,6 L300,60 L0,60 Z" fill="url(#cc2-spark-grad)"></path>
                      <path d="M0,52 L18,48 L34,50 L52,42 L70,38 L88,40 L106,30 L124,32 L142,22 L160,18 L178,22 L196,12 L214,16 L232,8 L250,10 L268,4 L286,8 L300,6" stroke="#F5A524" strokeWidth="1.6" fill="none"></path>
                    </svg>
                  </div>
                  <div className="spark-meta">
                    <span>VOL <b>{formatVolume(hero.volume)}</b></span>
                    {hero.float && <span>FLOAT <b>{hero.float}</b></span>}
                    {hero.market_cap && <span>MCAP <b>{hero.market_cap}</b></span>}
                  </div>
                </div>

                <div className="hero-body">
                  <div className="catalyst">
                    <div className="mono" style={{ fontSize: "10px", color: "var(--gold)", marginBottom: "10px" }}>→ THE CATALYST</div>
                    {hero.catalyst_headline && <h3>{hero.catalyst_headline}</h3>}
                    {hero.catalyst.length > 0 && (
                      <ul>
                        {hero.catalyst.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    )}
                    {hero.risk_flags.length > 0 && (
                      <div className="risks">{formatRiskFlags(hero.risk_flags)}</div>
                    )}
                  </div>

                  <div className="targets">
                    <h4>AI PRICE TARGETS · 30 DAY</h4>
                    {hero.price_targets.upside && (
                      <>
                        <div className="lvl"><span className="k">UPSIDE</span><span className="v">${hero.price_targets.upside.price.toFixed(2)} <small>{formatPct(hero.price_targets.upside.pct)}</small></span></div>
                        {hero.price_targets.upside.rationale && (
                          <div className="lvl-why">{hero.price_targets.upside.rationale}</div>
                        )}
                      </>
                    )}
                    {hero.price_targets.stretch && (
                      <>
                        <div className="lvl"><span className="k">STRETCH</span><span className="v">${hero.price_targets.stretch.price.toFixed(2)} <small>{formatPct(hero.price_targets.stretch.pct)}</small></span></div>
                        {hero.price_targets.stretch.rationale && (
                          <div className="lvl-why">{hero.price_targets.stretch.rationale}</div>
                        )}
                      </>
                    )}
                    {hero.price_targets.downside && (
                      <>
                        <div className="lvl"><span className="k dn">DOWNSIDE</span><span className="v">${hero.price_targets.downside.price.toFixed(2)} <small>{formatPct(hero.price_targets.downside.pct)}</small></span></div>
                        {hero.price_targets.downside.rationale && (
                          <div className="lvl-why">{hero.price_targets.downside.rationale}</div>
                        )}
                      </>
                    )}
                    <div className="mono" style={{ fontSize: "9px", color: "var(--ink-55)", marginTop: "12px", lineHeight: "1.5" }}>AI‑GENERATED · NOT ANALYST TARGETS · NOT FINANCIAL ADVICE</div>
                  </div>
                </div>

                <div className="hero-foot">
                  <div>
                    <strong style={{ color: "var(--ink)" }}>${hero.last.toFixed(2)}</strong>
                    {" · "}<span style={{ color: "var(--gold)" }}>{formatPct(hero.change_pct)}</span>
                    {" · VOL "}{formatVolume(hero.volume)}
                    {hero.market_cap && <> · MCAP {hero.market_cap}</>}
                  </div>
                  <div className="actions">
                    <button className="btn">+ WATCH</button>
                    <button className="btn">SET ALERT</button>
                    <button className="btn amber">OPEN CHART →</button>
                  </div>
                </div>
              </article>

              {/* RANKED ROWS — 02 onward, drawn from stocks[1..4] */}
              <div style={{ marginTop: "22px" }}></div>

              {rankedRows.map((row, i) => {
                const rank = i + 2;
                const upside = row.price_targets?.upside;
                const downside = row.price_targets?.downside;
                const showTargets = !!(upside || downside);
                return (
                  <article key={row.ticker || i} className="row">
                    <div className="num">{rank.toString().padStart(2, "0")}</div>
                    <div>
                      <div className="sym">{row.ticker}</div>
                      <div className="name">{row.name}</div>
                    </div>
                    <div>
                      <div className="pct">{formatPct(row.change_pct)}</div>
                      <div className="px">${row.last.toFixed(2)} · VOL {formatVolume(row.volume)}</div>
                      {showTargets && (
                        <div className="tgt">
                          {upside && <>UP ${upside.price.toFixed(2)} {formatPct(upside.pct)}</>}
                          {upside && downside && " · "}
                          {downside && <>DN ${downside.price.toFixed(2)} {formatPct(downside.pct)}</>}
                        </div>
                      )}
                    </div>
                    <div className="blurb">
                      {row.catalyst_headline ?? ""}
                      {row.risk_flags.length > 0 && (
                        <span className="micro">▲ {row.risk_flags.map((f) => f.toUpperCase()).join(" · ")}</span>
                      )}
                    </div>
                    <div className="right">
                      <svg className="spark" viewBox="0 0 88 36" preserveAspectRatio="none">
                        <path d="M0,30 L10,28 L20,24 L30,22 L40,16 L50,12 L60,8 L70,6 L80,5 L88,4" stroke="#B8860B" strokeWidth="1.6" fill="none"></path>
                      </svg>
                      {row.market_cap && <span className="vol">MCAP {row.market_cap}</span>}
                      <span className="go">DETAIL →</span>
                    </div>
                  </article>
                );
              })}
            </>
          ) : (
            <div className="empty-notice">
              <div className="lbl">→ NO SNAPSHOT</div>
              <div className="msg">No snapshot published yet.</div>
            </div>
          )}

          {/* editor's note bar */}
          <div style={{ background: "var(--ink)", color: "var(--paper)", padding: "22px 26px", marginTop: "22px", borderLeft: "4px solid var(--amber)" }}>
            <div className="mono" style={{ color: "var(--amber)", fontSize: "10px", marginBottom: "8px" }}>→ GAME PLAN · OPEN +12m</div>
            <div style={{ fontFamily: "Georgia,serif", fontStyle: "italic", fontSize: "18px", lineHeight: "1.5", maxWidth: "680px" }}>
              Demand confirmation before sizing. First‑minute pops fade fast. Let VWAP hold and watch the tape before pressing.
            </div>
            <div className="mono" style={{ color: "var(--paper-55)", fontSize: "10px", marginTop: "14px" }}>— Rob, Pedro &amp; Buddy · The Editorial Desk</div>
          </div>
        </div>

        {/* ============== RIGHT RAIL ============== */}
        <aside className="rail">

          {/* MORNING WEBINAR — placeholder until the player is live */}
          <div className="panel dark">
            <div className="panel-head">
              <span>● MORNING WEBINAR</span>
              <span className="right">COMING SOON</span>
            </div>
            <div className="video">
              <div className="video-figure">
                <div className="speaker"></div>
              </div>
            </div>
          </div>

          {/* LIVE CHAT */}
          <div className="panel">
            <div className="panel-head">
              <span>● TRADING ROOM CHAT</span>
              <span className="right">412 ONLINE</span>
            </div>
            <div className="chat-body">
              <div className="msg"><span className="who mod">MOD · PEDRO</span>If you&apos;re new — pinned post has the CUE PIPE math walk‑through.</div>
              <div className="msg"><span className="who">@swing_dan</span>watching CUE for VWAP reclaim, $26.40 is the line</div>
              <div className="msg"><span className="who">@kayla.t</span>SOBR 0.82 → 0.91 in 30s. that float is a pinhead.</div>
              <div className="msg"><span className="who">@jmercer</span>ESPR deal spread 0.3% — anyone working a merger arb sleeve?</div>
              <div className="msg"><span className="who you">YOU</span>does the PIPE close before the next 8‑K?</div>
            </div>
            <div className="chat-input">
              <span>›</span>
              <input defaultValue="Type a message…" />
              <button>SEND</button>
            </div>
          </div>

          {/* ALERTS FEED */}
          <div className="panel dark">
            <div className="panel-head"><span>● ALERTS · YOUR WATCHLIST</span><span className="right">AUTO‑SCROLL</span></div>
            <div className="alerts">
              <div className="alert">
                <span className="t">9:41</span>
                <span className="body"><b>CUE</b> — VWAP reclaim on 220k print. <em>Tape read confirms.</em></span>
                <span className="pct">+114.9%</span>
              </div>
              <div className="alert">
                <span className="t">9:38</span>
                <span className="body"><b>ESPR</b> — definitive merger 8‑K hits the wire.</span>
                <span className="pct">+57.3%</span>
              </div>
              <div className="alert">
                <span className="t">9:35</span>
                <span className="body"><b>SOBR</b> — circuit breaker LULD halt, 5‑min pause.</span>
                <span className="pct">+55.0%</span>
              </div>
              <div className="alert">
                <span className="t">9:33</span>
                <span className="body"><b>LABT</b> — full float churned in opening 3 minutes.</span>
                <span className="pct">+48.1%</span>
              </div>
              <div className="alert">
                <span className="t">9:31</span>
                <span className="body"><b>AKAN</b> — opens above prior halt zone $58. <em>Watch $48 break.</em></span>
                <span className="pct">+27.4%</span>
              </div>
            </div>
            {/* mini pulse */}
            <div className="pulse">
              <div><div className="lbl">AVG MOVE</div><div className="v amb">+60.5%</div><div className="sub">across the board</div></div>
              <div><div className="lbl">TOP RUNNER</div><div className="v amb">CUE</div><div className="sub">+114.9% · 5.2M vol</div></div>
              <div><div className="lbl">TOTAL VOL</div><div className="v">111.4M</div><div className="sub">across these names</div></div>
              <div><div className="lbl">HALTS TODAY</div><div className="v">2</div><div className="sub">SOBR · AKAN</div></div>
            </div>
          </div>

        </aside>
      </section>

      {/* =============== FOOT =============== */}
      <div className="foot">
        <span>⚠ NOT FINANCIAL ADVICE · ALL TRADING INVOLVES RISK · DATA DELAYED 0–15s · SESSION 05.01.2026</span>
        <span>LONGBOARD<em style={{ fontStyle: "italic", color: "var(--gold)", fontFamily: "Georgia,serif", fontWeight: 500 }}> AI</em> · COMMAND CENTER v3.2</span>
      </div>
    </div>
  );
}
