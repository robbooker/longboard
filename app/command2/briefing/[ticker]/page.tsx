import type { Metadata } from "next";
import Command2Header from "@/components/command2/Command2Header";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import BriefingClient from "./BriefingClient";
import "./briefing.css";

export const dynamic = "force-dynamic";

const TICKER_RE = /^[A-Z0-9.]{1,10}$/;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ ticker: string }>;
}): Promise<Metadata> {
  const { ticker } = await params;
  const normalized = (ticker ?? "").trim().toUpperCase();
  return {
    title: TICKER_RE.test(normalized)
      ? `${normalized} · Buddy Briefing`
      : "Briefing · Longboard",
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: raw } = await params;
  const ticker = (raw ?? "").trim().toUpperCase();
  const valid = TICKER_RE.test(ticker);
  const currentUser = await getCommand2CurrentUser();

  return (
    <div className="briefing-root">
      <Command2Header currentUser={currentUser} />
      {valid ? (
        <BriefingClient ticker={ticker} />
      ) : (
        <div className="err-wrap">
          <div className="err-card">
            <div className="eyebrow">UNKNOWN TICKER</div>
            <h1>That doesn&rsquo;t look like a ticker.</h1>
            <p className="msg">
              Tickers are uppercase, alphanumeric (with an optional dot), and at
              most ten characters. Try a symbol like <span className="mono">AAPL</span>{" "}
              or <span className="mono">BRK.B</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
