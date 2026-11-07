# Gainers Table lookup (#371)

`lookup.mjs` runs on Rob's computer and fills in the facts the chat's **Gainers Table** shows for each
stock that alerts in Gainers: country, estimated current cash with months of cash left (or "cash flow
positive"), and institutional ownership. All from DilutionTracker. Node 22+, no packages.

- Every ~20 seconds (every 5 minutes outside 4 AM to 8 PM New York time and at weekends) it asks
  `GET /api/chat/gainers/facts` which of today's tickers still need a lookup.
- For each one it opens `https://dilutiontracker.com/app/search/<TICKER>` in a new tab of the dedicated
  Chromium already running with remote debugging on `http://127.0.0.1:9333` (its own profile, signed in
  to DilutionTracker by Rob), reads the page text, closes the tab and posts the result to
  `POST /api/chat/gainers/facts`. It never clicks anything or opens any other address.
- One page at a time, at least 3 seconds apart, at most 60 an hour. A page that doesn't load is tried
  again after 2, 4, 8 ... minutes (at most an hour); the log then asks whether DilutionTracker is still
  signed in.
- Each ticker is looked up once. The chat asks for it again only when its cash is over 30 days old,
  or after 6 hours when DilutionTracker had no page for it. A known value is never replaced by an empty one,
  and a known country is never changed.
- The 331 countries in `company-countries.json` were loaded into the chat when the table shipped.

Files:

- Token (never printed): `~/.config/longboard/gainers-lookup/ingest.token`, mode 600 (the program refuses
  a file others can read). The same value is `CHAT_GAINERS_LOOKUP_TOKEN` in Vercel.
- Logs: `journalctl --user -u lb-gainers-lookup -f`.
- Parser: `parse.mjs` (tests: `npx vitest run lib/__tests__/gainersLookupParse.test.ts`).

Install:

    cp scripts/gainers-lookup/lb-gainers-lookup.service ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now lb-gainers-lookup

It runs from `~/projects/longboard`, so keep that checkout on `main`.

Settings (environment, for testing): `GAINERS_LOOKUP_CHAT_URL` (default `https://chat.robbooker.com`),
`GAINERS_LOOKUP_CDP_URL` (default `http://127.0.0.1:9333`), `GAINERS_LOOKUP_TOKEN_FILE`.
