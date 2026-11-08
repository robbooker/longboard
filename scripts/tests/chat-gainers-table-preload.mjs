// #372: the Gainers Table browser test's fake Polygon. Only the stock snapshot is answered, from the
// synthetic numbers below; every other Polygon address is refused, so no real market data is read.
// AEHL is pre-market style (day.v still 0, min.av counts the shares), NEWT trades under $1 and is
// down, GONE isn't in the snapshot at all ("—").
const SNAPSHOTS = {
  AEHL: { todaysChangePerc: 52.34, lastTrade: { p: 2.5 }, min: { c: 2.49, av: 1_234_567, v: 4_100 }, day: { c: 0, v: 0 } },
  NEWT: { todaysChangePerc: -12.34, lastTrade: { p: 0.45123 }, min: { c: 0.45, av: 850_000, v: 2_000 }, day: { c: 0.45, v: 849_000 } },
  FRSH: { todaysChangePerc: 100, min: { c: 10, av: 12_345_678, v: 90_000 }, day: { c: 10, v: 12_000_000 } },
};
const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const address = String(url?.url ?? url);
  if (!address.startsWith('https://api.polygon.io/')) return real(url, init);
  const parsed = new URL(address);
  if (parsed.pathname !== '/v2/snapshot/locale/us/markets/stocks/tickers') return new Response('{"status":"NOT_STUBBED"}', { status: 404 });
  const tickers = (parsed.searchParams.get('tickers') ?? '').split(',').filter(t => SNAPSHOTS[t]).map(ticker => ({ ticker, ...SNAPSHOTS[ticker] }));
  return new Response(JSON.stringify({ status: 'OK', count: tickers.length, tickers }), { status: 200, headers: { 'content-type': 'application/json' } });
};
