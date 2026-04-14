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
  const bodyPreview = typeof init?.body === "string" ? init.body.slice(0, 300) : null;
  const apiKeyFingerprint = creds.proxyApiKey ? `${creds.proxyApiKey.slice(0, 4)}…(${creds.proxyApiKey.length})` : "MISSING";

  // TEMP DIAGNOSTIC — Phase 3D order POST returning a wrapped 400 with
  // "{"raw":"invalid character '<' looking for beginning of value", ...}"
  // and proxy logs allegedly showing no POST. Capture exactly what we send
  // so we can confirm the URL is right, the method is POST, the body has
  // the expected payload, and the proxy URL coming out of the vault is
  // sane. Remove once root cause is in.
  console.log("[tzProxyFetch] →", JSON.stringify({
    url: url.toString(),
    method,
    bodyLength: typeof init?.body === "string" ? init.body.length : null,
    bodyPreview,
    apiKey: apiKeyFingerprint,
  }));

  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      "x-api-key": creds.proxyApiKey,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  // Read body as text once so we can log a preview either way, then hand
  // JSON back to the caller via JSON.parse. Streams can't be consumed twice.
  const rawBody = await res.text();

  if (!res.ok) {
    console.log("[tzProxyFetch] ←", JSON.stringify({
      url: url.toString(),
      method,
      status: res.status,
      contentType: res.headers.get("content-type"),
      bodyPreview: rawBody.slice(0, 500),
    }));
    throw new Error(`TradeZero ${path} returned ${res.status}: ${rawBody}`);
  }

  // TEMP DIAGNOSTIC — chasing a /tradezero positions table that shows
  // "0 open" while TZ confirms the position exists. Logging the 2xx
  // response body lets us see TZ's current field names (qty vs shares,
  // avg vs priceAvg, unrealized_pl vs pl, …) and fix the parser.
  // Remove once the positions table renders correctly.
  console.log("[tzProxyFetch] ← 2xx", JSON.stringify({
    url: url.toString(),
    method,
    status: res.status,
    contentType: res.headers.get("content-type"),
    bodyLength: rawBody.length,
    bodyPreview: rawBody.slice(0, 500),
  }));

  try {
    return JSON.parse(rawBody) as T;
  } catch (e) {
    const message = e instanceof Error ? e.message : "json parse failed";
    throw new Error(`TradeZero ${path} returned ${res.status} with unparseable JSON: ${message} — body=${rawBody.slice(0, 200)}`);
  }
}
