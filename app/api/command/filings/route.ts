import { NextResponse, type NextRequest } from "next/server";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const SEC_SUBMISSIONS = "https://data.sec.gov/submissions";
const SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json";

function cleanTicker(raw: string | null): string | null {
  const t = (raw || "").trim().toUpperCase();
  if (!t) return null;
  const safe = t.replace(/[^A-Z.\-]/g, "");
  if (!safe) return null;
  if (safe.length > 8) return null;
  return safe;
}

type FilingItem = {
  id?: string;
  filedDate?: string;
  reportDate?: string;
  form?: string;
  description?: string;
  url?: string;
};

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(to);
  }
}

async function fetchSecJsonWithTimeout(url: string, timeoutMs: number, userAgent: string) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: ac.signal,
      headers: {
        // SEC requires an identifying User-Agent.
        "User-Agent": userAgent,
        Accept: "application/json",
      },
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(to);
  }
}

function padCik(cik: number): string {
  return String(Math.trunc(cik)).padStart(10, "0");
}

function filingDocUrl(cik: number, accession: string, primaryDoc: string): string {
  const cikNoPad = String(Math.trunc(cik));
  const accessionNoDashes = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${accessionNoDashes}/${primaryDoc}`;
}

let secTickerToCikCache: { loadedAtMs: number; map: Map<string, number> } | null = null;
async function getSecCikForTicker(symbol: string, timeoutMs: number, userAgent: string): Promise<number | null> {
  const now = Date.now();
  if (secTickerToCikCache && now - secTickerToCikCache.loadedAtMs < 24 * 60 * 60 * 1000) {
    return secTickerToCikCache.map.get(symbol) ?? null;
  }

  const res = await fetchSecJsonWithTimeout(SEC_TICKERS, timeoutMs, userAgent);
  if (!res.ok || !res.json || typeof res.json !== "object") return null;

  const map = new Map<string, number>();
  for (const v of Object.values(res.json as any)) {
    const t = typeof (v as any)?.ticker === "string" ? (v as any).ticker.trim().toUpperCase() : "";
    const cikStr = (v as any)?.cik_str;
    const cik = typeof cikStr === "number" ? cikStr : Number(String(cikStr ?? "").trim());
    if (!t || !Number.isFinite(cik) || cik <= 0) continue;
    map.set(t, cik);
  }

  secTickerToCikCache = { loadedAtMs: now, map };
  return map.get(symbol) ?? null;
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.FINNHUB_API_KEY;

  const symbol = cleanTicker(req.nextUrl.searchParams.get("symbol"));
  if (!symbol) return NextResponse.json({ error: "symbol_required" }, { status: 400 });

  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, limitParam)) : 20;

  try {
    const timeoutMs = 10_000;
    const userAgent =
      (process.env.SEC_USER_AGENT && String(process.env.SEC_USER_AGENT).trim()) ||
      "Longboard (local dev; set SEC_USER_AGENT in .env.local)";

    // Preferred: SEC submissions API (deep links to exact filing documents).
    {
      let cik: number | null = null;

      if (apiKey) {
        const profileUrl = new URL(`${FINNHUB_BASE}/stock/profile2`);
        profileUrl.searchParams.set("symbol", symbol);
        profileUrl.searchParams.set("token", apiKey);

        const profileRes = await fetchJsonWithTimeout(profileUrl.toString(), timeoutMs);
        const cikRaw = (profileRes.json as any)?.cik;
        const maybe = typeof cikRaw === "number" && Number.isFinite(cikRaw) ? cikRaw : Number(String(cikRaw || "").trim());
        if (Number.isFinite(maybe) && maybe > 0) cik = maybe;
      }

      if (!cik) {
        cik = await getSecCikForTicker(symbol, timeoutMs, userAgent);
      }

      if (cik) {
        const secUrl = `${SEC_SUBMISSIONS}/CIK${padCik(cik)}.json`;
        const secRes = await fetchSecJsonWithTimeout(secUrl, timeoutMs, userAgent);
        if (secRes.ok) {
          const recent = (secRes.json as any)?.filings?.recent;
          const forms: string[] = Array.isArray(recent?.form) ? recent.form : [];
          const filingDates: string[] = Array.isArray(recent?.filingDate) ? recent.filingDate : [];
          const reportDates: string[] = Array.isArray(recent?.reportDate) ? recent.reportDate : [];
          const accessions: string[] = Array.isArray(recent?.accessionNumber) ? recent.accessionNumber : [];
          const primaryDocs: string[] = Array.isArray(recent?.primaryDocument) ? recent.primaryDocument : [];

          const items: FilingItem[] = [];
          const n = Math.min(forms.length, filingDates.length, accessions.length, primaryDocs.length);
          for (let i = 0; i < n && items.length < limit; i++) {
            const form = forms[i] || undefined;
            const filedDate = filingDates[i] || undefined;
            const reportDate = reportDates[i] || undefined;
            const accession = accessions[i] || "";
            const primaryDoc = primaryDocs[i] || "";
            const url = accession && primaryDoc ? filingDocUrl(cik, accession, primaryDoc) : undefined;
            items.push({
              id: accession || undefined,
              form,
              filedDate,
              reportDate,
              url,
            });
          }

          return NextResponse.json({ symbol, items, fetchedAt: new Date().toISOString(), source: "sec" }, { status: 200 });
        }
      }
    }

    // Fallback: Finnhub filings (often lacks per-filing URLs on some plans).
    if (!apiKey) {
      return NextResponse.json({ symbol, items: [], fetchedAt: new Date().toISOString(), source: "none" }, { status: 200 });
    }

    const fhUrl = new URL(`${FINNHUB_BASE}/stock/filings`);
    fhUrl.searchParams.set("symbol", symbol);
    fhUrl.searchParams.set("token", apiKey);

    const fhRes = await fetchJsonWithTimeout(fhUrl.toString(), timeoutMs);
    if (!fhRes.ok) {
      return NextResponse.json({ error: "finnhub_error", status: fhRes.status }, { status: 502 });
    }
    const rows = Array.isArray((fhRes.json as any) ?? null) ? (fhRes.json as any[]) : (fhRes.json as any)?.data;
    const items = (Array.isArray(rows) ? rows : [])
      .map((r: any) => {
        const out: FilingItem = {
          id: typeof r?.id === "string" ? r.id : undefined,
          filedDate: typeof r?.filedDate === "string" ? r.filedDate : undefined,
          reportDate: typeof r?.reportDate === "string" ? r.reportDate : undefined,
          form: typeof r?.form === "string" ? r.form : undefined,
          description: typeof r?.description === "string" ? r.description : undefined,
          url: typeof r?.url === "string" ? r.url : undefined,
        };
        return out;
      })
      .slice(0, limit);

    return NextResponse.json({ symbol, items, fetchedAt: new Date().toISOString(), source: "finnhub" }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

