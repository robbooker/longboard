// #458: the overseas marker browser test's fake Short Check, on top of the Gainers Table's fake
// Polygon (chat-gainers-table-preload.mjs). Only https://short-check.vercel.app/api/nexus/<TICKER> is
// answered, from the synthetic answers below, and only with the test's synthetic key; the real feed
// is never reached. AIMD is US-listed and run from Taiwan and the Cayman Islands (flagged), USCO is a
// plain U.S. company (clear), SLOW never answers in time (no marker, the table doesn't wait), and
// CHNA would be flagged but is never asked: its block is CN, not US.
await import('./chat-gainers-table-preload.mjs');
const KEY = 'synthetic-short-check-key-never-a-production-secret';
const ANSWERS = {
  AIMD: { ticker: 'AIMD', overseas: true, countries: ['Taiwan', 'Cayman Islands'], reason: 'Listed in the US. Filings tie operations or control to Taiwan and the Cayman Islands.', evidenceUrl: 'https://www.sec.gov/Archives/edgar/data/0000000/000000000026000001/aimd-10k.htm', asOf: '2026-11-10', status: 'flagged' },
  USCO: { ticker: 'USCO', overseas: false, countries: [], reason: 'Listed in the US. Filings reviewed; no overseas operations or control found.', evidenceUrl: null, asOf: '2026-11-10', status: 'clear' },
  CHNA: { ticker: 'CHNA', overseas: true, countries: ['China'], reason: 'Should never be asked.', evidenceUrl: null, asOf: '2026-11-10', status: 'flagged' },
};
const inner = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const address = String(url?.url ?? url);
  if (!address.startsWith('https://short-check.vercel.app/')) return inner(url, init);
  const headers = new Headers(init?.headers);
  if (headers.get('x-api-key') !== KEY) return new Response('{"error":"unauthorized"}', { status: 401 });
  const ticker = new URL(address).pathname.match(/^\/api\/nexus\/([A-Z.]+)$/)?.[1];
  if (ticker === 'SLOW') {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 30_000);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason); });
    });
  }
  const body = ANSWERS[ticker];
  return body ? new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{"error":"invalid_ticker"}', { status: 400 });
};
