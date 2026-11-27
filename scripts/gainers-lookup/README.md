# Gainers Table lookup (#371)

`lookup.mjs` runs on Rob's computer and fills in the facts the chat's **Gainers Table** shows for each
stock that alerts in Gainers: country, estimated current cash with months of cash left (or "cash flow
positive"), institutional ownership and float. All from DilutionTracker (#534: its API first, the
company page as the fallback). Node 22+, no packages.

- Every ~20 seconds (every 5 minutes outside 4 AM to 8 PM New York time and at weekends) it asks
  `GET /api/chat/gainers/facts` which of today's tickers still need a lookup.
- **Facts come from the DilutionTracker API first (#534)**, see "Company facts from the DilutionTracker
  API" below. The company page is the fallback for facts, and is always what the News tab is read from.
- For a page read it shows `https://dilutiontracker.com/app/search/<TICKER>` in **the one DilutionTracker
  tab** of the dedicated Chromium already running with remote debugging on `http://127.0.0.1:9333`
  (its own profile, signed in to DilutionTracker by Rob; see "The DilutionTracker browser" below), reads
  the page text and posts the result to `POST /api/chat/gainers/facts`. It never opens any other
  address, and the only thing it ever clicks is that page's own News tab (#387, below).
- **No catching up (#472).** When the program starts, every ticker already on today's list (the table,
  plus anything the chat lists as needing facts or news) counts as done and is never looked up that day.
  Only tickers that show up after it started are looked up, once each per New York day (facts from the
  API, news on one page load; facts ride on that page load too when the API couldn't give them). The log says `N tickers already on today's list: not looked up …` at start.
- One page at a time, at least 3 seconds apart, at most 60 an hour, never the same ticker twice within
  5 minutes. A page that doesn't load is tried again after 5, 10 and 20 minutes, then left until
  tomorrow; the log then asks whether DilutionTracker is still signed in.
- A ticker done today isn't loaded again today, even if the chat lists it again. A known value is never
  replaced by an empty one, and a known country is never changed.
- The 331 countries in `company-countries.json` were loaded into the chat when the table shipped.
- #466: the same page's header also gives the **Float** column ("Float & OS:0.55M / 16.46M": the first
  figure), posted with the facts as `floatShares` (null when the page shows none). The program asks
  `GET /api/chat/gainers/facts?float=1`, so a ticker whose float was never read, or is over 7 days old,
  is listed too. Since #472 that only matters for a ticker's one lookup on the day it shows up.

## Company facts from the DilutionTracker API (#534)

The page read missed a lot (of 12 tickers on 2026-11-27 it gave cash for 1 and the float for 2; the API
gave everything for all 12), so the facts now come from DilutionTracker's API v2. Client: `dt-api.mjs`
(no packages; fetch, the clock and the key are passed in).

- Key: `~/.config/longboard/dilutiontracker.key`, one line, mode 600 (or `GAINERS_LOOKUP_DT_KEY_FILE`).
  Read once at start, never printed and never in an error message. Without the file (or if it is empty
  or others can read it) the log says `no DilutionTracker API key; using the browser tab for facts` once
  and everything is read from the page, as before #534.
- Per ticker, at `https://api.dilutiontracker.com` with the key in the `x-api-key` header: first
  `GET /v2/company/profile/{T}` (country; a 400 "Invalid Ticker" means not on DilutionTracker, posted
  as `notFound`), then together `GET /v2/cash-position/{T}`, `GET /v2/institutional-ownership/companies/{T}`
  and `GET /v2/float/{T}`. A 404 on those three means DilutionTracker has none: saved empty.
- What is saved (the same fields the page read posts, so the chat's route is unchanged):
  - country: as the page writes it (`U.S` becomes `U.S.`).
  - institutional ownership: `totalInstOwnPct` (already a percent), 0 to 1000.
  - float: `float` (millions of shares) x 1,000,000, when above 0.
  - cash, only when `hasEstCurrentCash` is true: `estCurrentCash` (millions of USD) x 1,000,000, a
    negative estimate saved as 0. Cash flow positive when `quarterlyOperatingCashflow` is 0 or more
    (then no months, like the page). Months left: `monthsCashRunway`, never below 0. The API stops that
    figure at 100, so at 100 with a burn it is worked out the way the page shows it,
    `estCurrentCash / -quarterlyOperatingCashflow x 3`, to one decimal (42.59 / 0.26 x 3 = 491.4),
    never above 1,000,000 (the most the chat accepts).
- An answer (found or not found) is posted and the ticker's facts are done for the day. That needs no
  browser: facts keep arriving while the browser is down (the main loop then keeps its 20-second pace
  and tries the browser every 2 minutes), and API reads don't count against the page limits. The page
  is then loaded only for what is still due: the News tab, and the facts the API couldn't give.
- The page is the fallback for a ticker's facts when: the ticker isn't 1 to 5 letters (`BRK.B`); the API
  could not answer (any of the four reads failing with something other than a 404 fails the whole try,
  nothing half-read is posted); or the API is paused. Pauses: **30 minutes** after a 401/403 (the key
  was refused), **3 minutes** after a 429, a 5xx, a network error or a timeout (10 s per read). Each
  pause is logged once: `DilutionTracker API refused the key (401); using the browser tab for facts for
  30 minutes`.
- Politeness: one ticker at a time, half a second apart, at most four reads per ticker, and never the
  same ticker twice within 5 minutes.
- Log lines say where the facts came from: `WETO: (API) country China, cash 49360000, months -, inst
  0.1%, float 14740000`, or `(tab)` for a page read. (Without a key the lines are as before, no tag.)
- Tests (a fake fetch and a fake key, no network): `npx vitest run lib/__tests__/gainersLookupApi.test.ts`.

## Borrow at TradeZero (#373)

A second loop in the same program fills the table's **Borrow at TZ** column: what it costs to borrow
each of today's gainers at TradeZero, per share. Rob has TradeZero's written permission to build an
application that shows borrow costs. Client: `tradezero.mjs`.

- The chat's `GET /api/chat/gainers/facts` lists, under `borrow`, the tickers with no answer yet today.
  The program checks only between 4 AM and 8 PM New York time on weekdays, one at a time.
- **Once per stock per day (#480).** TradeZero answers only about 100 locate quotes a day per key, then
  `429` "limit reached". So each ticker is checked **once** per New York day, whatever the answer (a
  price, ETB, none or an error), and never again that day: not on a later listing, not on a retry, not
  after a restart. The chat stops listing a ticker as soon as it has any answer for the day, too.
- **The daily limit (#480).** A `429` on a quote is never retried. The program then asks TradeZero
  nothing more that day and posts every ticker not checked yet as `status: "limit"`; the table shows
  **TZ daily limit reached** (muted, like "checking…"). The log says `TradeZero daily limit reached …`
  once. A new New York day starts fresh.
- Both are kept in `~/.config/longboard/gainers-lookup/borrow-day.json` (mode 600, no secrets; or
  `GAINERS_LOOKUP_BORROW_STATE_FILE`): `{ day, limitReachedAt, tickers: { TICKER: { result, posted } } }`.
  A ticker is written there *before* its quote goes out, so a stop mid-check counts as checked (an
  error). A result the chat didn't save is posted again next round; TradeZero isn't asked again. At
  start the log says `borrow: N tickers already checked at TradeZero today, not asked again`. If the
  file can't be written, nothing is asked of TradeZero until it can.
- A check: `is-easy-to-borrow` (free). If easy to borrow, that's the answer ("ETB"). Otherwise a quote
  for 100 shares, then the locate history every 1.5 s until the quote is offered (the cheapest of the
  pre-borrow row and the `.SU` single-use row for Reg SHO stocks), rejected or expired ("None"), or
  20 s pass (an error, not tried again today). The result goes to `POST /api/chat/gainers/facts` with
  `kind: "borrow"`.
- **It never takes a locate.** The client has only three requests (easy to borrow, quote, history);
  every request is checked against those addresses before it goes out, and
  `lib/__tests__/gainersBorrowTradeZero.test.ts` fails if any other locate address appears in the
  source, or if any accept address is ever requested. Offers are left to lapse, which costs nothing.
- Limits: at most one request a second, quotes at least 2 s apart (TradeZero allows 1/s) and 30 s apart
  for the same symbol. A 429 on a read (easy to borrow, history) waits and tries again twice; a 429 on
  a quote is the daily limit, above.
- Tests (a fake TradeZero, never the real one): `npx vitest run lib/__tests__/gainersBorrowTradeZero.test.ts
  lib/__tests__/gainersBorrowOnce.test.ts lib/__tests__/chatGainersBorrow.test.ts`.
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
- A failed read is tried again after 5, 10 and 20 minutes; after 4 tries the ticker is left until tomorrow.
  Logs say `<TICKER> news: …`.
- Parser: `parse.mjs` (`dtNewsSnapshot` runs inside the page; `parseDtNews` turns its rows into releases).
  Tests: `npx vitest run lib/__tests__/gainersLookupNews.test.ts`, and the in-page reader on a synthetic
  page in `scripts/tests/chat-news-feed-browser.mjs`.

## The DilutionTracker browser (#472)

The lookup reads DilutionTracker in a dedicated Chromium with its own profile. **The lookup never
starts, restarts or closes that browser, and never closes a tab.** Rob starts it once and leaves it open:

    chromium --user-data-dir=$HOME/.config/longboard/gainers-lookup/browser --remote-debugging-port=9333 --remote-debugging-address=127.0.0.1 --no-first-run https://dilutiontracker.com/

- It must be signed in to DilutionTracker (sign in once in that window; the profile keeps it).
- Leave it open. The lookup uses **a single tab** in it: the open dilutiontracker.com tab (the one the
  command above opens). It keeps one DevTools connection to that tab and moves it from company to
  company; the tab simply stays on the last company it read. It opens a tab only when the browser has
  no DilutionTracker tab at all (one tab, kept), never one per stock. If the connection drops it
  attaches to the same tab again. Code: `dt-tab.mjs`.
- If nothing answers on 9333 the log says `DilutionTracker browser not running on 9333; checking again
  every 2 minutes` once and the lookup waits, checking every 2 minutes (no tries are used up meanwhile).
  When the browser is back it says so and carries on with the tickers that showed up meanwhile.
- Optional: `lb-gainers-browser.service` in this folder starts that same command as a systemd user unit
  with the desktop session. It is not installed by anything; to use it:

      cp scripts/gainers-lookup/lb-gainers-browser.service ~/.config/systemd/user/
      systemctl --user daemon-reload
      systemctl --user enable --now lb-gainers-browser

- Tests (a fake DevTools server, no browser and no DilutionTracker requests):
  `npx vitest run lib/__tests__/gainersLookupOneTab.test.ts`.

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
`GAINERS_LOOKUP_CDP_URL` (default `http://127.0.0.1:9333`), `GAINERS_LOOKUP_TOKEN_FILE`,
`GAINERS_LOOKUP_DT_KEY_FILE` (default `~/.config/longboard/dilutiontracker.key`).
