// #386 Booker Stock Club browser test: a fake Polygon inside the Next server. Every value is
// synthetic and no real Polygon address is reached (anything not answered here is refused):
//  - the all-stocks snapshot (also with ?tickers= for the Gainers Table), one ticker's snapshot and
//    the ticker reference: three names pass the morning report's rules (USAA +150%, NEWA +90%,
//    CNAA +60%); THIN (100K shares), PENY (under $1), BIGG ($500M) and ABCDW (a warrant) don't;
//  - hour bars, sent in two pages joined by next_url so the levels only come out right when the
//    app follows it; daily bars for the 200 SMA; today's 2-minute bars for the chart.
const SNAP = {
  USAA: { pct: 150, price: 4, vol: 2_000_000, type: 'CS', name: 'US Alpha Inc', cap: 40e6 },
  NEWA: { pct: 90, price: 3, vol: 900_000, type: 'CS', name: 'New Alpha Corp', cap: 30e6 },
  CNAA: { pct: 60, price: 2.5, vol: 800_000, type: 'CS', name: 'China Alpha Holdings', cap: 20e6 },
  THIN: { pct: 400, price: 2, vol: 100_000, type: 'CS', name: 'Thin', cap: 10e6 },
  PENY: { pct: 300, price: 0.5, vol: 9_000_000, type: 'CS', name: 'Penny', cap: 10e6 },
  BIGG: { pct: 200, price: 5, vol: 9_000_000, type: 'CS', name: 'Big', cap: 500e6 },
  ABCDW: { pct: 250, price: 2, vol: 9_000_000, type: 'WARRANT', name: 'Warrant', cap: 1e6 },
};
const snapshot = (ticker) => {
  const s = SNAP[ticker];
  return { ticker, todaysChangePerc: s.pct, todaysChange: s.price - s.price / (1 + s.pct / 100), day: { c: s.price, v: s.vol }, prevDay: { c: s.price / (1 + s.pct / 100) }, lastTrade: { p: s.price }, min: { c: s.price, av: s.vol, v: 1000 } };
};
const etMs = (day, hour, minute = 0) => {
  // New York is UTC-5 in November and UTC-4 in summer: close enough for synthetic bars, and the app
  // reads the bars' own times.
  const m = Number(day.slice(5, 7));
  const offset = m >= 4 && m <= 10 ? 4 : 5;
  return Date.parse(`${day}T${String(hour + offset).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
};
const days = (from, to) => {
  const out = [];
  for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1))
    if (d.getUTCDay() % 6) out.push(d.toISOString().slice(0, 10));
  return out;
};
// Each stock slid from about 3x today's price over the last months: old monthly pivots sit above
// today's price and were never touched since (missed), the 200-day average is above it too.
const history = (ticker, from, to) => {
  const s = SNAP[ticker];
  const list = days(from, to);
  return list.map((day, i) => {
    const c = day === to ? s.price : +(s.price * (1.2 + 1.8 * (1 - i / list.length))).toFixed(4);
    return { day, c };
  });
};
const hourBars = (ticker, from, to) =>
  history(ticker, from, to).flatMap(({ day, c }) => [4, 10, 15].map((h) => ({ t: etMs(day, h), o: c, h: +(c * 1.01).toFixed(4), l: +(c * 0.99).toFixed(4), c, v: 1000 })));
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const real = globalThis.fetch;
const pages = new Map();
globalThis.fetch = async (url, init) => {
  const address = String(url?.url ?? url);
  if (!address.startsWith('https://api.polygon.io/')) return real(url, init);
  const parsed = new URL(address);
  const path = parsed.pathname;
  if (path === '/v2/snapshot/locale/us/markets/stocks/tickers') {
    const only = parsed.searchParams.get('tickers');
    const list = (only ? only.split(',') : Object.keys(SNAP)).filter((t) => SNAP[t]);
    return json({ status: 'OK', count: list.length, tickers: list.map(snapshot) });
  }
  let m = path.match(/^\/v2\/snapshot\/locale\/us\/markets\/stocks\/tickers\/([A-Z.]+)$/);
  if (m) return SNAP[m[1]] ? json({ status: 'OK', ticker: snapshot(m[1]) }) : new Response('{"status":"NOT_FOUND"}', { status: 404 });
  m = path.match(/^\/v3\/reference\/tickers\/([A-Z.]+)$/);
  if (m) {
    const s = SNAP[m[1]];
    return s ? json({ status: 'OK', results: { ticker: m[1], type: s.type, name: s.name, market_cap: s.cap } }) : new Response('{"status":"NOT_FOUND"}', { status: 404 });
  }
  if (path === '/test/next-page') {
    const rest = pages.get(parsed.searchParams.get('cursor'));
    return rest ? json({ status: 'OK', results: rest }) : new Response('{}', { status: 404 });
  }
  m = path.match(/^\/v2\/aggs\/ticker\/([A-Z.]+)\/range\/(\d+)\/(minute|hour|day)\/([\d-]+)\/([\d-]+)$/);
  if (m && SNAP[m[1]]) {
    const [, ticker, , span, from, to] = m;
    if (span === 'hour') {
      const bars = hourBars(ticker, from, to);
      const cursor = `${ticker}-${from}-${to}`;
      const half = Math.floor(bars.length / 2);
      pages.set(cursor, bars.slice(half));
      return json({ status: 'OK', results: bars.slice(0, half), next_url: `https://api.polygon.io/test/next-page?cursor=${cursor}` });
    }
    if (span === 'day') return json({ status: 'OK', results: history(ticker, from, to).map(({ day, c }) => ({ t: etMs(day, 0), o: c, h: c, l: c, c, v: 1e6 })) });
    // Today's 2-minute bars from 4 AM: a run up from the prior close to today's price.
    const s = SNAP[ticker];
    const start = s.price / (1 + s.pct / 100);
    const bars = Array.from({ length: 180 }, (_, i) => {
      const c = +(start + (s.price - start) * (i / 179) + Math.sin(i / 7) * s.price * 0.03).toFixed(4);
      return { t: etMs(to, 4) + i * 120_000, o: c, h: c, l: c, c, v: 5000 };
    });
    return json({ status: 'OK', results: bars });
  }
  return new Response('{"status":"NOT_STUBBED"}', { status: 404 });
};
