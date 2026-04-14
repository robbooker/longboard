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

  const method = (init?.method ?? "GET").toUpperCase();

  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      "x-api-key": creds.proxyApiKey,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  // Read body as text once so we can log a preview on failures and still
  // hand JSON back to the caller via JSON.parse. Streams can't be consumed
  // twice.
  const rawBody = await res.text();

  if (!res.ok) {
    // Kept deliberately: next upstream spec change will land here first and
    // this preview is what surfaces the shape. Rip the success-path log,
    // keep this one.
    console.log("[tzProxyFetch] ←", JSON.stringify({
      url: url.toString(),
      method,
      status: res.status,
      contentType: res.headers.get("content-type"),
      bodyPreview: rawBody.slice(0, 500),
    }));
    throw new Error(`TradeZero ${path} returned ${res.status}: ${rawBody}`);
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch (e) {
    const message = e instanceof Error ? e.message : "json parse failed";
    throw new Error(`TradeZero ${path} returned ${res.status} with unparseable JSON: ${message} — body=${rawBody.slice(0, 200)}`);
  }
}
