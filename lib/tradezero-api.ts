/**
 * TradeZero proxy fetch.
 *
 * The proxy lives at TZ_PROXY_URL and routes via ?path=<encoded path>.
 * Every request hits the same base URL; the real TZ path goes in the query string.
 */
export async function tzProxyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = process.env.TZ_PROXY_URL;
  const apiKey = process.env.TZ_PROXY_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("TradeZero proxy not configured (TZ_PROXY_URL / TZ_PROXY_API_KEY)");
  }

  const url = new URL(baseUrl);
  url.searchParams.set("path", path);

  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      "x-api-key": apiKey,
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

/** Returns the TZ_ACCOUNT_ID or throws. */
export function tzAccountId(): string {
  const id = process.env.TZ_ACCOUNT_ID;
  if (!id) throw new Error("TZ_ACCOUNT_ID not configured");
  return id;
}
