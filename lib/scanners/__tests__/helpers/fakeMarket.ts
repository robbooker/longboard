import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

// Recorded Polygon data for one trading day (2026-10-16): the market snapshot rows that can
// pass the scanner's filters, the ticker reference answers, and every 1m/5m bar the scanner
// fetched (incl. the 45-day 5m history). Recorded from the real API with
// scripts in the HEALTH-2026-10-17-3 work; no keys are stored.
type MarketFixture = {
  etDate: string;
  snapshot: unknown[];
  references: Record<string, unknown>;
  /** "TICKER:1m" / "TICKER:5m" → [t(ms), o, h, l, c, v][] */
  bars: Record<string, number[][]>;
};

export function loadMarketFixture(): MarketFixture {
  const file = path.join(__dirname, "../fixtures/rvol-market-2026-10-16.json.gz");
  return JSON.parse(gunzipSync(readFileSync(file)).toString()) as MarketFixture;
}

/**
 * A fake Polygon over the recording. `nowMs()` is the simulated clock: bars that had not
 * started by then are hidden (like Polygon, a bar in progress is returned).
 */
export function fakePolygonFetch(fixture: MarketFixture, nowMs: () => number) {
  const stats = { calls: 0, byKind: {} as Record<string, number> };
  const count = (kind: string) => {
    stats.calls++;
    stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
  };
  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.hostname !== "api.polygon.io") throw new Error(`unexpected fetch to ${url.hostname}`);
    if (url.pathname === "/v2/snapshot/locale/us/markets/stocks/tickers") {
      count("snapshot");
      return respond({ tickers: fixture.snapshot });
    }
    const ref = /^\/v3\/reference\/tickers\/([^/]+)$/.exec(url.pathname);
    if (ref) {
      count("reference");
      const ticker = decodeURIComponent(ref[1]);
      if (!(ticker in fixture.references)) return new Response("not found", { status: 404 });
      return respond({ results: fixture.references[ticker] ?? undefined });
    }
    const aggs = /^\/v2\/aggs\/ticker\/([^/]+)\/range\/(\d+)\/(minute)\/(\d+)\/(\d+)$/.exec(url.pathname);
    if (aggs) {
      const [, rawTicker, multiplier, , from, to] = aggs;
      count(`bars${multiplier}m`);
      const rows = fixture.bars[`${decodeURIComponent(rawTicker)}:${multiplier}m`];
      if (!rows) return respond({ results: [] });
      const now = nowMs();
      const results = rows
        .filter(([t]) => t >= Number(from) && t <= Number(to) && t <= now)
        .map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
      return respond({ results });
    }
    count("other");
    return new Response("not recorded", { status: 404 });
  };

  return { fetchImpl, stats };
}
