"use client";

import Link from "next/link";
import Command2UserMenu, { type Command2MenuUser } from "@/components/command2/Command2UserMenu";

// The dark top nav from /command2, lifted into a shared component so essay
// detail pages can render the same chrome. Self-contained: scoped under
// .cc2-nav-host (not .cc2-root) so it can drop into pages that don't ship
// the full cc2 page shell — there's no min-height/background overlap with
// the surrounding page.
//
// Live time isn't computed here; callers pass in `live` so the surface that
// already polls computeLiveTime() (CommandCenterV2) doesn't need a second
// timer, and surfaces that don't (essay pages) can wrap this in a thin
// client component that owns the polling.

export type Command2NavLive = {
  session: string;
  clock: string;
  dateStr: string;
};

type Props = {
  currentUser: Command2MenuUser | null;
  activeTab: "command" | "learn";
  live: Command2NavLive;
};

export default function Command2Nav({ currentUser, activeTab, live }: Props) {
  return (
    <div className="cc2-nav-host">
      <style>{`
        .cc2-nav-host{
          --ink:#15120B;
          --paper:rgba(244,241,232,0.85);
          --paper-55:rgba(244,241,232,0.55);
          --paper-18:rgba(244,241,232,0.18);
          --amber:#F5A524;
          --gold:#B8860B;
          --cc2-hpad:28px;
          color:var(--paper);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .cc2-nav-host *{box-sizing:border-box}
        .cc2-nav-host a{color:inherit;text-decoration:none}

        /* ===== TOP NAV ===== */
        .cc2-nav-host .nav{
          background:var(--ink);color:var(--paper);
          border-bottom:1px solid #000;
        }
        .cc2-nav-host .nav-inner{
          max-width:1480px;margin:0 auto;
          display:flex;align-items:center;gap:32px;
          padding:14px var(--cc2-hpad);
        }
        .cc2-nav-host .brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-0.4px;font-size:18px;color:var(--paper)}
        .cc2-nav-host .brand .mark{
          width:26px;height:26px;background:var(--amber);color:var(--ink);
          display:grid;place-items:center;font-weight:900;font-size:14px;
        }
        .cc2-nav-host .brand em{font-family:Georgia,serif;color:var(--amber);font-weight:500}
        .cc2-nav-host .nav ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;font-size:13px;font-weight:600;color:rgba(244,241,232,0.78)}
        .cc2-nav-host .nav ul li.active{color:var(--amber)}
        .cc2-nav-host .nav ul li.active::before{content:"● ";font-size:9px;vertical-align:middle;margin-right:4px}
        .cc2-nav-host .nav-right{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:12px;color:rgba(244,241,232,0.7)}
        .cc2-nav-host .search{
          display:flex;align-items:center;gap:8px;
          background:rgba(244,241,232,0.06);
          border:1px solid rgba(244,241,232,0.14);
          padding:7px 12px;min-width:240px;
          font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.4px;
          color:rgba(244,241,232,0.6);
        }
        .cc2-nav-host .search .kbd{margin-left:auto;border:1px solid rgba(244,241,232,0.2);padding:1px 6px;font-size:10px}
        .cc2-nav-host .live-pip{
          display:inline-flex;align-items:center;gap:6px;
          color:var(--amber);font-family:'Courier New',monospace;font-size:11px;letter-spacing:1.6px;font-weight:700;
        }
        .cc2-nav-host .live-pip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 0 rgba(245,165,36,0.6);animation:cc2-pulse 1.6s infinite}
        @keyframes cc2-pulse{
          0%{box-shadow:0 0 0 0 rgba(245,165,36,0.55)}
          70%{box-shadow:0 0 0 8px rgba(245,165,36,0)}
          100%{box-shadow:0 0 0 0 rgba(245,165,36,0)}
        }
        .cc2-nav-host .avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#F5A524,#B8860B);display:grid;place-items:center;color:var(--ink);font-weight:800;font-size:12px}
        .cc2-nav-host .account-menu{position:relative;display:flex;align-items:center}
        .cc2-nav-host .account-trigger{
          border:1px solid rgba(244,241,232,0.18);
          cursor:pointer;
          font-family:Helvetica,Arial,sans-serif;
          padding:0;
          transition:transform 140ms ease,border-color 140ms ease,box-shadow 140ms ease;
        }
        .cc2-nav-host .account-trigger:hover,
        .cc2-nav-host .account-trigger[aria-expanded="true"]{
          border-color:var(--amber);
          box-shadow:0 0 0 3px rgba(245,165,36,0.16);
          transform:translateY(-1px);
        }
        .cc2-nav-host .account-panel{
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
        .cc2-nav-host .account-item{
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
          text-transform:none;
        }
        .cc2-nav-host .account-item:first-child{border-top:0}
        .cc2-nav-host .account-item:hover,
        .cc2-nav-host .account-item:focus-visible{
          background:rgba(21,18,11,0.045);
          outline:none;
        }
        .cc2-nav-host .account-item-accent{color:#00824C}
        .cc2-nav-host .account-item-danger{color:#C8283D}

        /* ===== MOBILE (≤768) ===== */
        @media (max-width:768px){
          .cc2-nav-host{ --cc2-hpad:16px }
          .cc2-nav-host .nav-inner{ gap:14px }
          .cc2-nav-host .nav ul{ display:none }
          .cc2-nav-host .nav .search{ display:none }
          .cc2-nav-host .nav-right{ gap:12px }
          .cc2-nav-host .nav-right .plan-tag{ display:none }
          .cc2-nav-host .account-panel{right:-2px;top:calc(100% + 10px)}
          .cc2-nav-host .account-item{min-height:64px;padding:20px 22px;font-size:19px}
        }
      `}</style>

      <nav className="nav">
        <div className="nav-inner">
          <div className="brand">
            <span className="mark">L</span>
            LONGBOARD<em>AI</em>
          </div>
          <ul>
            <li className={activeTab === "command" ? "active" : undefined}>
              {activeTab === "command" ? (
                "Command Center"
              ) : (
                <Link href="/command2">Command Center</Link>
              )}
            </li>
            <li className={activeTab === "learn" ? "active" : undefined}>
              {activeTab === "learn" ? "Learn" : <Link href="/learn">Learn</Link>}
            </li>
          </ul>
          <div className="nav-right">
            <span className="live-pip">{live.session} · {live.clock}</span>
            <div className="search">
              <span>🔍</span>
              <span>SEARCH TICKERS, FILINGS…</span>
              <span className="kbd">⌘K</span>
            </div>
            <span className="plan-tag">Plan: Pro</span>
            <Command2UserMenu user={currentUser} />
          </div>
        </div>
      </nav>
    </div>
  );
}
