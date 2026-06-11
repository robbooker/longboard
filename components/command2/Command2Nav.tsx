"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import Command2UserMenu, { type Command2MenuUser } from "@/components/command2/Command2UserMenu";
import type { LiveTime } from "@/components/command2/liveTime";

const TICKER_RE = /^[A-Z0-9.]{1,10}$/;

type Command2NavTab = "command" | "charts" | "learn" | "settings";

type Props = {
  currentUser: Command2MenuUser | null;
  activeTab?: Command2NavTab;
  live: LiveTime;
};

export default function Command2Nav({ currentUser, activeTab, live }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);

  const resolvedActiveTab: Command2NavTab =
    activeTab
    ?? (pathname.startsWith("/learn")
      ? "learn"
      : pathname.startsWith("/lab/chart")
        ? "charts"
      : pathname.startsWith("/settings")
        ? "settings"
        : "command");
  const scannerActive = pathname === "/scanner" || pathname.startsWith("/scanner/") || pathname.startsWith("/command2/scanner");
  const seasonalityActive = pathname === "/seasonality" || pathname.startsWith("/seasonality/");
  const chartsActive = resolvedActiveTab === "charts" && !seasonalityActive;

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
    <div className="command2-nav">
      <style>{`
        .command2-nav{
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
        .command2-nav *{box-sizing:border-box}
        .command2-nav a{color:inherit;text-decoration:none}
        .command2-nav .nav{background:var(--ink);color:var(--paper);border-bottom:1px solid #000}
        .command2-nav .nav-inner{
          max-width:1480px;margin:0 auto;
          display:flex;align-items:center;gap:24px;
          padding:14px var(--hpad);
        }
        .command2-nav .brand{
          display:flex;align-items:center;gap:10px;
          font-weight:800;letter-spacing:-0.4px;font-size:18px;white-space:nowrap;
        }
        .command2-nav .brand .mark{
          width:26px;height:26px;background:var(--amber);color:var(--ink);
          display:grid;place-items:center;font-weight:900;font-size:14px;
        }
        .command2-nav .brand em{font-family:Georgia,serif;color:var(--amber);font-weight:500}
        .command2-nav ul{list-style:none;margin:0;padding:0;display:flex;gap:18px;font-size:13px;font-weight:600;color:rgba(244,241,232,0.78);white-space:nowrap}
        .command2-nav li.active{color:var(--amber)}
        .command2-nav li.active::before{content:"● ";font-size:9px;vertical-align:middle;margin-right:4px}
        .command2-nav .nav-right{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:12px;color:rgba(244,241,232,0.7)}
        .command2-nav .live-pip{
          display:inline-flex;align-items:center;gap:6px;
          color:var(--amber);font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;font-weight:700;
          white-space:nowrap;
        }
        .command2-nav .live-pip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 0 rgba(245,165,36,0.6);animation:command2-pulse 1.6s infinite}
        @keyframes command2-pulse{
          0%{box-shadow:0 0 0 0 rgba(245,165,36,0.55)}
          70%{box-shadow:0 0 0 8px rgba(245,165,36,0)}
          100%{box-shadow:0 0 0 0 rgba(245,165,36,0)}
        }
        .command2-nav .search{
          display:flex;align-items:center;gap:8px;
          background:var(--cream);
          border:1px solid rgba(245,165,36,0.58);
          padding:0 10px;min-width:240px;height:34px;
          color:rgba(21,18,11,0.78);
        }
        .command2-nav .search:focus-within{border-color:var(--amber);box-shadow:0 0 0 3px rgba(245,165,36,0.22)}
        .command2-nav .search.invalid{border-color:#E66B5C}
        .command2-nav .search-icon{font-size:13px;color:var(--amber)}
        .command2-nav .search input{
          min-width:0;flex:1;border:0;outline:0;background:transparent;color:var(--ink);
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;
        }
        .command2-nav .search input::placeholder{color:rgba(21,18,11,0.42)}
        .command2-nav .kbd{border:1px solid rgba(21,18,11,0.22);padding:1px 6px;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1.2px;color:rgba(21,18,11,0.54)}
        .command2-nav .avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#F5A524,#B8860B);display:grid;place-items:center;color:var(--ink);font-weight:800;font-size:12px}
        .command2-nav .account-menu{position:relative;display:flex;align-items:center}
        .command2-nav .account-trigger{
          border:1px solid rgba(244,241,232,0.18);
          cursor:pointer;
          font-family:Helvetica,Arial,sans-serif;
          padding:0;
          transition:transform 140ms ease,border-color 140ms ease,box-shadow 140ms ease;
        }
        .command2-nav .account-trigger:hover,
        .command2-nav .account-trigger[aria-expanded="true"]{
          border-color:var(--amber);
          box-shadow:0 0 0 3px rgba(245,165,36,0.16);
          transform:translateY(-1px);
        }
        .command2-nav .account-panel{
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
        .command2-nav .account-item{
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
        .command2-nav .account-item:first-child{border-top:0}
        .command2-nav .account-item:hover,
        .command2-nav .account-item:focus-visible{background:rgba(21,18,11,0.045);outline:none}
        .command2-nav .account-item-accent{color:#00824C}
        .command2-nav .account-item-danger{color:#C8283D}
        @media (max-width:900px){
          .command2-nav{--hpad:16px}
          .command2-nav .nav-inner{gap:14px}
          .command2-nav ul,.command2-nav .plan-tag{display:none}
          .command2-nav .nav-right{gap:12px;flex:1}
          .command2-nav .search{min-width:0;flex:1}
          .command2-nav .live-pip{display:none}
        }
        @media (max-width:560px){
          .command2-nav .nav-inner{align-items:flex-start;flex-wrap:wrap}
          .command2-nav .nav-right{width:100%;margin-left:0}
          .command2-nav .search{order:1;flex-basis:calc(100% - 48px)}
          .command2-nav .account-menu{order:2}
          .command2-nav .kbd{display:none}
        }
      `}</style>

      <nav className="nav">
        <div className="nav-inner">
          <Link href="/command2" className="brand" aria-label="Longboard AI Command Center">
            <span className="mark">L</span>
            LONGBOARD<em>AI</em>
          </Link>
          <ul>
            <li className={resolvedActiveTab === "command" && !scannerActive ? "active" : ""}>
              <Link href="/command2">Command Center</Link>
            </li>
            <li className={scannerActive ? "active" : ""}>
              <Link href="/scanner">Scanner</Link>
            </li>
            <li className={chartsActive ? "active" : ""}>
              <Link href="/lab/chart2">Charts</Link>
            </li>
            <li className={seasonalityActive ? "active" : ""}>
              <Link href="/seasonality">Seasonality</Link>
            </li>
            <li className={resolvedActiveTab === "learn" ? "active" : ""}>
              <Link href="/learn">Learn</Link>
            </li>
            <li className={resolvedActiveTab === "settings" ? "active" : ""}>
              <Link href="/settings">Settings</Link>
            </li>
          </ul>
          <div className="nav-right">
            <span className="live-pip">{live.session} · {live.clock}</span>
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
    </div>
  );
}
