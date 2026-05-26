"use client";

import { useEffect, useState } from "react";
import { Command2EmbeddedStockChart } from "@/components/command2/Command2StockChart";

const FLAVOR_BEATS: { atSec: number; text: string }[] = [
  { atSec: 30, text: "Pulling SEC filings..." },
  { atSec: 50, text: "Reading X sentiment..." },
  { atSec: 70, text: "Synthesizing..." },
];

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function flavorFor(elapsedSec: number): string {
  let active = "";
  for (const beat of FLAVOR_BEATS) {
    if (elapsedSec >= beat.atSec) active = beat.text;
  }
  return active;
}

export default function WaitingState({
  ticker,
  startedAt,
}: {
  ticker: string;
  startedAt: number;
}) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const elapsedMs = now - startedAt;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const flavor = flavorFor(elapsedSec);

  return (
    <div className="waiting">
      <div className="eyebrow">BUDDY · ON THE TAPE</div>
      <h1>
        You&rsquo;re the first to ask about{" "}
        <span className="ticker">{ticker}</span> today.
      </h1>
      <p className="sub">
        Buddy is reading the tape. This may take up to 5 minutes. Thank you for your patience.
      </p>
      <div className="shimmer" aria-hidden="true" />
      <div className="flavor" aria-live="polite">
        {flavor}
      </div>
      <div className="timer">{formatElapsed(elapsedMs)}</div>
      <section className="waiting-chart" aria-label={`${ticker} price chart`}>
        <Command2EmbeddedStockChart ticker={ticker} rankLabel="DETAIL" />
      </section>
    </div>
  );
}
