# Current Handoff

Last updated: May 5, 2026

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
- Live Massive -> service -> Ably -> subscriber verification passed with NVDA
  on May 5, 2026.
- `/lab/chart2` is being wired to consume Ably updates in the browser. The
  browser requests a short-lived subscribe-only token from
  `/api/ably/chart-token`.
- The web app needs `ABLY_API_KEY` in Vercel Preview/Production for that token
  endpoint. The browser never receives the raw Ably API key.

Verified live chain:

```text
massive_bar
ably_bar_published
subscriber receives {"event":"bar", ...}
```

The `/lab/chart2` browser wiring consumes Ably updates, shows CONNECTING /
LIVE / PAUSED / RECONNECTING state, and keeps REST backfill plus fallback
current-day polling when realtime is not live.

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

Essay sync is intentionally opt-in. Use `npm run sync:essays` when
`content/essays` needs to be pushed into Supabase; `npm run build` should not
mutate the database.

## Operating Model

- Create a fresh `feat/...` branch from updated `main`.
- Push the branch and open a PR.
- Codex can now create GitHub PRs and inspect Vercel deployments/logs.
- Human review remains the default merge checkpoint unless explicitly delegated.
