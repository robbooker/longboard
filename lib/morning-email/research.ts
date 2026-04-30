import { fetchPolygonNews } from "./polygon";
import { synthesizeStock, deterministicSynth } from "./openai";
import type { MorningEmailStock, QaMessage, ResearchSource } from "./types";

const SOURCE_TIMEOUT_MS = 9_000;
const SEC_LOOKBACK_DAYS = 14;
const EXA_LOOKBACK_DAYS = 3;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchBenzingaNews(ticker: string): Promise<ResearchSource[]> {
  const key = process.env.BENZINGA_API_KEY;
  if (!key) return [];
  try {
    const url = `https://api.benzinga.com/api/v2/news?token=${encodeURIComponent(key)}&tickers=${encodeURIComponent(ticker)}&pageSize=10&displayOutput=full`;
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" }, cache: "no-store" }, SOURCE_TIMEOUT_MS);
    if (!res.ok) return [];
    const data = await res.json();
    const items: unknown[] = Array.isArray(data) ? data : Array.isArray((data as { data?: unknown[] }).data) ? (data as { data: unknown[] }).data : [];
    return items.slice(0, 5).map((raw): ResearchSource => {
      const it = raw as Record<string, unknown>;
      const title = typeof it.title === "string" ? it.title : "";
      const body = typeof it.body === "string" ? it.body : (typeof it.teaser === "string" ? it.teaser : "");
      return {
        source: "Benzinga",
        title,
        text: stripHtml(body).slice(0, 800),
        url: typeof it.url === "string" ? it.url : undefined,
        publishedAt: typeof it.created === "string" ? it.created : (typeof it.updated === "string" ? it.updated : undefined),
      };
    });
  } catch {
    return [];
  }
}

let cikCache: Map<string, string> | null = null;

async function loadCikCache(ua: string): Promise<Map<string, string>> {
  if (cikCache) return cikCache;
  const res = await fetchWithTimeout(
    "https://www.sec.gov/files/company_tickers.json",
    { headers: { "User-Agent": ua, Accept: "application/json" }, cache: "no-store" },
    SOURCE_TIMEOUT_MS,
  );
  if (!res.ok) {
    cikCache = new Map();
    return cikCache;
  }
  const data = await res.json() as Record<string, { ticker?: string; cik_str?: number }>;
  const m = new Map<string, string>();
  for (const v of Object.values(data)) {
    if (v && typeof v.ticker === "string" && typeof v.cik_str === "number") {
      m.set(v.ticker.toUpperCase(), String(v.cik_str).padStart(10, "0"));
    }
  }
  cikCache = m;
  return cikCache;
}

async function fetchSecRecentFilings(ticker: string): Promise<ResearchSource[]> {
  const ua = process.env.SEC_USER_AGENT;
  if (!ua) return [];
  try {
    const cikMap = await loadCikCache(ua);
    const cik = cikMap.get(ticker.toUpperCase());
    if (!cik) return [];

    const res = await fetchWithTimeout(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers: { "User-Agent": ua, Accept: "application/json" }, cache: "no-store" },
      SOURCE_TIMEOUT_MS,
    );
    if (!res.ok) return [];
    const data = await res.json() as { filings?: { recent?: Record<string, string[] | undefined> } };
    const recent = data.filings?.recent;
    if (!recent || !Array.isArray(recent.form)) return [];

    const cutoff = Date.now() - SEC_LOOKBACK_DAYS * 86_400_000;
    const out: ResearchSource[] = [];
    const cikInt = parseInt(cik, 10);

    for (let i = 0; i < recent.form.length; i++) {
      const form = recent.form[i] || "";
      const dateStr = recent.filingDate?.[i] || "";
      const accNo = (recent.accessionNumber?.[i] || "").replace(/-/g, "");
      const primaryDoc = recent.primaryDocument?.[i] || "";
      const desc = recent.primaryDocDescription?.[i] || "";
      const t = Date.parse(dateStr);
      if (isNaN(t) || t < cutoff) continue;
      const matches = form === "8-K" || form === "6-K" || form === "S-1" || form === "S-3" || form === "10-Q" || form.startsWith("424B");
      if (!matches) continue;
      out.push({
        source: "SEC EDGAR",
        title: `${form}${desc ? ` — ${desc}` : ""}`,
        text: `Form ${form} filed ${dateStr}${desc ? ` (${desc})` : ""}.`,
        url: accNo && primaryDoc ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNo}/${primaryDoc}` : undefined,
        publishedAt: dateStr,
      });
      if (out.length >= 5) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchExaWeb(ticker: string, name: string): Promise<ResearchSource[]> {
  const key = process.env.EXA_API_KEY;
  if (!key) return [];
  try {
    const since = new Date(Date.now() - EXA_LOOKBACK_DAYS * 86_400_000).toISOString();
    const res = await fetchWithTimeout("https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `${ticker} ${name} stock news catalyst why moving today`.trim(),
        numResults: 5,
        startPublishedDate: since,
        contents: { text: { maxCharacters: 800 } },
        useAutoprompt: false,
      }),
      cache: "no-store",
    }, SOURCE_TIMEOUT_MS);
    if (!res.ok) return [];
    const data = await res.json() as { results?: Array<{ title?: string; url?: string; text?: string; publishedDate?: string }> };
    return (data.results ?? []).slice(0, 5).map((r): ResearchSource => ({
      source: "Exa Web",
      title: r.title ?? "",
      text: (r.text ?? "").slice(0, 800),
      url: r.url,
      publishedAt: r.publishedDate,
    }));
  } catch {
    return [];
  }
}

async function fetchXSentiment(ticker: string): Promise<ResearchSource[]> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return [];
  try {
    const q = `$${ticker} -is:retweet lang:en`;
    const url = `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(q)}&max_results=10&tweet.fields=created_at`;
    const res = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }, SOURCE_TIMEOUT_MS);
    if (!res.ok) return [];
    const data = await res.json() as { data?: Array<{ id?: string; text?: string; created_at?: string }> };
    return (data.data ?? []).slice(0, 8).map((t): ResearchSource => ({
      source: "X Recent Search",
      title: t.text ? t.text.slice(0, 80) : "(tweet)",
      text: t.text ?? "",
      url: t.id ? `https://x.com/i/status/${t.id}` : undefined,
      publishedAt: t.created_at,
    }));
  } catch {
    return [];
  }
}

function dedupeAndFilter(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  const out: ResearchSource[] = [];
  for (const s of sources) {
    const key = (s.url || s.title).trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = (s.title || "").trim();
    const text = (s.text || "").trim();
    if (title.length < 6 && text.length < 12) continue;
    out.push(s);
  }
  return out;
}

function dedupeUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.filter((u): u is string => typeof u === "string" && u.length > 0)));
}

export type EnrichResult = {
  stocks: MorningEmailStock[];
  qa: QaMessage[];
};

export async function enrichStocks(stocks: MorningEmailStock[]): Promise<EnrichResult> {
  const qa: QaMessage[] = [];

  if (!process.env.BENZINGA_API_KEY) qa.push({ level: "warning", message: "Benzinga key missing — skipped Benzinga news for all tickers." });
  if (!process.env.SEC_USER_AGENT) qa.push({ level: "warning", message: "SEC user-agent missing — skipped SEC EDGAR for all tickers." });
  if (!process.env.EXA_API_KEY) qa.push({ level: "warning", message: "Exa key missing — skipped web search for all tickers." });
  if (!process.env.X_BEARER_TOKEN) qa.push({ level: "warning", message: "X bearer token missing — skipped sentiment feed for all tickers." });
  if (!process.env.OPENAI_API_KEY) qa.push({ level: "warning", message: "OpenAI key missing — using deterministic fallback synthesis for all tickers." });

  const enriched = await Promise.all(stocks.map(async (stock) => {
    const [poly, bz, sec, exa, xs] = await Promise.all([
      fetchPolygonNews(stock.ticker),
      fetchBenzingaNews(stock.ticker),
      fetchSecRecentFilings(stock.ticker),
      fetchExaWeb(stock.ticker, stock.name),
      fetchXSentiment(stock.ticker),
    ]);
    const evidence = dedupeAndFilter([...poly, ...bz, ...sec, ...exa, ...xs]);

    if (evidence.length === 0) {
      qa.push({ level: "warning", message: `${stock.ticker}: no evidence sources returned.` });
    }

    let synth = await synthesizeStock(stock, evidence);
    let usedFallback = false;
    if (!synth) {
      if (process.env.OPENAI_API_KEY) {
        qa.push({ level: "warning", message: `${stock.ticker}: OpenAI synthesis failed — using deterministic fallback.` });
      }
      synth = deterministicSynth(stock, evidence);
      usedFallback = true;
    }

    if (!usedFallback && synth.confidence === "Low") {
      qa.push({ level: "warning", message: `${stock.ticker}: synthesis returned Low confidence.` });
    }

    return {
      ...stock,
      catalyst: synth.catalyst.trim() ? [synth.catalyst.trim()] : [],
      sentiment: synth.sentiment,
      confidence: synth.confidence,
      risk_flags: synth.risk_flags,
      evidence_notes: synth.evidence_notes,
      source_urls: dedupeUrls(evidence.map((e) => e.url).filter((u): u is string => Boolean(u))),
      evidence,
    } satisfies MorningEmailStock;
  }));

  qa.push({ level: "ok", message: `Enriched ${enriched.length} ticker${enriched.length === 1 ? "" : "s"}.` });
  return { stocks: enriched, qa };
}
