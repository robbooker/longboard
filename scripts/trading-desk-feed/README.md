# Trading Desk feed (#469)

`feed.mjs` runs on a home computer and keeps the chat's **Trading Desk** (the owner-only app in the
chat's Apps list) up to date with a TradeZero account: balances, day P&L, open positions and open
orders. Node 22 or newer, no packages to install.

## What it does

- Every **5 seconds** from 4 AM to 8 PM New York time on weekdays (pre-market through after-hours), and
  every **60 seconds** otherwise, it reads the account from TradeZero's web API, builds one snapshot and
  sends it to the chat (`POST /api/chat/trading-desk/feed`). The chat keeps only the latest one.
- In market hours it also listens to TradeZero's P&L stream (`/stream/pnl`). While the stream is
  sending, its numbers stand in for the P&L read (which is still done every 30 seconds).
- Each snapshot says when the computer last heard from TradeZero and whether the last read worked. The
  desk turns amber when the numbers get old (30 seconds in market hours, 2½ minutes otherwise) and
  shows the feed's problem, if it has one.
- When a read fails it waits 10 s, 20 s, 40 s ... up to 5 minutes before trying again (5 minutes at once
  if TradeZero refuses the key). The desk keeps showing the last good numbers, marked out of date.

## The read-only promise

This program **cannot trade**. It can't place, change or cancel an order, and it never touches locates.

- Every request to TradeZero goes through one function (`tz-readonly.mjs`) that refuses anything that
  isn't a **GET** to exactly one of these five addresses, for the account in the key file:

      GET /v1/api/accounts
      GET /v1/api/account/{accountId}
      GET /v1/api/accounts/{accountId}/positions
      GET /v1/api/accounts/{accountId}/pnl
      GET /v1/api/accounts/{accountId}/orders

  Any other method (POST, PUT, PATCH, DELETE ...), any other address (a single order, locates, routes,
  anything with a `?`), or a request with a body is refused before it is sent.
  `lib/__tests__/tradingDeskFeedGuard.test.ts` tests that gate and checks this folder's code for
  anything that could write.
- On the P&L stream, the only thing it ever sends is the sign-in TradeZero asks for
  (`{"key": ..., "secret": ...}`), once per connection. (TradeZero's docs also mention a subscribe
  message; it isn't sent. If the stream stays quiet without it, nothing is lost: the P&L comes from
  the regular reads.)
- Your key stays on your computer. The chat gets numbers only: never the key or secret, and never the
  **account number** (it's cut out of everything, and a snapshot that still mentions it isn't sent).
- It keeps well under TradeZero's limits (orders 2 a second, positions and P&L 3 a second, per key):
  one request at a time, at least a second apart, four a round. A "slow down" (429) waits and backs off.
  That leaves room for anything else using the same key.

## Your TradeZero key

Make an API key pair in the TradeZero Portal (the **API Keys** tab appears once the API agreements are
signed). **Paper keys work too**: a paper key pair reads your paper account, and the desk shows a
**Paper** badge instead of **Live**. Then put it in a file only you can read:

    mkdir -p ~/.config/longboard/trading-desk
    touch ~/.config/longboard/trading-desk/tradezero.env
    chmod 600 ~/.config/longboard/trading-desk/tradezero.env

with these three lines (your values, no quotes needed):

    TRADEZERO_API_KEY_ID=...
    TRADEZERO_API_SECRET_KEY=...
    TRADEZERO_ACCOUNT_ID=...

It uses the first of these files that exists, so a key you already keep for the borrow lookup works as
it is (the names `TZ_API_KEY_ID` / `TZ_API_SECRET` / `TZ_ACCOUNT_ID` are read too):

1. `~/.config/longboard/trading-desk/tradezero.env`
2. `~/Documents/AGENT WORK/cobra-das-bridge/.tz.env`
3. `~/.config/cobra-term/tradezero.env`

or just the file named by `TRADING_DESK_TZ_ENV_FILE`. The file must be private (`chmod 600`): the
program refuses one that other users could read. It never prints anything from it.

## The chat token

The chat only takes a snapshot that carries the feed's own token. Make one (any 32+ random characters):

    openssl rand -hex 32 > ~/.config/longboard/trading-desk/feed.token
    chmod 600 ~/.config/longboard/trading-desk/feed.token

and give the chat the same value as the server setting `CHAT_TRADING_DESK_FEED_TOKEN` (on Vercel:
Project, Settings, Environment Variables, Production). That token can only send snapshots: it can't
read the desk or anything else in the chat. (`TRADING_DESK_TOKEN_FILE` names another file.)

## Install

    cp scripts/trading-desk-feed/lb-trading-desk-feed.service ~/.config/systemd/user/
    systemctl --user daemon-reload
    systemctl --user enable --now lb-trading-desk-feed

It runs from `~/projects/longboard` (keep that checkout on `main`) with mise's Node; edit `ExecStart`
in the unit if yours is elsewhere. Logs: `journalctl --user -u lb-trading-desk-feed -f`. Stop it with
`systemctl --user stop lb-trading-desk-feed`; the desk then turns amber and says the numbers are old.

## Settings (environment, mostly for testing)

- `TRADING_DESK_CHAT_URL`: the chat (default `https://chat.robbooker.com`; https only, or http on this
  computer).
- `TRADING_DESK_TZ_BASE_URL`: TradeZero's address. Only `https://webapi.tradezero.com` (the same for
  paper and live keys) or a test server on this computer is accepted, so the key can't be sent anywhere
  else.
- `TRADING_DESK_STREAM=0`: don't use the P&L stream.

## Files

- `feed.mjs`: the rounds, the key and token files, the stream's schedule.
- `tz-readonly.mjs`: the read-only TradeZero client and its GET-only gate.
- `stream.mjs`: the P&L stream (sign-in only, then listen).
- `snapshot.mjs`: TradeZero's replies into the desk's shape, account number removed. A field TradeZero
  leaves out is sent as empty, and the desk shows "—" there.
- Tests (none of them talk to TradeZero; they use a fake server on this computer):
  `npx vitest run lib/__tests__/tradingDeskFeed`
