"use client";

import { useEffect, useState } from "react";
import Command2Nav from "@/components/command2/Command2Nav";
import type { Command2MenuUser } from "@/components/command2/Command2UserMenu";
import { computeLiveTime, FALLBACK_LIVE_TIME, type LiveTime } from "@/components/command2/liveTime";

export type Command2LiveTime = LiveTime;

export function computeCommand2LiveTime(): Command2LiveTime {
  return computeLiveTime();
}

export default function Command2Header({
  currentUser,
  live,
  activeTab,
}: {
  currentUser: Command2MenuUser | null;
  live?: Command2LiveTime;
  activeTab?: "command" | "charts" | "learn" | "library" | "settings";
}) {
  const [internalLive, setInternalLive] = useState<Command2LiveTime>(FALLBACK_LIVE_TIME);

  useEffect(() => {
    if (live) return;
    const tick = () => setInternalLive(computeLiveTime());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [live]);

  const display = live ?? internalLive;

  return (
    <div className="command2-header">
      <style>{`
        .command2-header{
          --ink:#15120B;
          --paper:rgba(244,241,232,0.85);
          --paper-18:rgba(244,241,232,0.18);
          --paper-55:rgba(244,241,232,0.55);
          --amber:#F5A524;
          --hpad:28px;
          background:var(--ink);
          color:var(--paper);
          font-family:Helvetica,Arial,sans-serif;
          -webkit-font-smoothing:antialiased;
        }
        .command2-header *{box-sizing:border-box}
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
          min-width:0;
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
        .command2-header .clock{margin-left:auto;color:var(--paper-55);padding-left:18px;border-left:1px solid var(--paper-18)}
        @media (max-width:900px){
          .command2-header{--hpad:16px}
          .command2-header .strip{overflow:hidden}
          .command2-header .ticks{min-width:0;overflow:hidden}
          .command2-header .tick:nth-child(n + 5){display:none}
          .command2-header .clock{display:none}
        }
      `}</style>

      <Command2Nav activeTab={activeTab} currentUser={currentUser} live={display} />

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
