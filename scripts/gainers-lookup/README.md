# Gainers Table lookup (#371)

`lookup.mjs` runs on Rob's computer and fills in the facts the chat's **Gainers Table** shows for each
stock that alerts in Gainers: country, estimated current cash with months of cash left (or "cash flow
positive"), and institutional ownership. All from DilutionTracker. Node 22+, no packages.

- Every ~20 seconds (every 5 minutes outside 4 AM to 8 PM New York time and at weekends) it asks
  `GET /api/chat/gainers/facts` which of today's tickers still need a lookup.
- For each one it opens `https://dilutiontracker.com/app/search/<TICKER>` in a new tab of the dedicated
  Chromium already running with remote debugging on `http://127.0.0.1:9333` (its own profile, signed in
  to DilutionTracker by Rob), reads the page text, closes the tab and posts the result to
  `POST /api/chat/gainers/facts`. It never opens any other address, and the only thing it ever clicks
  is that page's own News tab (#387, below).
- One page at a time, at least 3 seconds apart, at most 60 an hour. A page that doesn't load is tried
  again after 2, 4, 8 ... minutes (at most an hour); the log then asks whether DilutionTracker is still
  signed in.
- Each ticker is looked up once. The chat asks for it again only when its cash is over 30 days old,
  or after 6 hours when DilutionTracker had no page for it. A known value is never replaced by an empty one,
  and a known country is never changed.
- The 331 countries in `company-countries.json` were loaded into the chat when the table shipped.

## Borrow at TradeZero (#373)

A second loop in the same program fills the table's **Borrow at TZ** column: what it costs to borrow
each of today's gainers at TradeZero, per share. Rob has TradeZero's written permission to build an
application that shows borrow costs. Client: `tradezero.mjs`.

- The chat's `GET /api/chat/gainers/facts` lists, under `borrow`, the tickers due a check: the first time
  a ticker shows up, then every 15 minutes while it alerted in the last 60 minutes (5 minutes after an
  error). The program checks only between 4 AM and 8 PM New York time on weekdays, one at a time, and
  never the same ticker twice within 5 minutes.
- A check: `is-easy-to-borrow` (free). If easy to borrow, that's the answer ("ETB"). Otherwise a quote
  for 100 shares, then the locate history every 1.5 s until the quote is offered (the cheapest of the
  pre-borrow row and the `.SU` single-use row for Reg SHO stocks), rejected or expired ("None"), or
  20 s pass (an error, tried again later). The result goes to `POST /api/chat/gainers/facts` with
  `kind: "borrow"`.
- **It never takes a locate.** The client has only three requests (easy to borrow, quote, history);
  every request is checked against those addresses before it goes out, and
  `lib/__tests__/gainersBorrowTradeZero.test.ts` fails if any other locate address appears in the
  source. Offers are left to lapse, which costs nothing.
- Limits: quotes at least 2 s apart (TradeZero allows 1/s) and 30 s apart for the same symbol; every
  request at least 0.6 s after the last; a 429 waits and tries again.
- Credentials: the first of `~/Documents/AGENT WORK/cobra-das-bridge/.tz.env` and
  `~/.config/cobra-term/tradezero.env` that exists (or `GAINERS_LOOKUP_TZ_ENV_FILE`), mode 600, with
  `TRADEZERO_API_KEY_ID` / `TRADEZERO_API_SECRET_KEY` / `TRADEZERO_ACCOUNT_ID` (or `TZ_API_KEY_ID` /
  `TZ_API_SECRET` / `TZ_ACCOUNT_ID`). Never printed. Without a complete set the log says
  "borrow checks off: …" once and DilutionTracker lookups carry on.

## Interactive Brokers fee and shares available (#376)

A third loop fills the table's **IB overnight fee** and **IB avail** columns (computer only; on a phone
they're in each row's details). Client: `ib.mjs`, no packages (it runs the system's `curl` for FTP).

- Source: IB's free public short stock file, anonymous FTP `ftp2.interactivebrokers.com`, user
  `shortstock`, empty password, `usa.txt` (about 1.8 MB, 20,000 rows, rewritten about every 15 minutes).
  Format (pipe-separated): `#BOF|2026.11.08|13:33:42` (New York time), then
  `#SYM|CUR|NAME|CON|ISIN|REBATERATE|FEERATE|AVAILABLE|FIGI|`, the rows, and `#EOF|<row count>`.
  Rates are % a year (`NA` when none); `AVAILABLE` is shares, `>10000000` above ten million.
- Every 5 minutes, 4 AM to 8 PM New York time on weekdays: reads today's tickers from
  `GET /api/chat/gainers/facts` (`tickers`), downloads `usa.txt.md5` (32 bytes), and `usa.txt` only
  when that changed. The download must match the MD5 and its `#EOF` count, or it's dropped and tried
  again next round. Then it posts the rows for today's tickers it hasn't sent for that file
  (`kind: "ib"`, at most 100 rows a post). A ticker missing from IB's file is sent as 0 available.
- Logs say `IB: …`. A failure (IB's server down, chat unreachable) is logged once and retried in 5 minutes.

## Press releases from DilutionTracker's News tab (#387)

The chat's **News Feed** shows every press release for the stocks in the Gainers channel. Polygon misses
most small-cap releases (ACCESS Newswire and the like); DilutionTracker's News tab lists them all, with
the wire's name.

- **Once per ticker per New York day** (Rob: "check DT once for a press release when it hits the gainers
  channel, and then not again afterward until the next day"). `GET /api/chat/gainers/facts` lists, under
  `news`, today's tickers whose News tab hasn't been read yet today; a ticker leaves that list as soon as
  one read is saved, until the next day.
- The read rides on the facts page load when both are due (one page, not two). After the company's
  header shows, it clicks the page's **News** tab (`.search-result-heading-selection-tab` reading "News")
  and reads the list under **PR Releases**, one `.callout2Wrapper` per release: relative time, the exact
  time (New York time, e.g. `11/6/2026, 9:15:00 AM`, saved as UTC), the wire's name, and the headline
  linked to DilutionTracker's `https://dilution.news/<id>` short link (the id keeps each release once).
  It waits until the list has drawn and stopped growing (up to 15 s); a tab with no PR Releases after
  8 s counts as "no releases". A ticker DilutionTracker doesn't know counts as read, with none.
- It keeps the releases from the last 30 days (at most 50) and posts them with `kind: "news"`. The chat
  keeps 45 days per ticker and shows the last three days by default; older ones show under the stock's chip.
- A failed read is tried again after 2, 4 and 8 minutes; after 4 tries the ticker is left until tomorrow.
  Logs say `<TICKER> news: …`.
- Parser: `parse.mjs` (`dtNewsSnapshot` runs inside the page; `parseDtNews` turns its rows into releases).
  Tests: `npx vitest run lib/__tests__/gainersLookupNews.test.ts`, and the in-page reader on a synthetic
  page in `scripts/tests/chat-news-feed-browser.mjs`.

Files:

- Token (never printed): `~/.config/longboard/gainers-lookup/ingest.token`, mode 600 (the program refuses
  a file others can read). The same value is `CHAT_GAINERS_LOOKUP_TOKEN` in Vercel.
- Logs: `journalctl --user -u lb-gainers-lookup -f`.
- Parser: `parse.mjs` (tests: `npx vitest run lib/__tests__/gainersLookupParse.test.ts`); IB's file:
  `ib.mjs` (tests: `npx vitest run lib/__tests__/gainersIbFile.test.ts`).

Install:

    cp scripts/gainers-lookup/lb-gainers-lookup.service ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now lb-gainers-lookup

It runs from `~/projects/longboard`, so keep that checkout on `main`.

Settings (environment, for testing): `GAINERS_LOOKUP_CHAT_URL` (default `https://chat.robbooker.com`),
`GAINERS_LOOKUP_CDP_URL` (default `http://127.0.0.1:9333`), `GAINERS_LOOKUP_TOKEN_FILE`.
