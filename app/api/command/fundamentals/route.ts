import { NextResponse, type NextRequest } from "next/server";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

function cleanTicker(raw: string | null): string | null {
  const t = (raw || "").trim().toUpperCase();
  if (!t) return null;
  const safe = t.replace(/[^A-Z.\-]/g, "");
  if (!safe) return null;
  if (safe.length > 8) return null;
  return safe;
}

type MetricAll = Record<string, number | string | null | undefined>;

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: ac.signal });
    const json = res.ok ? await res.json().catch(() => ({})) : {};
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(to);
  }
}

export async function GET(req: NextRequest) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Finnhub API key not configured" }, { status: 500 });

  const symbol = cleanTicker(req.nextUrl.searchParams.get("symbol"));
  if (!symbol) return NextResponse.json({ error: "symbol_required" }, { status: 400 });

  try {
    const profileUrl = new URL(`${FINNHUB_BASE}/stock/profile2`);
    profileUrl.searchParams.set("symbol", symbol);
    profileUrl.searchParams.set("token", apiKey);

    const metricUrl = new URL(`${FINNHUB_BASE}/stock/metric`);
    metricUrl.searchParams.set("symbol", symbol);
    metricUrl.searchParams.set("metric", "all");
    metricUrl.searchParams.set("token", apiKey);

    const earningsUrl = new URL(`${FINNHUB_BASE}/stock/earnings`);
    earningsUrl.searchParams.set("symbol", symbol);
    earningsUrl.searchParams.set("token", apiKey);

    const timeoutMs = 10_000;
    const [profileRes, metricRes, earningsRes] = await Promise.all([
      fetchJsonWithTimeout(profileUrl.toString(), timeoutMs),
      fetchJsonWithTimeout(metricUrl.toString(), timeoutMs),
      fetchJsonWithTimeout(earningsUrl.toString(), timeoutMs),
    ]);

    const profile = profileRes.json && typeof profileRes.json === "object" ? profileRes.json : {};
    const metric: MetricAll = (metricRes.json as any)?.metric ?? {};
    const earnings = Array.isArray((earningsRes.json as any) ?? null) ? (earningsRes.json as any[]) : [];

    return NextResponse.json(
      {
        symbol,
        profile,
        metric,
        earnings: earnings.slice(0, 8),
        fetchedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

