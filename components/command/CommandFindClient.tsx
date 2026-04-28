"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return Intl.NumberFormat("en-US").format(Math.round(n));
}

function fmtDollarVol(price: number, vol: number): string {
  if (!Number.isFinite(price) || !Number.isFinite(vol)) return "—";
  const dv = price * vol;
  if (!Number.isFinite(dv)) return "—";
  if (dv >= 1e9) return `$${(dv / 1e9).toFixed(2)}B`;
  if (dv >= 1e6) return `$${(dv / 1e6).toFixed(1)}M`;
  if (dv >= 1e3) return `$${(dv / 1e3).toFixed(0)}K`;
  return `$${Math.round(dv)}`;
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [kind, setKind] = useState<"gainers" | "losers" | "active" | "unusual">("gainers");
  const [session, setSession] = useState<"auto" | "market" | "pre" | "post">("auto");
  const [modeLabel, setModeLabel] = useState<string | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [minPrice, setMinPrice] = useState<number>(1);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minPct, setMinPct] = useState<number>(5);
  const [minVol, setMinVol] = useState<number>(1000);
  const [maxRows, setMaxRows] = useState<number>(12);
  const minPriceRef = useRef<HTMLInputElement | null>(null);

  const [pinned, setPinned] = useState<string[]>([]);

  type ColumnKey =
    | "rank"
    | "ticker"
    | "last"
    | "pct"
    | "chg"
    | "vol"
    | "dvol"
    | "cap"
    | "prev"
    | "range"
    | "vwap";

  const DEFAULT_COLUMNS: ColumnKey[] = ["rank", "ticker", "last", "pct"];
  const [columns, setColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);

  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsErr, setNewsErr] = useState<string | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);

  // ── preferences: persist UX choices locally ──
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("lb.command.find.prefs");
      if (!raw) return;
      const p = JSON.parse(raw) as Partial<{
        kind: "gainers" | "losers" | "active" | "unusual";
        session: "auto" | "market" | "pre" | "post";
        minPrice: number;
        maxPrice: number | null;
        minPct: number;
        minVol: number;
        maxRows: number;
        pinned: string[];
        columns: ColumnKey[];
        selected: string | null;
      }>;
      if (p.kind) setKind(p.kind);
      if (p.session) setSession(p.session);
      if (typeof p.minPrice === "number") setMinPrice(p.minPrice);
      if (typeof p.maxPrice === "number" || p.maxPrice === null) setMaxPrice(p.maxPrice ?? null);
      if (typeof p.minPct === "number") setMinPct(p.minPct);
      if (typeof p.minVol === "number") setMinVol(p.minVol);
      if (typeof p.maxRows === "number") setMaxRows(p.maxRows);
      if (Array.isArray(p.pinned)) setPinned(p.pinned.filter(Boolean));
      if (Array.isArray(p.columns) && p.columns.length > 0) {
        const allowed = new Set<ColumnKey>([
          "rank",
          "ticker",
          "last",
          "pct",
          "chg",
          "vol",
          "dvol",
          "cap",
          "prev",
          "range",
          "vwap",
        ]);
        const next = p.columns.filter((c) => allowed.has(c));
        if (next.length > 0) setColumns(next);
      }
      if (typeof p.selected === "string" || p.selected === null) setSelected(p.selected);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const payload = {
      kind,
      session,
      minPrice,
      maxPrice,
      minPct,
      minVol,
      maxRows,
      pinned,
      columns,
      selected,
    };
    try {
      window.localStorage.setItem("lb.command.find.prefs", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [kind, session, minPrice, maxPrice, minPct, minVol, maxRows, pinned, columns, selected]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const url = `/api/command/movers?kind=${encodeURIComponent(kind)}&session=${encodeURIComponent(session)}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as Partial<GainersData> & { error?: string; mode?: string; tickers?: PolygonTickerSnapshot[] };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const rows = Array.isArray(data.tickers) ? data.tickers : [];
        if (cancelled) return;
        setGainers(rows);
        setGainersErr(null);
        setModeLabel(data.mode ?? null);
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
  }, [kind, session]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "Escape") {
        setDrawerOpen(false);
        setFiltersOpen(false);
        setColumnsOpen(false);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setFiltersOpen(true);
        setTimeout(() => minPriceRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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

  // (Middle column removed) Keep raw news for per-ticker teaser + drawer.

  const catalystByTicker = useMemo(() => {
    const map = new Map<string, NewsItem>();
    for (const n of news) {
      if (!n?.ticker) continue;
      if (!map.has(n.ticker)) map.set(n.ticker, n);
    }
    return map;
  }, [news]);

  const movers = useMemo(() => {
    const out = gainers
      .filter((g) => {
        const last = g.day?.c ?? NaN;
        const pct = g.todaysChangePerc ?? NaN;
        const vol = g.day?.v ?? 0;
        if (!Number.isFinite(last) || last < minPrice) return false;
        if (maxPrice != null && Number.isFinite(last) && last > maxPrice) return false;
        if (!Number.isFinite(pct) || Math.abs(pct) < minPct) return false;
        if (!Number.isFinite(vol) || vol < minVol) return false;
        return true;
      })
      .slice(0, Math.max(10, maxRows * 3));

    const pinnedSet = new Set(pinned);
    out.sort((a, b) => {
      const ap = pinnedSet.has(a.ticker) ? 1 : 0;
      const bp = pinnedSet.has(b.ticker) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.todaysChangePerc - a.todaysChangePerc;
    });

    return out.slice(0, maxRows);
  }, [gainers, maxPrice, maxRows, minPct, minPrice, minVol, pinned]);

  const moversIndex = useMemo(() => movers.map((m) => m.ticker), [movers]);

  const selectedRow = useMemo(
    () => (selected ? gainers.find((g) => g.ticker === selected) ?? null : null),
    [gainers, selected]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (!moversIndex.length) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const idx = selected ? Math.max(0, moversIndex.indexOf(selected)) : 0;
        const next = moversIndex[Math.min(moversIndex.length - 1, idx + 1)];
        if (next) setSelected(next);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const idx = selected ? Math.max(0, moversIndex.indexOf(selected)) : 0;
        const prev = moversIndex[Math.max(0, idx - 1)];
        if (prev) setSelected(prev);
        return;
      }
      if (e.key === "Enter") {
        if (selected) setDrawerOpen(true);
        return;
      }
      if (e.key === "f") {
        setFiltersOpen((v) => !v);
        setTimeout(() => minPriceRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moversIndex, selected]);

  const selectedCatalysts = useMemo(() => {
    if (!selected) return [];
    return news.filter((n) => n.ticker === selected).slice(0, 8);
  }, [news, selected]);

  function togglePin(ticker: string) {
    setPinned((prev) => {
      const set = new Set(prev);
      if (set.has(ticker)) set.delete(ticker);
      else set.add(ticker);
      return [...set];
    });
  }

  return (
    <div className="cc-2col" style={{ marginTop: 14 }}>
      {/* Left — Movers */}
      <section className="cc-card cc-card--movers" aria-label="Top movers">
        <div className="cc-card-head">
          <div>
            <strong>01</strong> movers · <span style={{ color: "var(--cc-amber)" }}>today</span>
          </div>
          <div className="cc-head-actions">
            <div style={{ color: "var(--cc-faint)" }}>
              {modeLabel ?? "—"}
            </div>
            <div className="cc-seg" role="group" aria-label="Market session">
              {(["auto", "market", "pre", "post"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`cc-seg-btn ${session === k ? "active" : ""}`}
                  onClick={() => setSession(k)}
                >
                  {k}
                </button>
              ))}
            </div>
            <div className="cc-seg" role="group" aria-label="Movers list">
              {(["gainers", "losers", "active", "unusual"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`cc-seg-btn ${kind === k ? "active" : ""}`}
                  onClick={() => setKind(k)}
                >
                  {k}
                </button>
              ))}
            </div>
            <div style={{ position: "relative" }}>
              <button type="button" className={`cc-btn ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((v) => !v)}>
                filters
              </button>
              {filtersOpen && (
                <div className="cc-popover" role="dialog" aria-label="Mover filters">
                  <div className="cc-field">
                    <div className="k">Min price</div>
                    <input
                      className="v"
                      type="number"
                      min={0}
                      step={0.5}
                      ref={minPriceRef}
                      value={minPrice}
                      onChange={(e) => setMinPrice(Number(e.target.value))}
                    />
                  </div>
                  <div className="cc-field">
                    <div className="k">Max price</div>
                    <input
                      className="v"
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="—"
                      value={maxPrice ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!raw) {
                          setMaxPrice(null);
                          return;
                        }
                        const n = Number(raw);
                        setMaxPrice(Number.isFinite(n) ? n : null);
                      }}
                    />
                  </div>
                  <div className="cc-field">
                    <div className="k">Min %</div>
                    <input
                      className="v"
                      type="number"
                      min={0}
                      step={0.5}
                      value={minPct}
                      onChange={(e) => setMinPct(Number(e.target.value))}
                    />
                  </div>
                  <div className="cc-field">
                    <div className="k">Min vol</div>
                    <input
                      className="v"
                      type="number"
                      min={0}
                      step={100}
                      value={minVol}
                      onChange={(e) => setMinVol(Number(e.target.value))}
                    />
                  </div>
                  <div className="cc-field">
                    <div className="k">Rows</div>
                    <select className="v" value={maxRows} onChange={(e) => setMaxRows(Number(e.target.value))}>
                      {[8, 10, 12, 15, 20].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="cc-popover-foot">
                    <button
                      type="button"
                      className="cc-btn"
                      onClick={() => {
                        setMinPrice(1);
                        setMaxPrice(null);
                        setMinPct(5);
                        setMinVol(1000);
                        setMaxRows(12);
                      }}
                    >
                      reset
                    </button>
                    <button type="button" className="cc-btn active" onClick={() => setFiltersOpen(false)}>
                      done
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ position: "relative" }}>
              <button type="button" className={`cc-btn ${columnsOpen ? "active" : ""}`} onClick={() => setColumnsOpen((v) => !v)}>
                columns
              </button>
              {columnsOpen && (
                <div className="cc-popover" role="dialog" aria-label="Watchlist columns">
                  {([
                    { key: "rank" as const, label: "#" },
                    { key: "ticker" as const, label: "Ticker" },
                    { key: "last" as const, label: "Last" },
                    { key: "pct" as const, label: "%" },
                    { key: "chg" as const, label: "$ Chg" },
                    { key: "vol" as const, label: "Vol" },
                    { key: "dvol" as const, label: "$Vol" },
                    { key: "cap" as const, label: "Mkt cap" },
                    { key: "prev" as const, label: "Prev" },
                    { key: "range" as const, label: "Range" },
                    { key: "vwap" as const, label: "VWAP" },
                  ] as const).map((c) => {
                    const isOn = columns.includes(c.key);
                    const idx = columns.indexOf(c.key);
                    return (
                      <div key={c.key} className="cc-field">
                        <div className="k">{c.label}</div>
                        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                          <button
                            type="button"
                            className={`cc-btn ${isOn ? "active" : ""}`}
                            onClick={() => {
                              setColumns((prev) => {
                                if (prev.includes(c.key)) {
                                  // Never allow removing the last column
                                  if (prev.length <= 1) return prev;
                                  return prev.filter((x) => x !== c.key);
                                }
                                return [...prev, c.key];
                              });
                            }}
                          >
                            {isOn ? "on" : "off"}
                          </button>
                          <button
                            type="button"
                            className="cc-btn"
                            disabled={!isOn || idx <= 0}
                            onClick={() =>
                              setColumns((prev) => {
                                const i = prev.indexOf(c.key);
                                if (i <= 0) return prev;
                                const next = [...prev];
                                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                                return next;
                              })
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="cc-btn"
                            disabled={!isOn || idx === -1 || idx >= columns.length - 1}
                            onClick={() =>
                              setColumns((prev) => {
                                const i = prev.indexOf(c.key);
                                if (i === -1 || i >= prev.length - 1) return prev;
                                const next = [...prev];
                                [next[i], next[i + 1]] = [next[i + 1], next[i]];
                                return next;
                              })
                            }
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="cc-popover-foot">
                    <button type="button" className="cc-btn" onClick={() => setColumns(DEFAULT_COLUMNS)}>
                      reset
                    </button>
                    <button type="button" className="cc-btn active" onClick={() => setColumnsOpen(false)}>
                      done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ padding: "0 0 6px" }}>
          {gainersErr ? (
            <div style={{ padding: 12, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
              {gainersErr}
            </div>
          ) : movers.length === 0 ? (
            <div style={{ padding: 12 }}>
              <div style={{ color: "var(--cc-text)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 2.2, fontWeight: 900 }}>
                No matches.
              </div>
              <div style={{ marginTop: 8, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6, fontSize: 11, lineHeight: 1.5 }}>
                Try lowering <span style={{ color: "var(--cc-amber)" }}>min %</span> or widening the price band.
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" className="cc-btn active" onClick={() => setMinPct(Math.max(0, minPct - 2.5))}>
                  lower min %
                </button>
                <button type="button" className="cc-btn" onClick={() => setMaxPrice(null)}>
                  clear max price
                </button>
              </div>
            </div>
          ) : (
            <table className="cc-table">
              <thead>
                <tr>
                  {columns.includes("rank") && <th style={{ width: 44 }}>#</th>}
                  {columns.includes("ticker") && <th style={{ width: 250 }}>Ticker</th>}
                  {columns.includes("last") && <th style={{ width: 70, textAlign: "right" }}>Last</th>}
                  {columns.includes("pct") && <th style={{ width: 70, textAlign: "right" }}>%</th>}
                  {columns.includes("chg") && <th style={{ width: 78, textAlign: "right" }}>$</th>}
                  {columns.includes("vol") && <th style={{ width: 90, textAlign: "right" }}>Vol</th>}
                  {columns.includes("dvol") && <th style={{ width: 90, textAlign: "right" }}>$Vol</th>}
                  {columns.includes("cap") && <th style={{ width: 86, textAlign: "right" }}>Cap</th>}
                  {columns.includes("prev") && <th style={{ width: 70, textAlign: "right" }}>Prev</th>}
                  {columns.includes("range") && <th style={{ width: 88, textAlign: "right" }}>Range</th>}
                  {columns.includes("vwap") && <th style={{ width: 76, textAlign: "right" }}>VWAP</th>}
                </tr>
              </thead>
              <tbody>
                {movers.map((g, i) => {
                  const isActive = selected === g.ticker;
                  const cat = catalystByTicker.get(g.ticker);
                  const isPinned = pinned.includes(g.ticker);
                  const dv = (g.day?.c ?? 0) * (g.day?.v ?? 0);
                  const tags: string[] = [];
                  if (!cat?.title) tags.push("no news");
                  if (Math.abs(g.todaysChangePerc) >= 20) tags.push("momentum");
                  if (dv >= 25_000_000) tags.push("heavy vol");
                  const last = g.day?.c ?? NaN;
                  const vol = g.day?.v ?? NaN;
                  return (
                    <tr
                      key={g.ticker}
                      onClick={() => {
                        setSelected(g.ticker);
                        setDrawerOpen(true);
                      }}
                      style={{
                        cursor: "pointer",
                        background: isActive ? "rgba(245,165,36,0.08)" : "transparent",
                      }}
                    >
                      {columns.includes("rank") && (
                        <td style={{ color: "var(--cc-faint)" }}>{String(i + 1).padStart(2, "0")}</td>
                      )}
                      {columns.includes("ticker") && (
                        <td>
                          <div className="cc-ticker-row">
                            <div className="ticker">{g.ticker}</div>
                            <div className="cc-co" title={g.companyName ?? ""}>
                              {g.companyName ?? "—"}
                            </div>
                            <button
                              type="button"
                              className={`cc-star ${isPinned ? "on" : ""}`}
                              aria-label={isPinned ? "Unpin" : "Pin"}
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePin(g.ticker);
                              }}
                            >
                              {isPinned ? "★" : "☆"}
                            </button>
                          </div>
                          <div className="cc-catalyst" title={cat?.title || ""}>
                            {cat?.title ? cat.title : "—"}
                          </div>
                          {tags.length > 0 && (
                            <div className="cc-tags" aria-label="catalyst tags">
                              {tags.slice(0, 2).map((t) => (
                                <span key={t} className="cc-tag">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      )}
                      {columns.includes("last") && <td style={{ textAlign: "right" }}>{fmtMoney(g.day?.c ?? NaN)}</td>}
                      {columns.includes("pct") && (
                        <td style={{ textAlign: "right", color: "var(--cc-amber)" }}>{fmtPct(g.todaysChangePerc)}</td>
                      )}
                      {columns.includes("chg") && (
                        <td style={{ textAlign: "right" }}>{fmtMoney(g.todaysChange ?? NaN)}</td>
                      )}
                      {columns.includes("vol") && <td style={{ textAlign: "right" }}>{fmtInt(vol)}</td>}
                      {columns.includes("dvol") && (
                        <td style={{ textAlign: "right" }}>{fmtDollarVol(last, vol)}</td>
                      )}
                      {columns.includes("cap") && (
                        <td style={{ textAlign: "right" }}>{fmtCap(g.marketCap ?? null)}</td>
                      )}
                      {columns.includes("prev") && (
                        <td style={{ textAlign: "right" }}>{fmtMoney(g.prevDay?.c ?? NaN)}</td>
                      )}
                      {columns.includes("range") && (
                        <td style={{ textAlign: "right" }}>
                          {fmtMoney(g.day?.l ?? NaN)}–{fmtMoney(g.day?.h ?? NaN)}
                        </td>
                      )}
                      {columns.includes("vwap") && (
                        <td style={{ textAlign: "right" }}>{fmtMoney(g.day?.vw ?? NaN)}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
              src="https://www.youtube.com/embed/iEpJwprxDdk?si=-_ceEQUNL7aYnHih"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
            />
          </div>
          <div style={{ marginTop: 10, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase" }}>
            If this embed is blocked, open Bloomberg in a new tab.
          </div>
        </div>
      </aside>

      {/* Details drawer */}
      {drawerOpen && (
        <div
          className="cc-drawer-overlay"
          role="button"
          aria-label="Close details"
          tabIndex={0}
          onClick={() => setDrawerOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setDrawerOpen(false);
          }}
        >
          <aside
            className="cc-drawer"
            role="dialog"
            aria-label={`Details for ${selected ?? ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cc-drawer-head">
              <div>
                <div className="cc-drawer-kicker">details</div>
                <div className="cc-drawer-title">{selectedRow?.ticker ?? selected ?? "—"}</div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {selectedRow?.ticker && (
                  <button
                    type="button"
                    className={`cc-btn ${pinned.includes(selectedRow.ticker) ? "active" : ""}`}
                    onClick={() => togglePin(selectedRow.ticker)}
                  >
                    {pinned.includes(selectedRow.ticker) ? "pinned" : "pin"}
                  </button>
                )}
                <button type="button" className="cc-btn" onClick={() => setDrawerOpen(false)}>
                  close
                </button>
              </div>
            </div>

            <div className="cc-drawer-body">
              <div className="cc-metrics">
                <div className="cc-metric">
                  <div className="k">Last</div>
                  <div className="v">{fmtMoney(selectedRow?.day?.c ?? NaN)}</div>
                </div>
                <div className="cc-metric">
                  <div className="k">% chg</div>
                  <div className="v" style={{ color: "var(--cc-amber)" }}>
                    {fmtPct(selectedRow?.todaysChangePerc ?? NaN)}
                  </div>
                </div>
                <div className="cc-metric">
                  <div className="k">Vol</div>
                  <div className="v">{Number.isFinite(selectedRow?.day?.v) ? Intl.NumberFormat("en-US").format(selectedRow!.day.v) : "—"}</div>
                </div>
                <div className="cc-metric">
                  <div className="k">Mkt cap</div>
                  <div className="v">{fmtCap(selectedRow?.marketCap ?? null)}</div>
                </div>
                <div className="cc-metric">
                  <div className="k">Prev close</div>
                  <div className="v">{fmtMoney(selectedRow?.prevDay?.c ?? NaN)}</div>
                </div>
                <div className="cc-metric">
                  <div className="k">Day range</div>
                  <div className="v">
                    {fmtMoney(selectedRow?.day?.l ?? NaN)}–{fmtMoney(selectedRow?.day?.h ?? NaN)}
                  </div>
                </div>
              </div>

              <div className="cc-drawer-section">
                <div className="cc-drawer-section-head">Catalyst</div>
                {selectedCatalysts.length === 0 ? (
                  <div className="cc-drawer-muted">No related news returned yet.</div>
                ) : (
                  <div className="cc-drawer-news">
                    {selectedCatalysts.map((n) => (
                      <a key={n.id} className="cc-drawer-news-item" href={n.url} target="_blank" rel="noreferrer">
                        <div className="t">{n.title}</div>
                        <div className="m">
                          {(n.source ?? "—").toUpperCase()}
                          {n.published_utc ? ` · ${relTime(n.published_utc)}` : ""}
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

