"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import Command2UserMenu, { type Command2MenuUser } from "@/components/command2/Command2UserMenu";

export type Command2LiveTime = {
  clock: string;
  session: string;
  dateStr: string;
  weekdayLong: string;
};

const FALLBACK: Command2LiveTime = {
  clock: "9:42 ET",
  session: "MARKET OPEN",
  dateStr: "FRI · MAY 1 · 2026",
  weekdayLong: "Friday",
};

const TICKER_RE = /^[A-Z0-9.]{1,10}$/;

export function computeCommand2LiveTime(): Command2LiveTime {
  const now = new Date();

  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hourRaw = timeParts.find((p) => p.type === "hour")?.value ?? "0";
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

export default function Command2Header({
  currentUser,
  live,
}: {
  currentUser: Command2MenuUser | null;
  live?: Command2LiveTime;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const inputRef = useRef<HTMLInputElement>(null);
  const [internalLive, setInternalLive] = useState<Command2LiveTime>(FALLBACK);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (live) return;
    const tick = () => setInternalLive(computeCommand2LiveTime());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const display = live ?? internalLive;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticker = query.trim().replace(/^\$/, "").toUpperCase();
    if (!TICKER_RE.test(ticker)) {
      setError(true);
      inputRef.current?.focus();
      return;
    }

    setError(false);
    setQuery("");
    router.push(`/command2/briefing/${encodeURIComponent(ticker)}`);
  }

  return (
    <div className="command2-header">
      <style>{`
        .command2-header{
          --cream:#F6F2E9;
          --ink:#15120B;
          --paper:rgba(244,241,232,0.85);
          --paper-55:rgba(244,241,232,0.55);
          --paper-18:rgba(244,241,232,0.18);
          --amber:#F5A524;
          --gold:#B8860B;
          --hpad:28px;
          background:var(--ink);
          color:var(--paper);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .command2-header *{box-sizing:border-box}
        .command2-header a{color:inherit;text-decoration:none}
        .command2-header .nav{background:var(--ink);color:var(--paper);border-bottom:1px solid #000}
        .command2-header .nav-inner{
          max-width:1480px;margin:0 auto;
          display:flex;align-items:center;gap:32px;
          padding:14px var(--hpad);
        }
        .command2-header .brand{
          display:flex;align-items:center;gap:10px;
          font-weight:800;letter-spacing:-0.4px;font-size:18px;white-space:nowrap;
        }
        .command2-header .brand .mark{
          width:26px;height:26px;background:var(--amber);color:var(--ink);
          display:grid;place-items:center;font-weight:900;font-size:14px;
        }
        .command2-header .brand em{font-family:Georgia,serif;color:var(--amber);font-weight:500}
        .command2-header ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;font-size:13px;font-weight:600;color:rgba(244,241,232,0.78)}
        .command2-header li.active{color:var(--amber)}
        .command2-header li.active::before{content:"● ";font-size:9px;vertical-align:middle;margin-right:4px}
        .command2-header .nav-right{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:12px;color:rgba(244,241,232,0.7)}
        .command2-header .live-pip{
          display:inline-flex;align-items:center;gap:6px;
          color:var(--amber);font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;font-weight:700;
          white-space:nowrap;
        }
        .command2-header .live-pip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 0 rgba(245,165,36,0.6);animation:command2-pulse 1.6s infinite}
        @keyframes command2-pulse{
          0%{box-shadow:0 0 0 0 rgba(245,165,36,0.55)}
          70%{box-shadow:0 0 0 8px rgba(245,165,36,0)}
          100%{box-shadow:0 0 0 0 rgba(245,165,36,0)}
        }
        .command2-header .search{
          display:flex;align-items:center;gap:8px;
          background:var(--cream);
          border:1px solid rgba(245,165,36,0.58);
          padding:0 10px;min-width:270px;height:34px;
          color:rgba(21,18,11,0.78);
        }
        .command2-header .search:focus-within{border-color:var(--amber);box-shadow:0 0 0 3px rgba(245,165,36,0.22)}
        .command2-header .search.invalid{border-color:#E66B5C}
        .command2-header .search-icon{font-size:13px;color:var(--amber)}
        .command2-header .search input{
          min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--ink);
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;
        }
        .command2-header .search input::placeholder{color:rgba(21,18,11,0.42)}
        .command2-header .kbd{border:1px solid rgba(21,18,11,0.22);padding:1px 6px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.2px;color:rgba(21,18,11,0.54)}
        .command2-header .avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#F5A524,#B8860B);display:grid;place-items:center;color:var(--ink);font-weight:800;font-size:12px}
        .command2-header .account-menu{position:relative;display:flex;align-items:center}
        .command2-header .account-trigger{
          border:1px solid rgba(244,241,232,0.18);
          cursor:pointer;
          font-family:Helvetica,Arial,sans-serif;
          padding:0;
          transition:transform 140ms ease,border-color 140ms ease,box-shadow 140ms ease;
        }
        .command2-header .account-trigger:hover,
        .command2-header .account-trigger[aria-expanded="true"]{
          border-color:var(--amber);
          box-shadow:0 0 0 3px rgba(245,165,36,0.16);
          transform:translateY(-1px);
        }
        .command2-header .account-panel{
          position:absolute;
          right:0;
          top:calc(100% + 12px);
          z-index:1000;
          width:min(320px,calc(100vw - 32px));
          background:#F8F8F6;
          color:var(--ink);
          border:1px solid rgba(21,18,11,0.18);
          box-shadow:0 18px 44px rgba(0,0,0,0.28);
          overflow:hidden;
        }
        .command2-header .account-item{
          display:block;
          width:100%;
          min-height:72px;
          padding:24px 28px;
          border:0;
          border-top:1px solid rgba(21,18,11,0.16);
          background:transparent;
          color:var(--ink);
          cursor:pointer;
          font-family:'Courier New',Courier,monospace;
          font-size:22px;
          line-height:1.1;
          letter-spacing:2px;
          text-align:left;
        }
        .command2-header .account-item:first-child{border-top:0}
        .command2-header .account-item:hover,
        .command2-header .account-item:focus-visible{background:rgba(21,18,11,0.045);outline:none}
        .command2-header .account-item-accent{color:#00824C}
        .command2-header .account-item-danger{color:#C8283D}
        .command2-header .strip{
          background:var(--ink);color:var(--paper);
          border-top:1px solid rgba(244,241,232,0.08);
          overflow:hidden;
          font-family:'Courier New',monospace;font-size:12px;letter-spacing:1.4px;
        }
        .command2-header .strip-inner{
          display:flex;align-items:center;gap:0;
          padding:10px var(--hpad);
          max-width:1480px;margin:0 auto;
          white-space:nowrap;
        }
        .command2-header .strip-tag{
          color:var(--amber);font-weight:700;margin-right:18px;
          border-right:1px solid rgba(244,241,232,0.18);padding-right:18px;
        }
        .command2-header .ticks{display:flex;gap:24px;overflow:hidden;flex:1}
        .command2-header .tick{display:inline-flex;align-items:baseline;gap:8px}
        .command2-header .tick b{color:var(--paper);font-family:Helvetica,Arial,sans-serif;font-weight:800;letter-spacing:-0.3px}
        .command2-header .tick .up{color:var(--amber)}
        .command2-header .tick .dn{color:#E66B5C}
        .command2-header .clock{margin-left:auto;color:rgba(244,241,232,0.55);padding-left:18px;border-left:1px solid rgba(244,241,232,0.18)}
        @media (max-width:900px){
          .command2-header{--hpad:16px}
          .command2-header .nav-inner{gap:14px}
          .command2-header ul,.command2-header .plan-tag{display:none}
          .command2-header .nav-right{gap:12px;flex:1}
          .command2-header .search{min-width:0;flex:1}
          .command2-header .live-pip{display:none}
          .command2-header .strip{overflow-x:auto}
          .command2-header .ticks{overflow:visible}
          .command2-header .clock{display:none}
        }
        @media (max-width:560px){
          .command2-header .nav-inner{align-items:flex-start;flex-wrap:wrap}
          .command2-header .nav-right{width:100%;margin-left:0}
          .command2-header .search{order:1;flex-basis:calc(100% - 48px)}
          .command2-header .account-menu{order:2}
          .command2-header .kbd{display:none}
        }
      `}</style>

      <nav className="nav">
        <div className="nav-inner">
          <Link href="/command2" className="brand" aria-label="Longboard AI Command Center">
            <span className="mark">L</span>
            LONGBOARD<em>AI</em>
          </Link>
          <ul>
            <li className={pathname === "/command2" ? "active" : ""}>
              <Link href="/command2">Command Center</Link>
            </li>
            <li>
              <Link href="/learn">Learn</Link>
            </li>
          </ul>
          <div className="nav-right">
            <span className="live-pip">{display.session} · {display.clock}</span>
            <form className={`search${error ? " invalid" : ""}`} onSubmit={handleSubmit}>
              <span className="search-icon" aria-hidden="true">⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (error) setError(false);
                }}
                placeholder="SEARCH TICKER..."
                aria-label="Search ticker briefing"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
              />
              <span className="kbd">⌘K</span>
            </form>
            <span className="plan-tag">Plan: Pro</span>
            <Command2UserMenu user={currentUser} />
          </div>
        </div>
      </nav>

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
    </div>
  );
}
