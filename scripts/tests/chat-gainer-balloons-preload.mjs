// #528 Gainer Balloons browser test: a fake Polygon inside the Next server. It answers 2-minute bars
// and daily bars from made-up numbers (the same every run), and refuses everything else, so no real
// market data is read. The weather service is refused too: the test answers the weather route in the
// browser, and nothing here may reach a real weather server.
//  CHNA China, float 600K, heavy volume (several times its float)      HKGO Hong Kong, float 2M
//  CHHK "China Hong Kong", float 900K                                  SGPR Singapore   MLYS Malaysia
//  ISRL Israel, float unknown                                          USAA/USBB/USCC U.S.
//  UNKF U.S., float unknown                                            NOPC no previous close (no daily bars)
//  FADE ran early and has fallen back                                  DOWN Polygon answers 500 for its bars
// #533 shares outstanding (ticker details), for the market cap on a balloon's card: CHNA 10M, USAA 250M
// (weighted), HKGO 4M (its share class only); every other stock has no count, so its market cap is a dash.
// (How often Polygon is asked is checked by the unit tests, lib/__tests__/gainerBalloonsFeed.test.ts.)
const STOCKS = {
  CHNA: { prev: 1.0, top: 2.9, volume: 4_200_000 },
  HKGO: { prev: 0.9, top: 1.5, volume: 2_600_000 },
  CHHK: { prev: 2.0, top: 3.1, volume: 1_500_000 },
  SGPR: { prev: 3.7, top: 4.6, volume: 900_000 },
  MLYS: { prev: 0.6, top: 0.95, volume: 3_300_000 },
  ISRL: { prev: 1.1, top: 2.4, volume: 6_000_000 },
  USAA: { prev: 4.0, top: 5.0, volume: 1_200_000 },
  USBB: { prev: 7.5, top: 8.4, volume: 420_000 },
  USCC: { prev: 0.4, top: 0.52, volume: 5_100_000 },
  UNKF: { prev: 2.2, top: 2.9, volume: 800_000 },
  NOPC: { prev: null, top: 1.9, volume: 650_000, open: 1.4 },
  FADE: { prev: 1.0, top: 2.2, volume: 2_000_000, fade: true },
  DOWN: { prev: 1.0, top: 1.2, volume: 300_000, broken: true },
};
const SHARES = { CHNA: { weighted_shares_outstanding: 10_000_000 }, USAA: { weighted_shares_outstanding: 250_000_000, share_class_shares_outstanding: 200_000_000 }, HKGO: { share_class_shares_outstanding: 4_000_000 } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
// A small repeatable random number per ticker and bar.
const noise = (ticker, i) => { let h = 2166136261; for (const c of `${ticker}:${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };

function bars(ticker, from, to) {
  const s = STOCKS[ticker];
  const end = Math.min(to, Date.now());
  const steps = Math.max(1, Math.floor((end - from) / 120_000));
  const start = s.prev ?? s.open;
  const out = [];
  let last = start;
  for (let i = 0; i < steps; i++) {
    // Quiet gaps: about one bar in five never traded.
    if (noise(ticker, i) < 0.2 && i > 0) continue;
    const u = (i + 1) / steps;
    // Most stocks climb to their top; FADE peaks a third of the way in and falls back.
    const shape = s.fade ? (u < 0.35 ? u / 0.35 : Math.max(0.12, 1 - (u - 0.35) * 1.35)) : Math.pow(u, 0.7);
    const close = +(start + (s.top - start) * shape * (0.94 + noise(ticker, i + 500) * 0.12)).toFixed(4);
    // One bar in fourteen is a burst: many times the usual volume.
    const burst = i > 8 && i % 14 === 9 ? 9 : 1;
    const volume = Math.round((s.volume / steps) * (0.5 + noise(ticker, i + 900)) * burst);
    out.push({ t: from + i * 120_000, o: last, h: Math.max(last, close) * 1.01, l: Math.min(last, close) * 0.99, c: close, v: volume });
    last = close;
  }
  return out;
}

const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const address = String(url?.url ?? url);
  if (address.startsWith('https://api.weather.gov/')) return new Response('{"status":"NOT_STUBBED"}', { status: 503 });
  if (!address.startsWith('https://api.polygon.io/')) return real(url, init);
  const parsed = new URL(address);
  const aggs = parsed.pathname.match(/^\/v2\/aggs\/ticker\/([A-Z.]+)\/range\/(\d+)\/(minute|day)\/([^/]+)\/([^/]+)$/);
  if (aggs) {
    const [, ticker, multiplier, span, from, to] = aggs;
    const s = STOCKS[ticker];
    if (!s) return json({ status: 'OK', results: [] });
    if (span === 'day') return json({ status: 'OK', results: s.prev === null ? [] : [{ t: Date.parse(`${to}T05:00:00Z`), o: s.prev, h: s.prev, l: s.prev, c: s.prev, v: 100_000 }] });
    if (s.broken) return json({ status: 'ERROR' }, 500);
    if (multiplier !== '2') return json({ status: 'NOT_STUBBED' }, 404);
    return json({ status: 'OK', results: bars(ticker, Number(from), Number(to)) });
  }
  const details = parsed.pathname.match(/^\/v3\/reference\/tickers\/([A-Z.]+)$/);
  if (details) return STOCKS[details[1]] ? json({ status: 'OK', results: { ticker: details[1], ...SHARES[details[1]] } }) : json({ status: 'NOT_FOUND' }, 404);
  if (parsed.pathname === '/v2/snapshot/locale/us/markets/stocks/tickers') return json({ status: 'OK', tickers: [] });
  return json({ status: 'NOT_STUBBED' }, 404);
};
