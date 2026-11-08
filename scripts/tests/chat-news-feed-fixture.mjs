// #383 News Feed: the browser test's fake Polygon. Only GET /v2/reference/news is answered, from
// the synthetic articles below (per ticker, or the market with no ticker); every other Polygon
// address is refused and no request ever leaves this process, so no real market data is read.
// Tests add articles with addArticle() to see them arrive on the next read.
// #387: and a fake FMP (/stable/news/general-latest and stock-latest) and the saved DilutionTracker
// releases the route reads from the database (dtRows), all synthetic.
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

// #387: DilutionTracker's saved releases (public.chat_gainers_news_for rows). ABCD's pricing release
// Polygon never had; WXYZ's offering is the same story Polygon has (shown once, with DT's wire);
// ABCD's compliance release is five days old (only under the ABCD chip).
const dtRow = (ticker, key, minutes, title, source) => ({ ticker, item_key: `dt:${key}`, published_at: minutesAgo(minutes), source, title, url: `https://dilution.news/${key}` });
export const dtRows = [
  dtRow('ABCD', 'synthabcd0001', 12, 'ABCD Announces Pricing of $4 Million Registered Direct Offering', 'ACCESS Newswire'),
  dtRow('WXYZ', 'synthwxyz0001', 181, 'WXYZ Prices a $5 Million Offering', 'GlobeNewswire'),
  dtRow('ABCD', 'synthabcd0002', 5 * 1440, 'ABCD Regains Compliance With Nasdaq Listing Rule', 'ACCESS Newswire'),
];

// #387: FMP's market headlines. Times are New York wall-clock, as FMP sends them. One repeats a
// Polygon market headline (shown once).
const nyClock = (m) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() - m * 60_000));
const fmp = (n, minutes, title, publisher, url, symbol = 'None') => ({ symbol, publishedDate: nyClock(minutes), publisher, site: new URL(url).hostname, title, url });
export const fmpGeneral = [
  fmp(1, 4, 'Treasury yields climb ahead of the jobs report', 'Barrons', 'https://www.barrons.com/articles/synthetic-fmp-1'),
  fmp(2, 25, 'Oil steadies as traders watch supply talks', 'Reuters', 'https://www.reuters.com/markets/synthetic-fmp-2'),
  fmp(3, 12, 'Market update number 2: stocks move as traders weigh the latest economic data', 'Some Site', 'https://news.invalid/fmp-dup'),
];
export const fmpStock = [
  fmp(4, 15, 'Chipmaker shares rise after an upbeat forecast', 'Business Wire', 'https://www.businesswire.com/news/home/synthetic-fmp-4', 'CHPS'),
  fmp(5, 70, 'Retailer cuts its outlook as shoppers pull back', 'Seeking Alpha', 'https://seekingalpha.com/news/synthetic-fmp-5', 'SHOP'),
];

export const polygonReads = [];
export const fmpReads = [];
export function installPolygonNewsStub() {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const address = String(url?.url ?? url);
    if (address.startsWith('https://financialmodelingprep.com/')) {
      const parsed = new URL(address);
      fmpReads.push(parsed.pathname);
      const body = parsed.pathname === '/stable/news/general-latest' ? fmpGeneral : parsed.pathname === '/stable/news/stock-latest' ? fmpStock : null;
      return body ? new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('[]', { status: 404 });
    }
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

// #387: a synthetic DilutionTracker company page in the shape the News tab has (see
// scripts/gainers-lookup/parse.mjs), for checking the in-page reader in a real browser. Clicking
// the News tab marks it active and draws the list, as the real page does.
export const dtSyntheticPage = `<!doctype html><body>
<div class="searchResultTabContainer"><div class="d-flex search-result-heading-selection-tab cursor-pointer active-selection-tab">Dilution</div><div id="news" class="d-flex search-result-heading-selection-tab cursor-pointer">News</div></div>
<div id="content"></div>
<script>
document.getElementById('news').addEventListener('click',()=>{
 document.querySelector('.active-selection-tab').classList.remove('active-selection-tab');
 document.getElementById('news').classList.add('active-selection-tab');
 const item=(rel,when,wire,href,title)=>'<div class="callout2WrapperOutterGg my-2"><div class="callout2Wrapper"><div class=""><span class="fw-600">'+rel+'</span><svg></svg><span class="fw-600">'+when+' </span><svg></svg><span class="opacity-7">'+wire+'</span></div><div class="mt-2 newsTitle"><a href="'+href+'" target="_blank" rel="noreferrer">'+title+'</a></div></div></div>';
 setTimeout(()=>{document.getElementById('content').innerHTML='<div><p class="heading-filing-category">Chart Explorer</p></div><div class="mb-5"><p class="cursor-default heading-filing-category">PR Releases</p>'
  +item('2 days ago','11/6/2026, 9:15:00 AM','ACCESS Newswire','https://dilution.news/synth0001','Synthetic Co Has a New Passport; SYN is the Stamp')
  +item('3 days ago','11/4/2026, 9:30:00 PM','ACCESS Newswire','https://dilution.news/synth0002','Synthetic Co &amp; Partners Sign a Deal')
  +item('2 years ago','4/29/2024, 9:00:00 AM','GlobeNewswire','https://dilution.news/synth0003','An Old Release')
  +'</div>';},200);
});
</script></body>`;
