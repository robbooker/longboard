# Current Handoff

Last updated: May 4, 2026

## Repo State

- `main` is the source of truth.
- PR #58 was merged: `/lab/rvol-april` now redirects to the static April RVOL
  dashboard at `/lab/rvol-april.html`.
- The root Next app typecheck now excludes `services/market-data`; that service
  has its own `package.json`, lockfile, and TypeScript build.
- Vercel deploys are under the `Longboard` Vercel team/project, not the older
  local `.vercel/project.json` team id.

## Shareable Lab Link

Production link:

```text
https://longboardai.com/lab/rvol-april
```

Implementation:

- Static HTML lives at `public/lab/rvol-april.html`.
- Clean lab route lives at `app/lab/rvol-april/route.ts`.
- The dashboard is mostly self-contained: inline CSS/JS and table data, with
  external Google Fonts and outbound TradingView links.

## Realtime Market Data

Current status:

- Backfill works on `/lab/chart` and `/lab/chart2`.
- Massive Business WebSocket connects at
  `wss://business.massive.com/stocks`.
- `services/market-data` can authenticate, subscribe to `AM.NVDA`, connect to
  Ably, and publish normalized bars when live aggregate bars arrive.
- The Ably subscriber helper connects to `private:chart:NVDA:1m`.
- We are intentionally waiting for eligible market activity before wiring the
  browser chart UI to Ably.

Next live verification should show all three events:

```text
massive_bar
ably_bar_published
subscriber receives {"event":"bar", ...}
```

After that passes, the next implementation slice is `/lab/chart2` realtime UI:
consume Ably updates, show LIVE / PAUSED / RECONNECTING state, and keep REST
refresh/backfill as fallback.

## Useful Verification

Root app:

```bash
npx next build
```

Market-data service:

```bash
cd services/market-data
npm run typecheck
npm run build
```

Known local caveat: `npm run build` at the repo root runs
`scripts/sync-essays.mjs` first and requires local Supabase env vars. In Vercel,
those env vars are present and essay sync runs before `next build`.

## Operating Model

- Create a fresh `feat/...` branch from updated `main`.
- Push the branch and open a PR.
- Codex can now create GitHub PRs and inspect Vercel deployments/logs.
- Human review remains the default merge checkpoint unless explicitly delegated.
