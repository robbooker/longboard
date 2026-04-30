"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GainersData, PolygonTickerSnapshot } from "@/types/polygon";
import type { ResearchBrief } from "@/types/research";

type NewsItem = {
  id: string;
  ticker: string;
  published_utc?: string;
  title: string;
  author?: string;
  source?: string;
  url?: string;
};

const RESEARCH_CACHE_PREFIX = "longboard_research_";
const RESEARCH_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function researchCacheGet(ticker: string): { brief: ResearchBrief; cachedAt: string } | null {
  try {
    const raw = window.localStorage.getItem(RESEARCH_CACHE_PREFIX + ticker);
    return raw ? (JSON.parse(raw) as { brief: ResearchBrief; cachedAt: string }) : null;
  } catch {
    return null;
  }
}

function researchCacheSet(brief: ResearchBrief) {
  try {
    window.localStorage.setItem(
      RESEARCH_CACHE_PREFIX + brief.ticker,
      JSON.stringify({
        brief,
        cachedAt: new Date().toISOString(),
      })
    );
  } catch {
    // storage full; ignore
  }
}

function isResearchCacheFresh(cachedAtIso: string): boolean {
  const t = Date.parse(cachedAtIso);
  return Number.isFinite(t) && Date.now() - t < RESEARCH_CACHE_TTL_MS;
}

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

function fmtDollarsShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtSharesShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n).toLocaleString()}`;
}

function fmtPctSigned(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function cleanBriefText(raw: string): string {
  let text = raw.replace(/\*\*/g, "");
  text = text.replace(/\[\d+\]/g, "");
  text = text.replace(/  +/g, " ");
  return text.trim();
}

export default function CommandFindClient() {
  const [gainers, setGainers] = useState<PolygonTickerSnapshot[]>([]);
  const [gainersErr, setGainersErr] = useState<string | null>(null);
  const [gainersFetchedAt, setGainersFetchedAt] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [kind, setKind] = useState<"gainers" | "losers" | "active" | "unusual">("gainers");
  const [session, setSession] = useState<"auto" | "market" | "pre" | "post">("auto");
  const [modeLabel, setModeLabel] = useState<string | null>(null);

  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [columnsExpanded, setColumnsExpanded] = useState(false);
  const [minPrice, setMinPrice] = useState<number>(1);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [minPct, setMinPct] = useState<number>(5);
  const [maxPct, setMaxPct] = useState<number | null>(null);
  const [minVol, setMinVol] = useState<number>(1000);
  const [maxVol, setMaxVol] = useState<number | null>(null);
  const [minCap, setMinCap] = useState<number>(0);
  const [maxCap, setMaxCap] = useState<number | null>(200_000_000);
  const [maxRows, setMaxRows] = useState<number>(12);
  const minPriceRef = useRef<HTMLInputElement | null>(null);

  const [filtersMode, setFiltersMode] = useState<"slider" | "custom">("slider");

  const [pinned, setPinned] = useState<string[]>([]);
  /** User-curated tickers (persisted); quotes loaded via `/api/command/ticker`. */
  const [savedWatchlist, setSavedWatchlist] = useState<string[]>([]);
  const [watchlistDrawerOpen, setWatchlistDrawerOpen] = useState(false);
  const [watchlistRows, setWatchlistRows] = useState<Record<string, PolygonTickerSnapshot | null>>({});
  const [watchlistInput, setWatchlistInput] = useState("");

  const PRICE_STEPS = useMemo(() => [0, 1, 2, 5, 10, 20, 50, 100, Infinity] as const, []);
  const VOL_STEPS = useMemo(() => [0, 1_000, 5_000, 10_000, 50_000, 100_000, 1_000_000, 5_000_000, 20_000_000, Infinity] as const, []);
  const PCT_STEPS = useMemo(() => [0, 2, 4, 10, 20, 40, 80, Infinity] as const, []);
  const CAP_STEPS = useMemo(() => [0, 50_000_000, 300_000_000, 2_000_000_000, 10_000_000_000, 50_000_000_000, 500_000_000_000, Infinity] as const, []);

  const [sliderPriceMinIdx, setSliderPriceMinIdx] = useState(1);
  const [sliderPriceMaxIdx, setSliderPriceMaxIdx] = useState(8);
  const [sliderVolMinIdx, setSliderVolMinIdx] = useState(1);
  const [sliderVolMaxIdx, setSliderVolMaxIdx] = useState(9);
  const [sliderPctMinIdx, setSliderPctMinIdx] = useState(2);
  const [sliderPctMaxIdx, setSliderPctMaxIdx] = useState(7);
  const [sliderCapMinIdx, setSliderCapMinIdx] = useState(0);
  const [sliderCapMaxIdx, setSliderCapMaxIdx] = useState(3);

  useEffect(() => {
    if (filtersMode !== "slider") return;
    setMinPrice(PRICE_STEPS[sliderPriceMinIdx]);
    setMaxPrice(Number.isFinite(PRICE_STEPS[sliderPriceMaxIdx]) ? PRICE_STEPS[sliderPriceMaxIdx] : null);
    setMinVol(VOL_STEPS[sliderVolMinIdx]);
    setMaxVol(Number.isFinite(VOL_STEPS[sliderVolMaxIdx]) ? VOL_STEPS[sliderVolMaxIdx] : null);
    setMinPct(PCT_STEPS[sliderPctMinIdx]);
    setMaxPct(Number.isFinite(PCT_STEPS[sliderPctMaxIdx]) ? PCT_STEPS[sliderPctMaxIdx] : null);
    setMinCap(CAP_STEPS[sliderCapMinIdx]);
    setMaxCap(Number.isFinite(CAP_STEPS[sliderCapMaxIdx]) ? CAP_STEPS[sliderCapMaxIdx] : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    filtersMode,
    sliderPriceMinIdx,
    sliderPriceMaxIdx,
    sliderVolMinIdx,
    sliderVolMaxIdx,
    sliderPctMinIdx,
    sliderPctMaxIdx,
    sliderCapMinIdx,
    sliderCapMaxIdx,
  ]);

  function fmtStep(n: number, kind: "price" | "vol" | "pct" | "cap"): string {
    if (!Number.isFinite(n)) return "∞";
    if (kind === "price") return n >= 1 ? String(n) : n.toFixed(2);
    if (kind === "pct") return String(n);
    if (kind === "vol") return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(Math.round(n));
    // cap
    if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    return `${Math.round(n / 1_000_000)}M`;
  }

  const [strategyRows, setStrategyRows] = useState<{
    gainers: PolygonTickerSnapshot[];
    losers: PolygonTickerSnapshot[];
    active: PolygonTickerSnapshot[];
    unusual: PolygonTickerSnapshot[];
  }>({ gainers: [], losers: [], active: [], unusual: [] });

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
      if (!raw?.trim()) return;
      const p = JSON.parse(raw) as Partial<{
        kind: "gainers" | "losers" | "active" | "unusual";
        session: "auto" | "market" | "pre" | "post";
        minPrice: number;
        maxPrice: number | null;
        minPct: number;
        maxPct: number | null;
        minVol: number;
        maxVol: number | null;
        minCap: number;
        maxCap: number | null;
        maxRows: number;
        pinned: string[];
        savedWatchlist?: string[];
        columns: ColumnKey[];
        filtersExpanded: boolean;
        columnsExpanded: boolean;
        filtersMode: "slider" | "custom";
        selected: string | null;
      }>;
      if (p.kind) setKind(p.kind);
      // Session selector removed from UI; keep for compatibility but default to auto.
      if (p.session) setSession(p.session);
      if (typeof p.minPrice === "number") setMinPrice(p.minPrice);
      if (typeof p.maxPrice === "number" || p.maxPrice === null) setMaxPrice(p.maxPrice ?? null);
      if (typeof p.minPct === "number") setMinPct(p.minPct);
      if (typeof p.maxPct === "number" || p.maxPct === null) setMaxPct(p.maxPct ?? null);
      if (typeof p.minVol === "number") setMinVol(p.minVol);
      if (typeof p.maxVol === "number" || p.maxVol === null) setMaxVol(p.maxVol ?? null);
      if (typeof p.minCap === "number") setMinCap(p.minCap);
      if (typeof p.maxCap === "number" || p.maxCap === null) setMaxCap(p.maxCap ?? null);
      if (typeof p.maxRows === "number") setMaxRows(p.maxRows);
      if (Array.isArray(p.pinned)) setPinned(p.pinned.filter(Boolean));
      if (Array.isArray(p.savedWatchlist)) {
        const seen = new Set<string>();
        const next: string[] = [];
        for (const raw of p.savedWatchlist) {
          const t = String(raw || "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z.\-]/g, "");
          if (!t || t.length > 8 || seen.has(t)) continue;
          seen.add(t);
          next.push(t);
        }
        setSavedWatchlist(next.slice(0, 40));
      }
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
      if (typeof p.filtersExpanded === "boolean") setFiltersExpanded(p.filtersExpanded);
      if (typeof p.columnsExpanded === "boolean") setColumnsExpanded(p.columnsExpanded);
      if (p.filtersMode === "slider" || p.filtersMode === "custom") setFiltersMode(p.filtersMode);
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
      maxPct,
      minVol,
      maxVol,
      minCap,
      maxCap,
      maxRows,
      pinned,
      savedWatchlist,
      columns,
      filtersExpanded,
      columnsExpanded,
      filtersMode,
      selected,
    };
    try {
      window.localStorage.setItem("lb.command.find.prefs", JSON.stringify(payload));
    } catch {
      // ignore
    }
  }, [
    kind,
    session,
    minPrice,
    maxPrice,
    minPct,
    maxPct,
    minVol,
    maxVol,
    minCap,
    maxCap,
    maxRows,
    pinned,
    savedWatchlist,
    columns,
    filtersExpanded,
    columnsExpanded,
    filtersMode,
    selected,
  ]);

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
        setGainersFetchedAt(typeof data.fetchedAt === "string" ? data.fetchedAt : null);
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

  // Keep session pinned to auto since UI session selector is removed.
  useEffect(() => {
    if (session !== "auto") setSession("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (savedWatchlist.length === 0) {
      setWatchlistRows({});
      return;
    }
    let cancelled = false;

    async function load() {
      const next: Record<string, PolygonTickerSnapshot | null> = {};
      await Promise.all(
        savedWatchlist.map(async (sym) => {
          try {
            const r = await fetch(`/api/command/ticker?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" });
            const j = (await r.json().catch(() => ({}))) as { ticker?: PolygonTickerSnapshot };
            const row = j?.ticker;
            next[sym] = row?.ticker === sym ? row : null;
          } catch {
            next[sym] = null;
          }
        })
      );
      if (!cancelled) setWatchlistRows(next);
    }

    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [savedWatchlist]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const kinds = ["gainers", "losers", "active", "unusual"] as const;
        const res = await Promise.all(
          kinds.map((k) =>
            fetch(`/api/command/movers?kind=${encodeURIComponent(k)}&session=${encodeURIComponent(session)}`, { cache: "no-store" })
              .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }))
          )
        );

        if (cancelled) return;
        const next = { gainers: [], losers: [], active: [], unusual: [] } as {
          gainers: PolygonTickerSnapshot[];
          losers: PolygonTickerSnapshot[];
          active: PolygonTickerSnapshot[];
          unusual: PolygonTickerSnapshot[];
        };
        for (let i = 0; i < kinds.length; i++) {
          const k = kinds[i];
          const data = res[i]?.json as { tickers?: PolygonTickerSnapshot[] };
          next[k] = Array.isArray(data?.tickers) ? data.tickers : [];
        }
        setStrategyRows(next);
      } catch {
        if (!cancelled) setStrategyRows({ gainers: [], losers: [], active: [], unusual: [] });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (e.key === "Escape") {
        setDrawerOpen(false);
        setWatchlistDrawerOpen(false);
        setFiltersExpanded(false);
        setColumnsExpanded(false);
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setFiltersExpanded(true);
        setTimeout(() => minPriceRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const tickersCsv = useMemo(() => {
    const set = new Set<string>();
    for (const t of savedWatchlist) if (t) set.add(t);
    for (const g of gainers) if (g?.ticker) set.add(g.ticker);
    for (const group of Object.values(strategyRows)) for (const g of group) if (g?.ticker) set.add(g.ticker);
    if (selected) set.add(selected);
    return [...set].slice(0, 16).join(",");
  }, [gainers, savedWatchlist, selected, strategyRows]);

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
        const vol = g.day?.v ?? NaN;
        const cap = g.marketCap ?? null;
        if (!Number.isFinite(last) || last < minPrice) return false;
        if (maxPrice != null && Number.isFinite(last) && last > maxPrice) return false;
        if (!Number.isFinite(pct) || Math.abs(pct) < minPct) return false;
        if (maxPct != null && Number.isFinite(pct) && Math.abs(pct) > maxPct) return false;
        if (!Number.isFinite(vol) || vol < minVol) return false;
        if (maxVol != null && Number.isFinite(vol) && vol > maxVol) return false;
        if (cap == null) return false;
        if (Number.isFinite(minCap) && cap < minCap) return false;
        if (maxCap != null && cap > maxCap) return false;
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
  }, [gainers, maxCap, maxPct, maxPrice, maxRows, maxVol, minCap, minPct, minPrice, minVol, pinned]);

  const moversIndex = useMemo(() => movers.map((m) => m.ticker), [movers]);

  const watchlistMinWidth = useMemo(() => {
    const widths: Record<ColumnKey, number> = {
      rank: 44,
      ticker: 248,
      last: 70,
      pct: 70,
      chg: 78,
      vol: 90,
      dvol: 90,
      cap: 86,
      prev: 70,
      range: 88,
      vwap: 76,
    };
    const sum = columns.reduce((acc, c) => acc + (widths[c] ?? 90), 0);
    return sum + 24; // a little breathing room
  }, [columns]);

  const allByTicker = useMemo(() => {
    const map = new Map<string, PolygonTickerSnapshot>();
    for (const r of gainers) map.set(r.ticker, r);
    for (const group of Object.values(strategyRows)) for (const r of group) map.set(r.ticker, r);
    for (const sym of savedWatchlist) {
      const w = watchlistRows[sym];
      if (w?.ticker) map.set(sym, w);
    }
    return map;
  }, [gainers, savedWatchlist, strategyRows, watchlistRows]);

  const selectedRow = useMemo(() => (selected ? allByTicker.get(selected) ?? null : null), [allByTicker, selected]);

  const [researchBrief, setResearchBrief] = useState<ResearchBrief | null>(null);
  const [researchCachedAt, setResearchCachedAt] = useState<string | null>(null);
  const [researchStatus, setResearchStatus] = useState<"idle" | "loading" | "error">("idle");
  const [researchError, setResearchError] = useState<string | null>(null);

  async function loadResearch(ticker: string, opts?: { force?: boolean }) {
    const t = ticker.trim().toUpperCase();
    if (!t) return;

    if (!opts?.force) {
      const cached = researchCacheGet(t);
      if (cached?.brief && cached?.cachedAt && isResearchCacheFresh(cached.cachedAt)) {
        setResearchBrief(cached.brief);
        setResearchCachedAt(cached.cachedAt);
        setResearchStatus("idle");
        setResearchError(null);
        return;
      }
    }

    setResearchStatus("loading");
    setResearchError(null);
    try {
      const res = await fetch(`/api/research?ticker=${encodeURIComponent(t)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as ResearchBrief | { error?: string } | null;
      if (!res.ok || !body || (body as any)?.error) {
        const msg = (body as any)?.error || `HTTP ${res.status}`;
        setResearchStatus("error");
        setResearchError(String(msg));
        return;
      }
      const brief = body as ResearchBrief;
      setResearchBrief(brief);
      const nowIso = new Date().toISOString();
      setResearchCachedAt(nowIso);
      researchCacheSet(brief);
      setResearchStatus("idle");
    } catch (e) {
      setResearchStatus("error");
      setResearchError(e instanceof Error ? e.message : "Failed to load research");
    }
  }

  // Lazy-load research for the currently opened details drawer ticker.
  useEffect(() => {
    if (!drawerOpen) return;
    const t = (selectedRow?.ticker ?? selected ?? "").trim().toUpperCase();
    if (!t) return;

    // Avoid showing stale research for a different ticker while switching.
    if (researchBrief?.ticker && researchBrief.ticker !== t) {
      setResearchBrief(null);
      setResearchCachedAt(null);
      setResearchStatus("idle");
      setResearchError(null);
    }

    void loadResearch(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerOpen, selectedRow?.ticker, selected]);

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
        if (selected) {
          setWatchlistDrawerOpen(false);
          setDrawerOpen(true);
        }
        return;
      }
      if (e.key === "f") {
        setFiltersExpanded((v) => !v);
        setTimeout(() => minPriceRef.current?.focus(), 0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moversIndex, selected]);

  const strategyScans = useMemo(() => {
    const out: Array<{ id: string; title: string; criteria: string; rows: PolygonTickerSnapshot[] }> = [];

    const gain = strategyRows.gainers ?? [];
    const lose = strategyRows.losers ?? [];
    const active = strategyRows.active ?? [];
    const unusual = strategyRows.unusual ?? [];

    const uniqByTicker = (rows: PolygonTickerSnapshot[]): PolygonTickerSnapshot[] => {
      const seen = new Set<string>();
      const out: PolygonTickerSnapshot[] = [];
      for (const r of rows) {
        if (!r?.ticker) continue;
        if (seen.has(r.ticker)) continue;
        seen.add(r.ticker);
        out.push(r);
      }
      return out;
    };

    const dollarVol = (r: PolygonTickerSnapshot) => (r.day?.c ?? 0) * (r.day?.v ?? 0);
    const gapPct = (r: PolygonTickerSnapshot) => {
      const prev = r.prevDay?.c ?? NaN;
      const o = r.day?.o ?? NaN;
      if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(o)) return NaN;
      return ((o - prev) / prev) * 100;
    };

    // Price Spike
    out.push({
      id: "price_spike",
      title: "Price spike",
      criteria: "≥20% move + liquidity",
      rows: uniqByTicker(
        gain
        .filter((r) => Math.abs(r.todaysChangePerc) >= 20 && dollarVol(r) >= 10_000_000)
        .sort((a, b) => Math.abs(b.todaysChangePerc) - Math.abs(a.todaysChangePerc))
          .slice(0, 20)
      ).slice(0, 8),
    });

    // Opening Gap
    const gapRows = uniqByTicker(
      [...gain, ...lose]
      .map((r) => ({ r, g: gapPct(r) }))
      .filter((x) => Number.isFinite(x.g) && Math.abs(x.g) >= 10)
      .sort((a, b) => Math.abs(b.g) - Math.abs(a.g))
        .slice(0, 20)
        .map((x) => x.r)
    ).slice(0, 8);
    out.push({ id: "opening_gap", title: "Opening gap", criteria: "Open vs prev close ≥10%", rows: gapRows });

    // Heavy Volume
    const hv = uniqByTicker([...active, ...unusual])
      .sort((a, b) => dollarVol(b) - dollarVol(a))
      .slice(0, 8);
    out.push({ id: "heavy_vol", title: "Heavy volume", criteria: "Rank by $Vol", rows: hv });

    // Drop & Pop (MVP)
    const dap = uniqByTicker(
      lose
        .filter((r) => r.todaysChangePerc <= -5 && Number.isFinite(r.day?.o) && (r.day?.c ?? 0) > (r.day?.o ?? 0))
        .sort((a, b) => a.todaysChangePerc - b.todaysChangePerc)
        .slice(0, 20)
    ).slice(0, 8);
    out.push({ id: "drop_pop", title: "Drop & pop", criteria: "≤-5% and closes above open", rows: dap });

    return out.filter((s) => s.rows.length > 0);
  }, [strategyRows]);

  const [selectedStrategyId, setSelectedStrategyId] = useState<string>("price_spike");

  useEffect(() => {
    if (strategyScans.length === 0) return;
    if (strategyScans.some((s) => s.id === selectedStrategyId)) return;
    setSelectedStrategyId(strategyScans[0].id);
  }, [selectedStrategyId, strategyScans]);

  const selectedStrategy = useMemo(
    () => strategyScans.find((s) => s.id === selectedStrategyId) ?? null,
    [selectedStrategyId, strategyScans]
  );

  const selectedCatalysts = useMemo(() => {
    if (!selected) return [];
    return news.filter((n) => n.ticker === selected).slice(0, 8);
  }, [news, selected]);

  const [chartTicker, setChartTicker] = useState<string | null>(null);
  const [chartTickerInput, setChartTickerInput] = useState<string>("");
  const [chartRemote, setChartRemote] = useState<PolygonTickerSnapshot | null>(null);
  const [chartRemoteStatus, setChartRemoteStatus] = useState<"idle" | "loading" | "error">("idle");

  // Default chart symbol: prefer first filtered mover, else first raw gainer
  // (when filters screen out every row, movers is empty but gainers still loads).
  useEffect(() => {
    if (chartTicker) return;
    const fromMovers = movers[0]?.ticker ?? null;
    const fromGainers = gainers[0]?.ticker ?? null;
    const next = fromMovers ?? fromGainers;
    if (!next) return;
    setChartTicker(next);
    setChartTickerInput((p) => (p.trim() ? p : next));
  }, [chartTicker, movers, gainers]);

  const tvSymbol = useMemo(() => {
    const t = chartTicker?.trim();
    if (!t) return null;
    return `NASDAQ:${t.toUpperCase()}`;
  }, [chartTicker]);

  function applyChartTicker(raw: string) {
    const t = raw.trim().toUpperCase().replace(/[^A-Z.\-]/g, "");
    if (!t) return;
    setChartTicker(t);
    setChartTickerInput(t);
  }

  useEffect(() => {
    const t = chartTicker?.trim();
    if (!t) return;

    if (allByTicker.has(t)) {
      setChartRemote(null);
      setChartRemoteStatus("idle");
      return;
    }

    let cancelled = false;
    setChartRemoteStatus("loading");
    fetch(`/api/command/ticker?symbol=${encodeURIComponent(t)}`, { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (cancelled) return;
        const row = j?.ticker as PolygonTickerSnapshot | undefined;
        if (!row?.ticker) {
          setChartRemote(null);
          setChartRemoteStatus("error");
          return;
        }
        setChartRemote(row);
        setChartRemoteStatus("idle");
      })
      .catch(() => {
        if (cancelled) return;
        setChartRemote(null);
        setChartRemoteStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [allByTicker, chartTicker]);

  const tvSrc = useMemo(() => {
    if (!tvSymbol) return null;
    const u = new URL("https://s.tradingview.com/widgetembed/");
    u.searchParams.set("symbol", tvSymbol);
    u.searchParams.set("interval", "5");
    u.searchParams.set("theme", "dark");
    u.searchParams.set("style", "1");
    u.searchParams.set("withdateranges", "1");
    u.searchParams.set("hideideas", "1");
    u.searchParams.set("hidesidetoolbar", "1");
    u.searchParams.set("saveimage", "0");
    u.searchParams.set("symboledit", "0");
    u.searchParams.set("toolbarbg", "rgba(0,0,0,0)");
    u.searchParams.set("studies", "");
    return u.toString();
  }, [tvSymbol]);

  const chartRow = useMemo(() => {
    const t = chartTicker?.trim();
    if (!t) return null;
    return allByTicker.get(t) ?? (chartRemote?.ticker === t ? chartRemote : null);
  }, [allByTicker, chartRemote, chartTicker]);

  const chartKpi = useMemo(() => {
    return {
      last: chartRow?.day?.c ?? NaN,
      prev: chartRow?.prevDay?.c ?? NaN,
      rangeLo: chartRow?.day?.l ?? NaN,
      rangeHi: chartRow?.day?.h ?? NaN,
      vol: chartRow?.day?.v ?? NaN,
      vwap: chartRow?.day?.vw ?? NaN,
      cap: chartRow?.marketCap ?? null,
      chgPctAbs: Math.abs(chartRow?.todaysChangePerc ?? NaN),
      companyName: chartRow?.companyName ?? null,
    };
  }, [chartRow]);

  const [secTab, setSecTab] = useState<"all" | "dilution" | "insider">("all");

  type FinnhubFiling = {
    id?: string;
    filedDate?: string;
    reportDate?: string;
    form?: string;
    description?: string;
    url?: string;
  };

  type FinnhubEarningsRow = {
    period?: string;
    year?: number;
    quarter?: number;
    actual?: number;
    estimate?: number;
    surprise?: number;
    surprisePercent?: number;
  };

  const [secItems, setSecItems] = useState<FinnhubFiling[]>([]);
  const [secStatus, setSecStatus] = useState<"idle" | "loading" | "error">("idle");

  const [fhMetric, setFhMetric] = useState<Record<string, unknown> | null>(null);
  const [fhEarnings, setFhEarnings] = useState<FinnhubEarningsRow[]>([]);
  const [fhStatus, setFhStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fhCompanyName, setFhCompanyName] = useState<string | null>(null);

  useEffect(() => {
    const t = chartTicker?.trim();
    if (!t) {
      setSecItems([]);
      setSecStatus("idle");
      setFhMetric(null);
      setFhEarnings([]);
      setFhStatus("idle");
      setFhCompanyName(null);
      return;
    }

    let cancelled = false;
    setSecStatus("loading");
    setFhStatus("loading");

    const timeoutMs = 12_000;
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);

    Promise.all([
      fetch(`/api/command/filings?symbol=${encodeURIComponent(t)}&limit=24`, { cache: "no-store", signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/command/fundamentals?symbol=${encodeURIComponent(t)}`, { cache: "no-store", signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([filings, fund]) => {
        if (cancelled) return;
        clearTimeout(to);

        const items = Array.isArray(filings?.items) ? (filings.items as FinnhubFiling[]) : [];
        setSecItems(items);
        setSecStatus(items.length ? "idle" : "error");

        const nameRaw = fund?.profile?.name;
        const name = typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : null;
        setFhCompanyName(name);

        const metric = fund?.metric && typeof fund.metric === "object" ? (fund.metric as Record<string, unknown>) : null;
        const earnings = Array.isArray(fund?.earnings) ? (fund.earnings as FinnhubEarningsRow[]) : [];
        setFhMetric(metric);
        setFhEarnings(earnings);
        setFhStatus(metric || earnings.length ? "idle" : "error");
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(to);
        setSecStatus("error");
        setFhStatus("error");
      });

    return () => {
      cancelled = true;
      clearTimeout(to);
      ac.abort();
    };
  }, [chartTicker]);

  function fhNum(key: string): number | null {
    const v = fhMetric ? (fhMetric as any)[key] : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }

  function edgarSearchUrl(symbol: string, form?: string, filedDate?: string): string {
    const qParts = [symbol.trim().toUpperCase()];
    const f = (form || "").trim().toUpperCase();
    if (f) qParts.push(f);
    const q = qParts.join(" ");

    const u = new URL("https://www.sec.gov/edgar/search/");
    // EDGAR uses hash routing; keep it minimal. Extra params often trigger a
    // generic SPA error ("unexpected error occurred").
    u.hash = `#/q=${encodeURIComponent(q)}`;
    return u.toString();
  }

  function togglePin(ticker: string) {
    setPinned((prev) => {
      const set = new Set(prev);
      if (set.has(ticker)) set.delete(ticker);
      else set.add(ticker);
      return [...set];
    });
  }

  const MAX_SAVED_WATCHLIST = 40;

  function normalizeListedTicker(raw: string): string | null {
    const t = raw.trim().toUpperCase().replace(/[^A-Z.\-]/g, "");
    if (!t || t.length > 8) return null;
    return t;
  }

  function addSavedWatchlistTicker(raw: string) {
    const t = normalizeListedTicker(raw);
    if (!t) return;
    setSavedWatchlist((prev) => {
      if (prev.includes(t)) return prev;
      if (prev.length >= MAX_SAVED_WATCHLIST) return prev;
      return [...prev, t];
    });
  }

  function removeSavedWatchlistTicker(ticker: string) {
    setSavedWatchlist((prev) => prev.filter((x) => x !== ticker));
  }

  function toggleSavedWatchlistTicker(ticker: string) {
    setSavedWatchlist((prev) => {
      if (prev.includes(ticker)) return prev.filter((x) => x !== ticker);
      if (prev.length >= MAX_SAVED_WATCHLIST) return prev;
      return [...prev, ticker];
    });
  }

  return (
    <div className="cc-3col cc-3col--watch-wide" style={{ marginTop: 14 }}>
      {/* Chart (spans columns 1–2) */}
      <section className="cc-card cc-chart" aria-label="Chart">
        <div className="cc-card-head">
          <div>
            chart · <span style={{ color: "var(--cc-amber)" }}>{chartTicker ?? "—"}</span>
          </div>
          <div className="cc-head-actions">
            <form
              className="cc-ticker-entry"
              onSubmit={(e) => {
                e.preventDefault();
                applyChartTicker(chartTickerInput);
              }}
            >
              <input
                className="cc-ticker-input"
                value={chartTickerInput}
                onChange={(e) => setChartTickerInput(e.target.value)}
                placeholder="Ticker"
                inputMode="text"
                aria-label="Set chart ticker"
              />
              <button type="submit" className="cc-btn" title="Load ticker in chart">
                load
              </button>
            </form>
            <div style={{ color: "var(--cc-faint)" }}>{tvSymbol ?? ""}</div>
          </div>
        </div>

        <div style={{ padding: 0 }}>
          {!tvSrc ? (
            <div style={{ padding: 12, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
              Waiting for watchlist…
            </div>
          ) : (
            <div className="cc-tv">
              <iframe
                key={tvSymbol}
                src={tvSrc}
                title={`TradingView chart ${tvSymbol}`}
                style={{ width: "100%", height: "100%", border: 0, display: "block" }}
                loading="lazy"
                allow="fullscreen"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          )}
        </div>
      </section>

      <div className="cc-left-stack" aria-label="Scanner column">
        {/* Left — Movers */}
        <section className="cc-card cc-card--movers" aria-label="Top movers">
          <div className="cc-card-head">
            <div>
              scanner · <span style={{ color: "var(--cc-amber)" }}>watchlist</span>
            </div>
            <div className="cc-head-actions">
              <button
                type="button"
                className={`cc-btn ${watchlistDrawerOpen ? "active" : ""}`}
                onClick={() => {
                  setWatchlistDrawerOpen((v) => {
                    const next = !v;
                    if (next) setDrawerOpen(false);
                    return next;
                  });
                }}
                title="Open My list — saved tickers in this browser"
              >
                my list{savedWatchlist.length > 0 ? ` · ${savedWatchlist.length}` : ""}
              </button>
              <div style={{ color: "var(--cc-faint)" }}>
                {modeLabel ?? "—"}
                {gainersFetchedAt ? ` · ${relTime(gainersFetchedAt)}` : ""}
                {newsLoading ? " · news" : ""}
              </div>
              <div className="cc-seg" role="group" aria-label="Movers list">
                {(["gainers", "losers", "active", "unusual"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`cc-seg-btn ${kind === k ? "active" : ""}`}
                    onClick={() => setKind(k)}
                    title={
                      k === "gainers"
                        ? "Top % gainers (small-cap band)"
                        : k === "losers"
                          ? "Top % losers (small-cap band)"
                          : k === "active"
                            ? "Most active by volume"
                            : "Unusual activity (rank by $Vol + move)"
                    }
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="cc-toolbar">
            <button
              type="button"
              className={`cc-toolbar-btn ${watchlistDrawerOpen ? "active" : ""}`}
              onClick={() => {
                setWatchlistDrawerOpen((v) => {
                  const next = !v;
                  if (next) setDrawerOpen(false);
                  return next;
                });
              }}
              title="Open your saved ticker list (stored in this browser)"
            >
              My list
              <span className="cc-toolbar-sub">{`${savedWatchlist.length} saved · max ${MAX_SAVED_WATCHLIST}`}</span>
            </button>
            <button
              type="button"
              className={`cc-toolbar-btn ${filtersExpanded ? "active" : ""}`}
              onClick={() => {
                setFiltersExpanded((v) => !v);
                if (!filtersExpanded) setTimeout(() => minPriceRef.current?.focus(), 0);
              }}
              title="Open scanner filters (price, volume, % move, market cap)"
            >
              Filters
              <span className="cc-toolbar-sub">
                {`$${minPrice}–${maxPrice != null ? `$${maxPrice}` : "∞"} · ${minPct}%–${maxPct != null ? `${maxPct}%` : "∞"} · vol ${fmtInt(minVol)}–${maxVol != null ? fmtInt(maxVol) : "∞"} · cap ${fmtCap(minCap)}–${fmtCap(maxCap)}`}
              </span>
            </button>
            <button
              type="button"
              className={`cc-toolbar-btn ${columnsExpanded ? "active" : ""}`}
              onClick={() => setColumnsExpanded((v) => !v)}
              title="Choose which watchlist columns to show and reorder them"
            >
              Columns
              <span className="cc-toolbar-sub">
                {columns.join(" · ")}
                {columns.length > 4 ? " · scroll ⇆" : ""}
              </span>
            </button>
          </div>

        {filtersExpanded && (
          <div className="cc-filter-panel" aria-label="Scanner filters">
            <div className="cc-filter-mode">
              <div className="cc-filter-mode-title" title="Use preset sliders or type custom ranges">
                mode
              </div>
              <div className="cc-seg" role="group" aria-label="Filters mode">
                {(["slider", "custom"] as const).map((m) => (
                  <button key={m} type="button" className={`cc-seg-btn ${filtersMode === m ? "active" : ""}`} onClick={() => setFiltersMode(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="cc-filter-grid">
              <div className="cc-field">
                <div className="k">Price</div>
                {filtersMode === "slider" ? (
                  <div className="cc-slider">
                    <div className="cc-slider-head">
                      <div className="cc-slider-val">{`$${fmtStep(PRICE_STEPS[sliderPriceMinIdx], "price")}–${fmtStep(PRICE_STEPS[sliderPriceMaxIdx], "price") === "∞" ? "∞" : `$${fmtStep(PRICE_STEPS[sliderPriceMaxIdx], "price")}`}`}</div>
                    </div>
                    <div className="cc-slider-rails" role="group" aria-label="Price range">
                      <input
                        className="cc-slider-min"
                        type="range"
                        min={0}
                        max={PRICE_STEPS.length - 1}
                        step={1}
                        value={sliderPriceMinIdx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setSliderPriceMinIdx(Math.min(next, sliderPriceMaxIdx));
                        }}
                      />
                      <input
                        className="cc-slider-max"
                        type="range"
                        min={0}
                        max={PRICE_STEPS.length - 1}
                        step={1}
                        value={sliderPriceMaxIdx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setSliderPriceMaxIdx(Math.max(next, sliderPriceMinIdx));
                        }}
                      />
                    </div>
                    <div className="cc-slider-ticks" aria-hidden="true">
                      {PRICE_STEPS.map((n, i) => (
                        <div key={i} className={`cc-slider-tick ${i === 0 || i === PRICE_STEPS.length - 1 || i === 3 || i === 5 ? "show" : ""}`}>
                          {fmtStep(n, "price")}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="cc-range">
                    <input className="v" type="number" min={0} step={0.5} ref={minPriceRef} value={minPrice} onChange={(e) => setMinPrice(Number(e.target.value))} />
                    <input
                      className="v"
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="∞"
                      value={maxPrice ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!raw) return setMaxPrice(null);
                        const n = Number(raw);
                        setMaxPrice(Number.isFinite(n) ? n : null);
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="cc-field">
                <div className="k">Volume</div>
                {filtersMode === "slider" ? (
                  <div className="cc-slider">
                    <div className="cc-slider-head">
                      <div className="cc-slider-val">{`${fmtStep(VOL_STEPS[sliderVolMinIdx], "vol")}–${fmtStep(VOL_STEPS[sliderVolMaxIdx], "vol")}`}</div>
                    </div>
                    <div className="cc-slider-rails" role="group" aria-label="Volume range">
                      <input
                        className="cc-slider-min"
                        type="range"
                        min={0}
                        max={VOL_STEPS.length - 1}
                        step={1}
                        value={sliderVolMinIdx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setSliderVolMinIdx(Math.min(next, sliderVolMaxIdx));
                        }}
                      />
                      <input
                        className="cc-slider-max"
                        type="range"
                        min={0}
                        max={VOL_STEPS.length - 1}
                        step={1}
                        value={sliderVolMaxIdx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setSliderVolMaxIdx(Math.max(next, sliderVolMinIdx));
                        }}
                      />
                    </div>
                    <div className="cc-slider-ticks" aria-hidden="true">
                      {VOL_STEPS.map((n, i) => (
                        <div key={i} className={`cc-slider-tick ${i === 1 || i === 3 || i === 5 || i === 6 || i === VOL_STEPS.length - 1 ? "show" : ""}`}>
                          {fmtStep(n, "vol")}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="cc-range">
                    <input className="v" type="number" min={0} step={100} value={minVol} onChange={(e) => setMinVol(Number(e.target.value))} />
                    <input
                      className="v"
                      type="number"
                      min={0}
                      step={100}
                      placeholder="∞"
                      value={maxVol ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!raw) return setMaxVol(null);
                        const n = Number(raw);
                        setMaxVol(Number.isFinite(n) ? n : null);
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="cc-field">
                <div className="k">Chg% (abs)</div>
                {filtersMode === "slider" ? (
                  <div className="cc-slider">
                    <div className="cc-slider-head">
                      <div className="cc-slider-val">{`${fmtStep(PCT_STEPS[sliderPctMinIdx], "pct")}%–${fmtStep(PCT_STEPS[sliderPctMaxIdx], "pct")}%`}</div>
                    </div>
                    <div className="cc-slider-rails" role="group" aria-label="Percent change range">
                      <input
                        className="cc-slider-min"
                        type="range"
                        min={0}
                        max={PCT_STEPS.length - 1}
                        step={1}
                        value={sliderPctMinIdx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setSliderPctMinIdx(Math.min(next, sliderPctMaxIdx));
                        }}
                      />
                      <input
                        className="cc-slider-max"
                        type="range"
                        min={0}
                        max={PCT_STEPS.length - 1}
                        step={1}
                        value={sliderPctMaxIdx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setSliderPctMaxIdx(Math.max(next, sliderPctMinIdx));
                        }}
                      />
                    </div>
                    <div className="cc-slider-ticks" aria-hidden="true">
                      {PCT_STEPS.map((n, i) => (
                        <div key={i} className={`cc-slider-tick ${i === 0 || i === 2 || i === 4 || i === 6 || i === PCT_STEPS.length - 1 ? "show" : ""}`}>
                          {fmtStep(n, "pct")}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="cc-range">
                    <input className="v" type="number" min={0} step={0.5} value={minPct} onChange={(e) => setMinPct(Number(e.target.value))} />
                    <input
                      className="v"
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="∞"
                      value={maxPct ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!raw) return setMaxPct(null);
                        const n = Number(raw);
                        setMaxPct(Number.isFinite(n) ? n : null);
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="cc-field">
                <div className="k">Market cap</div>
                {filtersMode === "slider" ? (
                  <div className="cc-slider">
                    <div className="cc-slider-head">
                      <div className="cc-slider-val">{`${fmtStep(CAP_STEPS[sliderCapMinIdx], "cap")}–${fmtStep(CAP_STEPS[sliderCapMaxIdx], "cap")}`}</div>
                    </div>
                    <div className="cc-slider-rails" role="group" aria-label="Market cap range">
                      <input
                        className="cc-slider-min"
                        type="range"
                        min={0}
                        max={CAP_STEPS.length - 1}
                        step={1}
                        value={sliderCapMinIdx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setSliderCapMinIdx(Math.min(next, sliderCapMaxIdx));
                        }}
                      />
                      <input
                        className="cc-slider-max"
                        type="range"
                        min={0}
                        max={CAP_STEPS.length - 1}
                        step={1}
                        value={sliderCapMaxIdx}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setSliderCapMaxIdx(Math.max(next, sliderCapMinIdx));
                        }}
                      />
                    </div>
                    <div className="cc-slider-ticks" aria-hidden="true">
                      {CAP_STEPS.map((n, i) => (
                        <div key={i} className={`cc-slider-tick ${i === 0 || i === 1 || i === 3 || i === 5 || i === CAP_STEPS.length - 1 ? "show" : ""}`}>
                          {fmtStep(n, "cap")}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="cc-range">
                    <input className="v" type="number" min={0} step={1_000_000} value={minCap} onChange={(e) => setMinCap(Number(e.target.value))} />
                    <input
                      className="v"
                      type="number"
                      min={0}
                      step={1_000_000}
                      placeholder="∞"
                      value={maxCap ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (!raw) return setMaxCap(null);
                        const n = Number(raw);
                        setMaxCap(Number.isFinite(n) ? n : null);
                      }}
                    />
                  </div>
                )}
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
            </div>

            <div className="cc-filter-foot">
              <button
                type="button"
                className="cc-btn"
                title="Reset all filters to defaults"
                onClick={() => {
                  setMinPrice(1);
                  setMaxPrice(null);
                  setMinPct(5);
                  setMaxPct(null);
                  setMinVol(1000);
                  setMaxVol(null);
                  setMinCap(0);
                  setMaxCap(200_000_000);
                  setMaxRows(12);
                }}
              >
                reset
              </button>
              <button type="button" className="cc-btn active" title="Collapse filters panel" onClick={() => setFiltersExpanded(false)}>
                collapse
              </button>
            </div>
          </div>
        )}

        {columnsExpanded && (
          <div className="cc-filter-panel" aria-label="Watchlist columns panel">
            <div className="cc-filter-grid">
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
                          title={isOn ? "Hide this column" : "Show this column"}
                        onClick={() => {
                          setColumns((prev) => {
                            if (prev.includes(c.key)) {
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
                          title="Move column left"
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
                          title="Move column right"
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
            </div>

            <div className="cc-filter-foot">
              <button type="button" className="cc-btn" onClick={() => setColumns(DEFAULT_COLUMNS)}>
                reset
              </button>
              <button type="button" className="cc-btn active" onClick={() => setColumnsExpanded(false)}>
                collapse
              </button>
            </div>
          </div>
        )}

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
            <div className="cc-table-wrap" aria-label="Watchlist table scroll region">
              <table className="cc-table" style={{ minWidth: watchlistMinWidth }}>
                <thead>
                  <tr>
                    {columns.includes("rank") && <th style={{ width: 44 }}>#</th>}
                    {columns.includes("ticker") && <th style={{ width: 248 }}>Ticker</th>}
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
                    const inMyList = savedWatchlist.includes(g.ticker);
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
                          setChartTicker(g.ticker);
                          setSelected(g.ticker);
                          setWatchlistDrawerOpen(false);
                          setDrawerOpen(true);
                        }}
                        style={{
                          cursor: "pointer",
                          background: isActive ? "rgba(10, 143, 84, 0.10)" : "transparent",
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
                            title={isPinned ? "Unpin ticker (keeps it at top)" : "Pin ticker (keeps it at top)"}
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePin(g.ticker);
                              }}
                            >
                              {isPinned ? "★" : "☆"}
                            </button>
                            <button
                              type="button"
                              className={`cc-star cc-mylist ${inMyList ? "on" : ""}`}
                              aria-label={inMyList ? "Remove from My list" : "Add to My list"}
                              title={inMyList ? "Remove from My list" : "Add to My list (saved in this browser)"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSavedWatchlistTicker(g.ticker);
                              }}
                            >
                              {inMyList ? "✓" : "+"}
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
            </div>
          )}
        </div>
        </section>

        {/* Strategies watchlist */}
        <section className="cc-card" aria-label="Strategy watchlists">
          <div className="cc-card-head">
            <div>
              strategies · scans
            </div>
            <div className="cc-seg" role="group" aria-label="Strategy selection">
              {strategyScans.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`cc-seg-btn ${selectedStrategyId === s.id ? "active" : ""}`}
                  onClick={() => setSelectedStrategyId(s.id)}
                  title={s.criteria}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>

          <div style={{ padding: "10px 12px" }}>
            {!selectedStrategy ? (
              <div style={{ color: "var(--cc-dim)", fontFamily: "var(--font-micro)", textTransform: "uppercase", letterSpacing: 1.6 }}>
                No strategy matches yet.
              </div>
            ) : (
              <>
                <div className="cc-strategy-head" style={{ marginBottom: 10 }}>
                  <div className="t">{selectedStrategy.title}</div>
                  <div className="m">{selectedStrategy.criteria}</div>
                </div>
                <div className="cc-table-wrap" aria-label="Strategy watchlist scroll region">
                  <table className="cc-table cc-table--mini">
                    <thead>
                      <tr>
                        <th style={{ width: 236 }}>Ticker</th>
                        <th style={{ width: 70, textAlign: "right" }}>Last</th>
                        <th style={{ width: 70, textAlign: "right" }}>%</th>
                        <th style={{ width: 90, textAlign: "right" }}>Vol</th>
                        <th style={{ width: 90, textAlign: "right" }}>$Vol</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedStrategy.rows.map((r) => {
                        const inMyList = savedWatchlist.includes(r.ticker);
                        return (
                        <tr
                          key={`${selectedStrategy.id}-${r.ticker}`}
                          onClick={() => {
                            setChartTicker(r.ticker);
                            setSelected(r.ticker);
                            setWatchlistDrawerOpen(false);
                            setDrawerOpen(true);
                          }}
                          style={{ cursor: "pointer" }}
                        >
                          <td>
                            <div className="cc-ticker-row">
                              <div className="ticker">{r.ticker}</div>
                              <div className="cc-co" title={r.companyName ?? ""}>
                                {r.companyName ?? "—"}
                              </div>
                              <button
                                type="button"
                                className={`cc-star cc-mylist ${inMyList ? "on" : ""}`}
                                aria-label={inMyList ? "Remove from My list" : "Add to My list"}
                                title={inMyList ? "Remove from My list" : "Add to My list (saved in this browser)"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSavedWatchlistTicker(r.ticker);
                                }}
                              >
                                {inMyList ? "✓" : "+"}
                              </button>
                            </div>
                          </td>
                          <td style={{ textAlign: "right" }}>{fmtMoney(r.day?.c ?? NaN)}</td>
                          <td style={{ textAlign: "right", color: "var(--cc-amber)" }}>{fmtPct(r.todaysChangePerc)}</td>
                          <td style={{ textAlign: "right" }}>{fmtInt(r.day?.v ?? NaN)}</td>
                          <td style={{ textAlign: "right" }}>{fmtDollarVol(r.day?.c ?? NaN, r.day?.v ?? NaN)}</td>
                        </tr>
                      );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <div className="cc-right-rail" aria-label="Right column">
      {/* Right — live streams */}
      <aside className="cc-card cc-bloomberg" aria-label="Live video streams">
        <div className="cc-card-head">
          <div>
            live · streams
          </div>
          <div style={{ color: "var(--cc-faint)" }}>stream</div>
        </div>
        <div style={{ padding: 12 }}>
          <div className="cc-stream-player">
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
            <div className="cc-stream-label">Bloomberg TV</div>
          </div>

          <div className="cc-stream-player">
            <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", border: "1px solid rgba(246,242,233,0.10)" }}>
              <iframe
                title="CNBC live"
                src="https://www.youtube.com/embed/live_stream?channel=UCvJJ_dzjViJCoLf5uKUTwoA"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            </div>
            <div className="cc-stream-label">CNBC</div>
          </div>

          <div className="cc-stream-player">
            <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", border: "1px solid rgba(246,242,233,0.10)" }}>
              <iframe
                title="Zendoo live"
                src="https://www.youtube.com/embed/afM_VvLwaPY?si=pPunxEJzEGJagQQg"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            </div>
            <div className="cc-stream-label">Zendoo</div>
          </div>

          <div style={{ marginTop: 10, color: "var(--cc-dim)", fontFamily: "var(--font-micro)", fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase" }}>
            If this embed is blocked, open Bloomberg in a new tab.
          </div>
        </div>
      </aside>

      <div className="cc-right-stack" aria-label="Right column stack">
        {/* Right — SEC filings (placeholder) */}
        <section className="cc-card cc-sec" aria-label="SEC filings">
          <div className="cc-card-head">
            <div>
              sec · filings
            </div>
            <div className="cc-head-actions">
              <div className="cc-seg" role="group" aria-label="SEC filters">
                <button type="button" className={`cc-seg-btn ${secTab === "all" ? "active" : ""}`} onClick={() => setSecTab("all")}>
                  All
                </button>
                <button type="button" className={`cc-seg-btn ${secTab === "dilution" ? "active" : ""}`} onClick={() => setSecTab("dilution")}>
                  Dilution only
                </button>
                <button type="button" className={`cc-seg-btn ${secTab === "insider" ? "active" : ""}`} onClick={() => setSecTab("insider")}>
                  Insider (Form 4)
                </button>
              </div>
            </div>
          </div>

          <div className="cc-sec-body" style={{ padding: 12 }}>
            {secStatus === "loading" ? (
              <div className="cc-sec-note">Loading filings…</div>
            ) : secItems.length === 0 ? (
              <div className="cc-sec-note">No filings found for this symbol.</div>
            ) : (
              (() => {
                const dilutionForms = new Set(["S-1", "S-3", "S-8", "424B1", "424B2", "424B3", "424B4", "424B5", "424B7", "424B8", "424B", "F-1", "F-3", "F-4", "F-6"]);
                const insiderForms = new Set(["4", "4/A", "5", "5/A"]);
                const filtered = secItems.filter((it) => {
                  const f = String(it.form ?? "").trim().toUpperCase();
                  if (!f) return secTab === "all";
                  if (secTab === "dilution") return dilutionForms.has(f);
                  if (secTab === "insider") return insiderForms.has(f);
                  return true;
                });

                const byYear = new Map<string, FinnhubFiling[]>();
                for (const it of filtered) {
                  const d = it.filedDate || it.reportDate || "";
                  const y = d && /^\d{4}/.test(d) ? d.slice(0, 4) : "—";
                  const arr = byYear.get(y) ?? [];
                  arr.push(it);
                  byYear.set(y, arr);
                }
                const years = Array.from(byYear.keys()).sort((a, b) => (a === "—" ? 1 : b === "—" ? -1 : Number(b) - Number(a)));

                return years.slice(0, 3).map((year) => {
                  const rows = byYear.get(year) ?? [];
                  return (
                    <div key={year} className="cc-sec-year">
                      <div className="cc-sec-year-title">{year}</div>
                      <div className="cc-sec-list">
                        {rows.slice(0, 8).map((r, idx) => {
                          const filed = r.filedDate || r.reportDate || "";
                          const form = (r.form || "").toUpperCase();
                          const label = `${form || "—"}${filed ? ` — ${filed}` : ""}`;
                          const href = r.url || edgarSearchUrl(chartTicker || "", form, filed || undefined);
                          return (
                            <div key={`${r.id ?? ""}:${idx}`} className="cc-sec-row">
                              <div className="cc-sec-label" title={r.description ?? ""}>
                                {label}
                              </div>
                              <a className="cc-sec-view" href={href} target="_blank" rel="noreferrer noopener">
                                View
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })()
            )}
          </div>
        </section>

        {/* Right — Company info */}
        <section className="cc-card cc-info" aria-label="Company information">
          <div className="cc-card-head">
            <div>
              company · ratios
            </div>
            <div style={{ color: "var(--cc-faint)" }}>{chartTicker ?? "—"}</div>
          </div>
          <div className="cc-fund" aria-label="Company snapshot">
          <div className="cc-fund-head">
            <div className="cc-fund-sub">
              {chartKpi.companyName
                ? chartKpi.companyName
                : fhCompanyName
                  ? fhCompanyName
                  : fhStatus === "loading" || chartRemoteStatus === "loading"
                    ? "loading…"
                    : chartRemoteStatus === "error" && fhStatus === "error"
                      ? "not found"
                      : "—"}
            </div>
          </div>
          <div className="cc-fund-grid">
            <div className="cc-fund-block" aria-label="Company and industry">
              <div className="cc-fund-block-title">Company &amp; industry</div>
              <div className="cc-fund-rows">
                <div className="cc-fund-row">
                  <div className="k">Market cap</div>
                  <div className="v">{fmtCap(chartKpi.cap)}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Last</div>
                  <div className="v">{fmtMoney(chartKpi.last)}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Prev close</div>
                  <div className="v">{fmtMoney(chartKpi.prev)}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Day range</div>
                  <div className="v">
                    {fmtMoney(chartKpi.rangeLo)}–{fmtMoney(chartKpi.rangeHi)}
                  </div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">VWAP</div>
                  <div className="v">{fmtMoney(chartKpi.vwap)}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Volume</div>
                  <div className="v">{fmtInt(chartKpi.vol)}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">$Vol</div>
                  <div className="v">{fmtDollarVol(chartKpi.last, chartKpi.vol)}</div>
                </div>
              </div>
            </div>

            <div className="cc-fund-block" aria-label="Key ratios">
              <div className="cc-fund-block-title">Key ratios</div>
              <div className="cc-fund-rows">
                <div className="cc-fund-row">
                  <div className="k">Chg% (abs)</div>
                  <div className="v">{Number.isFinite(chartKpi.chgPctAbs) ? `${chartKpi.chgPctAbs.toFixed(2)}%` : "—"}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">P/E (TTM)</div>
                  <div className="v">{fhNum("peTTM") !== null ? String(fhNum("peTTM")!.toFixed(2)) : "—"}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">P/E (Forward)</div>
                  <div className="v">{fhNum("peForward") !== null ? String(fhNum("peForward")!.toFixed(2)) : "—"}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">P/S (TTM)</div>
                  <div className="v">{fhNum("psTTM") !== null ? String(fhNum("psTTM")!.toFixed(2)) : "—"}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">EV/EBITDA</div>
                  <div className="v">{fhNum("evEbitdaTTM") !== null ? String(fhNum("evEbitdaTTM")!.toFixed(2)) : "—"}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Current ratio</div>
                  <div className="v">{fhNum("currentRatioAnnual") !== null ? String(fhNum("currentRatioAnnual")!.toFixed(2)) : "—"}</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Dividend yield</div>
                  <div className="v">
                    {fhNum("dividendYieldIndicatedAnnual") !== null ? `${fhNum("dividendYieldIndicatedAnnual")!.toFixed(2)}%` : "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="cc-fund-block" aria-label="Earnings">
              <div className="cc-fund-block-title">
                Earnings <span className="cc-fund-more">more</span>
              </div>
              <div className="cc-fund-rows">
                <div className="cc-fund-row">
                  <div className="k">Revenue</div>
                  <div className="v">—</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Gross margin</div>
                  <div className="v">—</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Net income</div>
                  <div className="v">—</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">EPS</div>
                  <div className="v">
                    {fhNum("epsTTM") !== null ? fhNum("epsTTM")!.toFixed(2) : fhEarnings?.[0]?.actual != null ? Number(fhEarnings[0].actual).toFixed(2) : "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="cc-fund-block" aria-label="Balance sheet">
              <div className="cc-fund-block-title">
                Balance sheet <span className="cc-fund-more">more</span>
              </div>
              <div className="cc-fund-rows">
                <div className="cc-fund-row">
                  <div className="k">Cash</div>
                  <div className="v">—</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Total assets</div>
                  <div className="v">—</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Total liabilities</div>
                  <div className="v">—</div>
                </div>
                <div className="cc-fund-row">
                  <div className="k">Long-term debt</div>
                  <div className="v">—</div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </section>
      </div>
      </div>

      {/* My list — left drawer (persisted tickers, separate from ★ pin sort) */}
      {watchlistDrawerOpen && (
        <div
          className="cc-drawer-overlay cc-drawer-overlay--left"
          role="button"
          aria-label="Close my list"
          tabIndex={0}
          onClick={() => setWatchlistDrawerOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setWatchlistDrawerOpen(false);
          }}
        >
          <aside
            className="cc-drawer cc-drawer--left"
            role="dialog"
            aria-label="My saved watchlist"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="cc-drawer-head">
              <div>
                <div className="cc-drawer-kicker">watchlist</div>
                <div className="cc-drawer-title">My list</div>
              </div>
              <button type="button" className="cc-btn" onClick={() => setWatchlistDrawerOpen(false)}>
                close
              </button>
            </div>

            <div className="cc-drawer-body">
              <form
                className="cc-watchlist-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  addSavedWatchlistTicker(watchlistInput);
                  setWatchlistInput("");
                }}
              >
                <input
                  className="cc-ticker-input"
                  value={watchlistInput}
                  onChange={(e) => setWatchlistInput(e.target.value)}
                  placeholder="Ticker"
                  inputMode="text"
                  aria-label="Ticker to add to my list"
                />
                <button type="submit" className="cc-btn" title="Add ticker to saved list">
                  add
                </button>
              </form>

              {savedWatchlist.length === 0 ? (
                <div className="cc-drawer-muted" style={{ marginTop: 16 }}>
                  No tickers yet. Add symbols above — stored in this browser only (localStorage).
                </div>
              ) : (
                <div className="cc-table-wrap" style={{ marginTop: 14 }} aria-label="Saved tickers">
                  <table className="cc-table cc-table--mini">
                    <thead>
                      <tr>
                        <th style={{ width: 200 }}>Ticker</th>
                        <th style={{ width: 76, textAlign: "right" }}>Last</th>
                        <th style={{ width: 76, textAlign: "right" }}>%</th>
                        <th style={{ width: 148 }} aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {savedWatchlist.map((sym) => {
                        const row = watchlistRows[sym];
                        const last = row?.day?.c ?? NaN;
                        return (
                          <tr
                            key={sym}
                            style={{ cursor: "pointer" }}
                            onClick={() => {
                              applyChartTicker(sym);
                              setSelected(sym);
                              setWatchlistDrawerOpen(false);
                            }}
                            title="Load this symbol in the chart (close My list to see it)"
                          >
                            <td>
                              <div className="cc-ticker-row">
                                <div className="ticker">{sym}</div>
                                <div className="cc-co" title={row?.companyName ?? ""}>
                                  {row?.companyName ?? "—"}
                                </div>
                              </div>
                            </td>
                            <td style={{ textAlign: "right" }}>{fmtMoney(last)}</td>
                            <td style={{ textAlign: "right", color: "var(--cc-amber)" }}>{fmtPct(row?.todaysChangePerc ?? NaN)}</td>
                            <td>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "flex-end" }}>
                                <button
                                  type="button"
                                  className="cc-btn"
                                  title="Open details drawer (news, metrics)"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    applyChartTicker(sym);
                                    setSelected(sym);
                                    setWatchlistDrawerOpen(false);
                                    setDrawerOpen(true);
                                  }}
                                >
                                  details
                                </button>
                                <button
                                  type="button"
                                  className="cc-btn"
                                  title="Remove from my list"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeSavedWatchlistTicker(sym);
                                  }}
                                >
                                  remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="cc-drawer-muted" style={{ marginTop: 14, fontSize: 11, lineHeight: 1.45 }}>
                Row click loads the symbol into the chart and closes this panel so you can see it. Use{" "}
                <strong style={{ color: "var(--cc-text)" }}>details</strong> for the side drawer (news, metrics). ★ Pin only
                affects sort in the scanner table.
              </div>
            </div>
          </aside>
        </div>
      )}

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
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                {selectedRow?.ticker && (
                  <button
                    type="button"
                    className={`cc-btn ${pinned.includes(selectedRow.ticker) ? "active" : ""}`}
                    onClick={() => togglePin(selectedRow.ticker)}
                  >
                    {pinned.includes(selectedRow.ticker) ? "pinned" : "pin"}
                  </button>
                )}
                {selectedRow?.ticker && (
                  <button
                    type="button"
                    className={`cc-btn ${savedWatchlist.includes(selectedRow.ticker) ? "active" : ""}`}
                    onClick={() => toggleSavedWatchlistTicker(selectedRow.ticker)}
                    title="Add or remove this ticker from My list (saved in browser)"
                  >
                    {savedWatchlist.includes(selectedRow.ticker) ? "in list" : "add to list"}
                  </button>
                )}
                {(selectedRow?.ticker || selected) && (
                  <button
                    type="button"
                    className="cc-btn"
                    disabled={researchStatus === "loading"}
                    title="Refresh Research (bypass cache)"
                    onClick={() => loadResearch(selectedRow?.ticker ?? selected ?? "", { force: true })}
                  >
                    {researchStatus === "loading" ? "loading…" : "refresh research"}
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
                <div className="cc-drawer-section-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span>Research</span>
                  <span style={{ color: "var(--cc-faint)", fontFamily: "var(--font-micro)", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase" }}>
                    {researchCachedAt ? `cached ${relTime(researchCachedAt)}` : ""}
                  </span>
                </div>

                {researchStatus === "loading" ? (
                  <div className="cc-drawer-muted">Loading research…</div>
                ) : researchStatus === "error" ? (
                  <div className="cc-drawer-muted" style={{ color: "var(--cc-amber)" }}>
                    Research not available{researchError ? ` · ${researchError}` : ""}.
                  </div>
                ) : !researchBrief ? (
                  <div className="cc-drawer-muted">No research loaded for this ticker yet.</div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {researchBrief.market && (
                      <div>
                        <div className="cc-drawer-muted" style={{ marginBottom: 6 }}>
                          Market data
                          {(researchBrief.market.hqLocation || researchBrief.market.sicDescription) && (
                            <span style={{ marginLeft: 10 }}>
                              {researchBrief.market.hqLocation ? `HQ: ${researchBrief.market.hqLocation}` : ""}
                              {researchBrief.market.hqLocation && researchBrief.market.sicDescription ? " · " : ""}
                              {researchBrief.market.sicDescription ? researchBrief.market.sicDescription : ""}
                            </span>
                          )}
                        </div>
                        <div className="cc-metrics" style={{ marginTop: 0 }}>
                          <div className="cc-metric">
                            <div className="k">Price</div>
                            <div className="v">{researchBrief.market.price != null ? `$${researchBrief.market.price.toFixed(2)}` : "—"}</div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">Change</div>
                            <div className="v" style={{ color: (researchBrief.market.todayChangePct ?? 0) >= 0 ? "var(--cc-amber)" : "var(--cc-text)" }}>
                              {researchBrief.market.todayChange != null ? `${researchBrief.market.todayChange >= 0 ? "+" : ""}$${researchBrief.market.todayChange.toFixed(2)}` : "—"} (
                              {fmtPctSigned(researchBrief.market.todayChangePct)})
                            </div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">Mkt cap</div>
                            <div className="v">{fmtDollarsShort(researchBrief.market.marketCap)}</div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">Float</div>
                            <div className="v">{fmtSharesShort(researchBrief.market.float)}</div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">Volume</div>
                            <div className="v">{fmtSharesShort(researchBrief.market.volume)}</div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">52w</div>
                            <div className="v">
                              {researchBrief.market.low52w != null ? `$${researchBrief.market.low52w.toFixed(2)}` : "—"}–{researchBrief.market.high52w != null ? `$${researchBrief.market.high52w.toFixed(2)}` : "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {researchBrief.fundamentals && (
                      <div>
                        <div className="cc-drawer-muted" style={{ marginBottom: 6 }}>
                          Fundamentals{" "}
                          <span style={{ color: "var(--cc-faint)" }}>
                            (EDGAR — {researchBrief.fundamentals.form || "?"} filed {researchBrief.fundamentals.filingDate || "?"})
                          </span>
                        </div>
                        <div className="cc-metrics" style={{ marginTop: 0 }}>
                          <div className="cc-metric">
                            <div className="k">Cash</div>
                            <div className="v">{fmtDollarsShort(researchBrief.fundamentals.cashOnHand)}</div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">Revenue</div>
                            <div className="v">{fmtDollarsShort(researchBrief.fundamentals.revenue)}</div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">Net inc</div>
                            <div className="v">{fmtDollarsShort(researchBrief.fundamentals.netIncome)}</div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">Going concern</div>
                            <div className="v" style={{ color: researchBrief.fundamentals.goingConcern ? "var(--cc-amber)" : "var(--cc-dim)" }}>
                              {researchBrief.fundamentals.goingConcern == null ? "—" : researchBrief.fundamentals.goingConcern ? "YES" : "No"}
                            </div>
                          </div>
                          <div className="cc-metric">
                            <div className="k">Shelf (S-3)</div>
                            <div className="v">{researchBrief.fundamentals.hasShelfRegistration ? `Yes (${researchBrief.fundamentals.shelfFilingDate || "?"})` : "None"}</div>
                          </div>
                        </div>

                        {researchBrief.fundamentals.liquidityExcerpt && (
                          <details style={{ marginTop: 10 }}>
                            <summary className="cc-drawer-muted" style={{ cursor: "pointer" }}>
                              Liquidity &amp; capital resources
                            </summary>
                            <div style={{ marginTop: 8, fontFamily: "var(--font-micro)", fontSize: 16, color: "var(--cc-dim)", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                              {researchBrief.fundamentals.liquidityExcerpt.slice(0, 2000)}
                            </div>
                          </details>
                        )}
                      </div>
                    )}

                    {researchBrief.news && (
                      <div>
                        <div className="cc-drawer-muted" style={{ marginBottom: 6 }}>
                          News &amp; catalyst
                        </div>
                        {researchBrief.news.perplexitySummary ? (
                          <div style={{ fontFamily: "var(--font-micro)", fontSize: 16, color: "var(--cc-text)", lineHeight: 1.65, whiteSpace: "pre-line" }}>
                            {cleanBriefText(researchBrief.news.perplexitySummary)}
                          </div>
                        ) : (
                          <div className="cc-drawer-muted">No summary available.</div>
                        )}

                        {researchBrief.news.exaResults?.length ? (
                          <div style={{ marginTop: 10 }}>
                            <div className="cc-drawer-muted" style={{ marginBottom: 6 }}>
                              Sources
                            </div>
                            <div style={{ display: "grid", gap: 6 }}>
                              {researchBrief.news.exaResults.slice(0, 10).map((r, i) => (
                                <a
                                  key={`${r.url}:${i}`}
                                  href={r.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  style={{
                                    fontFamily: "var(--font-micro)",
                                    fontSize: 15,
                                    letterSpacing: 0.2,
                                    textTransform: "none",
                                    color: "var(--cc-amber)",
                                    textDecoration: "none",
                                    lineHeight: 1.4,
                                  }}
                                  title={r.title || r.url}
                                >
                                  [{i + 1}] {r.title || r.url}
                                </a>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="cc-drawer-section">
                <div className="cc-drawer-section-head">News</div>
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

