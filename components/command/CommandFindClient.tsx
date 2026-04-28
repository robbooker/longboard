"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { GainersData, PolygonTickerSnapshot } from "@/types/polygon";

type NewsItem = {
  id: string;
  ticker: string;
  published_utc?: string;
  title: string;
  author?: string;
  source?: string;
  url?: string;
};

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(2) : n.toFixed(2);
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtCap(cap?: number | null): string {
  if (!cap || !Number.isFinite(cap)) return "—";
  if (cap >= 1e12) return `${(cap / 1e12).toFixed(2)}T`;
  if (cap >= 1e9) return `${(cap / 1e9).toFixed(2)}B`;
  if (cap >= 1e6) return `${(cap / 1e6).toFixed(0)}M`;
  return String(Math.round(cap));
}

function relTime(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

export default function CommandFindClient() {
  const [gainers, setGainers] = useState<PolygonTickerSnapshot[]>([]);
  const [gainersErr, setGainersErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsErr, setNewsErr] = useState<string | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/gainers", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as Partial<GainersData> & { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const rows = Array.isArray(data.tickers) ? data.tickers : [];
        if (cancelled) return;
        setGainers(rows);
        setGainersErr(null);
        if (!selected && rows[0]?.ticker) setSelected(rows[0].ticker);
      } catch (e) {
        if (cancelled) return;
        setGainersErr(e instanceof Error ? e.message : "Failed to load gainers");
      }
    }

    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tickersCsv = useMemo(
    () => gainers.map((g) => g.ticker).filter(Boolean).slice(0, 10).join(","),
    [gainers]
  );

  useEffect(() => {
    let cancelled = false;
    if (!tickersCsv) return;

    async function loadNews() {
      setNewsLoading(true);
      try {
        const url = `/api/command/news?tickers=${encodeURIComponent(tickersCsv)}&limit=20`;
        const res = await fetch(url, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { items?: NewsItem[]; error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (cancelled) return;
        setNews(Array.isArray(data.items) ? data.items : []);
        setNewsErr(null);
      } catch (e) {
        if (cancelled) return;
        setNewsErr(e instanceof Error ? e.message : "Failed to load news");
      } finally {
        if (!cancelled) setNewsLoading(false);
      }
    }

    loadNews();
    const t = setInterval(loadNews, 45_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [tickersCsv]);

  const filteredNews = useMemo(() => {
    if (!selected) return news;
    const hit = news.filter((n) => n.ticker === selected);
    return hit.length > 0 ? hit : news;
  }, [news, selected]);

  return (
    <div className="cc-3col" style={{ marginTop: 14 }}>
      {/* Left — Movers */}
      <section className="cc-card" aria-label="Top movers">
        <div className="cc-card-head">
          <div>
            <strong>01</strong> movers · <span style={{ color: "var(--cc-amber)" }}>today</span>
          </div>
          <div style={{ color: "var(--cc-faint)" }}>up on day</div>
        </div>

        <div style={{ padding: "0 0 6px" }}>
          {gainersErr ? (
            <div style={{ padding: 12, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
              {gainersErr}
            </div>
          ) : (
            <table className="cc-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th style={{ width: 84 }}>Ticker</th>
                  <th style={{ width: 90 }}>Last</th>
                  <th style={{ width: 90 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {gainers.slice(0, 12).map((g, i) => {
                  const isActive = selected === g.ticker;
                  return (
                    <tr
                      key={g.ticker}
                      onClick={() => setSelected(g.ticker)}
                      style={{
                        cursor: "pointer",
                        background: isActive ? "rgba(245,165,36,0.08)" : "transparent",
                      }}
                    >
                      <td style={{ color: "var(--cc-faint)" }}>{String(i + 1).padStart(2, "0")}</td>
                      <td className="ticker">{g.ticker}</td>
                      <td>{fmtMoney(g.day?.c ?? NaN)}</td>
                      <td style={{ color: "var(--cc-amber)" }}>{fmtPct(g.todaysChangePerc)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Middle — News */}
      <section className="cc-card" aria-label="News related to movers">
        <div className="cc-card-head">
          <div>
            <strong>02</strong> news · related to list
          </div>
          <div style={{ color: "var(--cc-faint)" }}>
            {selected ? `${selected}` : "—"}
            {newsLoading ? " · loading" : ""}
          </div>
        </div>

        <div className="cc-news">
          {newsErr ? (
            <div style={{ padding: 2, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
              {newsErr}
            </div>
          ) : filteredNews.length === 0 ? (
            <div style={{ padding: 2, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
              No news returned yet.
            </div>
          ) : (
            filteredNews.slice(0, 18).map((n) => (
              <div key={n.id} className="cc-news-item">
                <div className="cc-news-kicker">
                  {n.ticker}
                  {n.published_utc ? ` · ${relTime(n.published_utc)}` : ""}
                </div>
                <div className="cc-news-title">
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
                      {n.title}
                    </a>
                  ) : (
                    n.title
                  )}
                </div>
                <div className="cc-news-source">
                  {(n.source ?? "—").toUpperCase()}
                  {n.author ? ` · ${n.author}` : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Right — Bloomberg TV */}
      <aside className="cc-card" aria-label="Bloomberg TV live">
        <div className="cc-card-head">
          <div>
            <strong>03</strong> live · bloomberg tv
          </div>
          <div style={{ color: "var(--cc-faint)" }}>stream</div>
        </div>
        <div style={{ padding: 12 }}>
          <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", border: "1px solid rgba(246,242,233,0.10)" }}>
            <iframe
              title="Bloomberg TV Live"
              src="https://www.youtube.com/embed/dp8PhLsUcFE?modestbranding=1&rel=0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
          <div style={{ marginTop: 10, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase" }}>
            If this embed is blocked, open Bloomberg in a new tab.
          </div>
        </div>
      </aside>
    </div>
  );
}

