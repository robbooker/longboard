// #383 News Feed: the browser test's fake Polygon. Only GET /v2/reference/news is answered, from
// the synthetic articles below (per ticker, or the market with no ticker); every other Polygon
// address is refused and no request ever leaves this process, so no real market data is read.
// Tests add articles with addArticle() to see them arrive on the next read.
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
let next = 1;
export const articles = [];
export function addArticle({ tickers = [], minutes = 0, title, description = null, publisher = 'Synthetic Wire' }) {
  const id = `synthetic-${next++}`;
  articles.push({ id, title: title ?? `Synthetic headline ${id}`, article_url: `https://news.invalid/${id}`, published_utc: minutesAgo(minutes), tickers, description, publisher: { name: publisher } });
  return id;
}
// Today's gainers' stories (ABCD twice, one shared with WXYZ), then thirty market stories.
addArticle({ tickers: ['ABCD'], minutes: 6, title: 'ABCD jumps after FDA clears its lead drug', description: 'The company said the approval covers adults with the condition and that it expects to start selling the drug early next year, according to a statement released before the open.', publisher: 'GlobeNewswire Inc.' });
addArticle({ tickers: ['ABCD', 'WXYZ'], minutes: 42, title: 'ABCD and WXYZ sign a supply deal', publisher: 'Benzinga' });
addArticle({ tickers: ['WXYZ'], minutes: 180, title: 'WXYZ prices a $5 million offering', description: 'Registered direct offering at $1.10 per share.' });
for (let i = 0; i < 30; i++) addArticle({ tickers: i % 3 ? ['SPY'] : [], minutes: 2 + i * 9, title: `Market update number ${i + 1}: stocks move as traders weigh the latest economic data`, description: i % 2 ? 'Indexes were mixed in early trading.' : null });

export const polygonReads = [];
export function installPolygonNewsStub() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const address = String(url?.url ?? url);
    if (!address.startsWith('https://api.polygon.io/')) return real(url, init);
    const parsed = new URL(address);
    polygonReads.push(parsed.searchParams.get('ticker') ?? '*market');
    if (parsed.pathname !== '/v2/reference/news') return new Response('{"status":"NOT_STUBBED"}', { status: 404 });
    const ticker = parsed.searchParams.get('ticker');
    const limit = Number(parsed.searchParams.get('limit') ?? 10);
    const results = articles.filter((a) => (ticker ? a.tickers.includes(ticker) : true)).sort((a, b) => b.published_utc.localeCompare(a.published_utc)).slice(0, limit);
    return new Response(JSON.stringify({ status: 'OK', count: results.length, results }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
