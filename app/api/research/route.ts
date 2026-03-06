import { NextRequest, NextResponse } from "next/server";
import type {
  MarketData,
  Fundamentals,
  NewsData,
  ExaResult,
  ResearchBrief,
} from "@/types/research";

const POLYGON_BASE = "https://api.polygon.io";
const EDGAR_UA =
  "ScoutTrading/1.0 (+https://scout-trading.com; contact@scout-trading.com)";

// ── Layer 1: Market Data (Polygon) ──────────────────────────────

async function fetchMarketData(ticker: string): Promise<MarketData> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("POLYGON_API_KEY not configured");

  const [detailsRes, prevRes, snapshotRes] = await Promise.all([
    fetch(
      `${POLYGON_BASE}/v3/reference/tickers/${ticker}?apiKey=${apiKey}`,
      { cache: "no-store" }
    ),
    fetch(
      `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/prev?apiKey=${apiKey}`,
      { cache: "no-store" }
    ),
    fetch(
      `${POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers/${ticker}?apiKey=${apiKey}`,
      { cache: "no-store" }
    ),
  ]);

  const details = detailsRes.ok ? await detailsRes.json() : null;
  const prev = prevRes.ok ? await prevRes.json() : null;
  const snapshot = snapshotRes.ok ? await snapshotRes.json() : null;

  const d = details?.results;
  const p = prev?.results?.[0];
  const s = snapshot?.ticker;

  // Build HQ location from Polygon address
  let hqLocation: string | null = null;
  if (d?.address) {
    const parts = [d.address.city, d.address.state].filter(Boolean);
    hqLocation = parts.length > 0 ? parts.join(", ") : null;
  }

  return {
    companyName: d?.name ?? null,
    hqLocation,
    sicDescription: d?.sic_description ?? null,
    marketCap: d?.market_cap ?? null,
    float: d?.weighted_shares_outstanding ?? null,
    sharesOutstanding: d?.share_class_shares_outstanding ?? null,
    todayChange: s?.todaysChange ?? null,
    todayChangePct: s?.todaysChangePerc ?? null,
    price: s?.day?.c ?? p?.c ?? null,
    volume: s?.day?.v ?? null,
    prevClose: p?.c ?? s?.prevDay?.c ?? null,
    high52w: null,
    low52w: null,
  };
}

// ── Layer 2: Fundamentals (SEC EDGAR) ───────────────────────────

async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  // Step 1: Find CIK via EDGAR full-text search
  const searchRes = await fetch(
    `https://efts.sec.gov/LATEST/search-index?q=%22${ticker}%22&forms=10-K,10-Q,20-F&dateRange=custom&startdt=2023-01-01`,
    { headers: { "User-Agent": EDGAR_UA } }
  );

  if (!searchRes.ok) {
    const tickersRes = await fetch(
      "https://www.sec.gov/files/company_tickers.json",
      { headers: { "User-Agent": EDGAR_UA } }
    );
    if (!tickersRes.ok) throw new Error("EDGAR search failed");

    const tickersData = await tickersRes.json();
    const match = Object.values(tickersData).find(
      (entry: any) => entry.ticker?.toUpperCase() === ticker.toUpperCase()
    ) as any;

    if (!match) throw new Error(`No EDGAR CIK found for ${ticker}`);

    return await fetchEdgarByCik(match.cik_str.toString(), ticker);
  }

  const searchData = await searchRes.json();
  const hits = searchData?.hits?.hits;

  if (!hits || hits.length === 0) {
    const tickersRes = await fetch(
      "https://www.sec.gov/files/company_tickers.json",
      { headers: { "User-Agent": EDGAR_UA } }
    );
    if (!tickersRes.ok) throw new Error("EDGAR search failed");

    const tickersData = await tickersRes.json();
    const match = Object.values(tickersData).find(
      (entry: any) => entry.ticker?.toUpperCase() === ticker.toUpperCase()
    ) as any;

    if (!match) throw new Error(`No EDGAR CIK found for ${ticker}`);

    return await fetchEdgarByCik(match.cik_str.toString(), ticker);
  }

  const firstHit = hits[0]._source || hits[0];
  const cik =
    firstHit.entity_id?.replace("CIK", "") ||
    firstHit.ciks?.[0] ||
    null;

  if (!cik) throw new Error(`Could not extract CIK for ${ticker}`);

  return await fetchEdgarByCik(cik.toString(), ticker);
}

// Helper: get most recent value from XBRL companyfacts
function getLatestFact(
  facts: any,
  concept: string
): number | null {
  const fact = facts?.["us-gaap"]?.[concept];
  if (!fact) return null;
  const entries = fact.units?.USD;
  if (!entries || entries.length === 0) return null;
  // Sort by end date descending, pick most recent
  const sorted = [...entries]
    .filter((e: any) => e.form === "10-K" || e.form === "10-Q" || e.form === "20-F")
    .sort((a: any, b: any) => (b.end || "").localeCompare(a.end || ""));
  return sorted.length > 0 ? sorted[0].val : null;
}

async function fetchEdgarByCik(
  cik: string,
  ticker: string
): Promise<Fundamentals> {
  const paddedCik = cik.padStart(10, "0");

  // Fetch submissions and companyfacts in parallel
  const [subRes, factsRes] = await Promise.all([
    fetch(
      `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
      { headers: { "User-Agent": EDGAR_UA } }
    ),
    fetch(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`,
      { headers: { "User-Agent": EDGAR_UA } }
    ),
  ]);

  if (!subRes.ok) throw new Error(`EDGAR submissions failed for CIK ${cik}`);

  const subData = await subRes.json();
  const filings = subData.filings?.recent;

  if (!filings) throw new Error("No filings found");

  // Extract XBRL financial facts
  const factsData = factsRes.ok ? await factsRes.json() : null;
  const facts = factsData?.facts;
  const cashOnHand = getLatestFact(facts, "CashAndCashEquivalentsAtCarryingValue");
  const netIncome = getLatestFact(facts, "NetIncomeLoss");
  const revenue =
    getLatestFact(facts, "Revenues") ??
    getLatestFact(facts, "RevenueFromContractWithCustomerExcludingAssessedTax") ??
    getLatestFact(facts, "SalesRevenueNet");

  // Check for S-3 shelf registration
  let hasShelfRegistration = false;
  let shelfFilingDate: string | null = null;
  for (let i = 0; i < filings.form.length; i++) {
    if (filings.form[i] === "S-3" || filings.form[i] === "S-3/A") {
      hasShelfRegistration = true;
      shelfFilingDate = filings.filingDate[i];
      break;
    }
  }

  // Find most recent annual/quarterly filing
  let filingIdx = -1;
  const targetForms = ["10-K", "20-F", "10-Q"];
  for (let i = 0; i < filings.form.length; i++) {
    if (targetForms.includes(filings.form[i])) {
      filingIdx = i;
      break;
    }
  }

  if (filingIdx === -1) throw new Error("No 10-K/20-F/10-Q found");

  const form = filings.form[filingIdx];
  const filingDate = filings.filingDate[filingIdx];
  const accNo = filings.accessionNumber[filingIdx];
  const primaryDoc = filings.primaryDocument[filingIdx];
  const accNoClean = accNo.replace(/-/g, "");

  // Fetch filing and extract liquidity section
  const cikNum = parseInt(cik, 10).toString();
  const filingUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoClean}/${primaryDoc}`;
  const filingRes = await fetch(filingUrl, {
    headers: { "User-Agent": EDGAR_UA },
  });

  if (!filingRes.ok)
    return {
      form, filingDate, goingConcern: null, liquidityExcerpt: null,
      cashOnHand, revenue, netIncome, hasShelfRegistration, shelfFilingDate,
    };

  const filingHtml = await filingRes.text();

  // Strip HTML tags
  let text = filingHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/&#[0-9]+;|&[a-z]+;/g, " ")
    .replace(/\s+/g, " ");

  // Check for going concern
  const goingConcern =
    /going concern/i.test(text) &&
    /substantial doubt|ability to continue/i.test(text);

  // Extract liquidity section (skip TOC — use second occurrence)
  let liquidityExcerpt: string | null = null;
  const regex = /liquidity and capital resources/gi;
  const matches: number[] = [];
  let m;
  while ((m = regex.exec(text.toLowerCase())) !== null) {
    matches.push(m.index);
  }

  if (matches.length >= 2) {
    liquidityExcerpt = text.slice(matches[1], matches[1] + 3000).trim();
  } else if (matches.length === 1) {
    liquidityExcerpt = text.slice(matches[0], matches[0] + 3000).trim();
  }

  return {
    form, filingDate, goingConcern, liquidityExcerpt,
    cashOnHand, revenue, netIncome, hasShelfRegistration, shelfFilingDate,
  };
}

// ── Layer 3: News & Sentiment (Exa + Perplexity) ───────────────

async function fetchNews(ticker: string): Promise<NewsData> {
  const exaKey = process.env.EXA_API_KEY;
  const pplxKey = process.env.PERPLEXITY_API_KEY;

  const results: NewsData = { exaResults: [], perplexitySummary: null };

  const [exaResult, pplxResult] = await Promise.allSettled([
    exaKey
      ? fetch("https://api.exa.ai/search", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${exaKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: `${ticker} stock news catalyst today`,
            type: "neural",
            numResults: 5,
            contents: {
              highlights: { numSentences: 3, highlightsPerUrl: 2 },
            },
          }),
        }).then((r) => (r.ok ? r.json() : null))
      : Promise.resolve(null),

    pplxKey
      ? fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${pplxKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar-pro",
            messages: [
              {
                role: "user",
                content: `What is driving ${ticker} stock movement today? Summarize any news, press releases, catalysts from the last 48 hours. Be brief and factual. Use plain text, no markdown formatting.`,
              },
            ],
          }),
        }).then((r) => (r.ok ? r.json() : null))
      : Promise.resolve(null),
  ]);

  if (exaResult.status === "fulfilled" && exaResult.value?.results) {
    results.exaResults = exaResult.value.results.map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      highlights: r.highlights || [],
    }));
  }

  if (pplxResult.status === "fulfilled" && pplxResult.value) {
    results.perplexitySummary =
      pplxResult.value.choices?.[0]?.message?.content || null;
  }

  return results;
}

// ── Main handler ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const ticker = request.nextUrl.searchParams
    .get("ticker")
    ?.toUpperCase()
    .trim();

  if (!ticker) {
    return NextResponse.json(
      { error: "Missing ticker parameter" },
      { status: 400 }
    );
  }

  const errors: string[] = [];

  const [marketResult, fundResult, newsResult] = await Promise.allSettled([
    fetchMarketData(ticker),
    fetchFundamentals(ticker),
    fetchNews(ticker),
  ]);

  let market: MarketData | null = null;
  let fundamentals: Fundamentals | null = null;
  let news: NewsData | null = null;

  if (marketResult.status === "fulfilled") {
    market = marketResult.value;
  } else {
    errors.push(`Market data: ${marketResult.reason?.message || "failed"}`);
  }

  if (fundResult.status === "fulfilled") {
    fundamentals = fundResult.value;
  } else {
    errors.push(`Fundamentals: ${fundResult.reason?.message || "failed"}`);
  }

  if (newsResult.status === "fulfilled") {
    news = newsResult.value;
  } else {
    errors.push(`News: ${newsResult.reason?.message || "failed"}`);
  }

  const hasAnyData = market || fundamentals || news;

  const brief: ResearchBrief = {
    ticker,
    market,
    fundamentals,
    news,
    status: errors.length === 0 ? "complete" : hasAnyData ? "partial" : "error",
    errors,
    researchedAt: new Date().toISOString(),
  };

  return NextResponse.json(brief);
}
