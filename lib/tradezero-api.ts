import type { TradeZeroCreds } from "@/lib/brokerKeys";

/**
 * TradeZero proxy fetch. The proxy lives at creds.proxyUrl and routes via
 * ?path=<encoded path>. Every request hits the same base URL; the real TZ
 * path goes in the query string. Creds are supplied by the caller (routes
 * decrypt them from the vault via getTradeZeroCredsForUser) — we no longer
 * read env vars here.
 */
export async function tzProxyFetch<T>(path: string, creds: TradeZeroCreds, init?: RequestInit): Promise<T> {
  const url = new URL(creds.proxyUrl);
  url.searchParams.set("path", path);

  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      "x-api-key": creds.proxyApiKey,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TradeZero ${path} returned ${res.status}: ${body}`);
  }

  return res.json();
}
