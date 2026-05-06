# Realtime Market Data Architecture

Status: active implementation, May 2026

## Current Handoff

Last updated: May 6, 2026

The realtime market-data work is now past the first live browser verification.
The current implementation path is adding second-aggregate forming candles so
the visible chart can update between official one-minute aggregate bars.

Completed:

- `/lab/chart` and `/lab/chart2` can backfill older candles when the user
  scrolls left.
- `/lab/chart2` uses live Massive / Polygon REST data for movers and bars,
  with a 60-second refresh fallback.
- `services/market-data` exists as a standalone Node/TypeScript service with
  health checks, readiness checks, Docker/Fly scaffolding, and structured logs.
- The service can connect to the Massive stocks WebSocket in log-only mode.
- The correct upstream WebSocket endpoint for the current Stocks Business plan
  is `wss://business.massive.com/stocks`.
- The service defaults to that Business endpoint.
- `/ready` becomes healthy only after the upstream WebSocket subscription is
  confirmed.
- The service can publish normalized final bars and second-aggregate forming
  updates to Ably private chart channels when
  `MARKET_DATA_PUBLISH_MODE=ably`.
- A local subscriber helper exists for verifying Ably `bar` and `forming_bar`
  messages.
- Ably connectivity has been smoke-tested: the subscriber connected to
  `private:chart:NVDA:1m`, and the service connected to Ably while also
  authenticating and subscribing to Massive Business feed channels.
- `/lab/chart2` consumes Ably updates in the browser and showed live NVDA
  chart movement from the service on May 5, 2026.

Verified locally:

```bash
cd /Users/claudebot/longboard/services/market-data
npm run typecheck
npm run build
```

Manual live smoke command:

```bash
cd /Users/claudebot/longboard/services/market-data
POLYGON_API_KEY=... \
ABLY_API_KEY=... \
MARKET_DATA_STREAM_MODE=log \
MARKET_DATA_PUBLISH_MODE=ably \
MARKET_DATA_SYMBOLS=NVDA \
npm run dev
```

Expected successful startup includes:

```text
massive_connected
massive_status status=auth_success
massive_subscribe_sent channels=AM.NVDA,A.NVDA
massive_status status=success upstreamMessage="subscribed to: AM.NVDA,A.NVDA"
ably_connected
```

Local subscriber command:

```bash
cd /Users/claudebot/longboard/services/market-data
ABLY_API_KEY=... MARKET_DATA_SUBSCRIBE_SYMBOL=NVDA npm run subscribe
```

If this is run outside market hours, it may subscribe successfully without
printing `massive_bar` events until eligible market activity resumes.

Live verification success means seeing final bar events:

```text
massive_bar
ably_bar_published
subscriber receives {"event":"bar", ...}
```

With forming candles enabled, active symbols may also show:

```text
massive_forming_bar
ably_forming_bar_published
subscriber receives {"event":"forming_bar", ...}
```

Next slice:

1. Verify second-aggregate forming candle updates during eligible market activity.
2. Keep REST refresh/backfill as the fallback if realtime disconnects.
3. Keep log-only mode as a safe debugging option.

Important cleanup note: root `npm run lint` currently triggers the Next lint
migration prompt, and root `npm run build` depends on local Supabase env vars
used by `scripts/sync-essays.mjs`. For market-data-only slices, verify inside
`services/market-data` first, then run the root build only when the required
local env vars are present.

## Decision

Longboard realtime charting will use a dedicated market-data service instead
of connecting the browser directly to Massive / Polygon.

```text
Massive / Polygon WebSocket
  -> Longboard Market Data Service
  -> Ably private realtime channels
  -> LongboardAI browser charts
```

The service is designed to run as a small always-on process, initially on
Fly.io. The browser app remains on Vercel. Historical backfill continues to
use the existing Polygon REST endpoints.

## Why This Shape

Direct browser-to-Massive WebSockets are not acceptable for production:

- they expose the market-data API key
- they multiply upstream WebSocket connections per browser tab
- they make reconnection and subscription control client-owned
- they make entitlement and observability harder

Vercel Functions are also the wrong home for the upstream market-data
connection because the bridge needs a long-lived process.

Ably is the fanout layer. It gives Longboard browser clients a managed
WebSocket surface while keeping the upstream Massive connection private and
centralized.

## Responsibilities

### Market Data Service

- connect to Massive / Polygon WebSocket using server-side credentials
- subscribe to allowed stock minute and second aggregate channels
- normalize incoming aggregate bars into final Longboard chart messages
- aggregate seconds into throttled forming-candle updates
- publish sanitized messages to Ably private channels
- reconnect with backoff when the upstream feed drops
- expose health and readiness endpoints
- emit structured logs for deploys, reconnects, subscriptions, and publishes

### Longboard Web App

- fetch initial historical bars over REST
- subscribe to Ably private channels for active chart tickers
- update the current candle or append a new candle in place
- keep the current REST refresh fallback
- avoid snapping to the right edge if the user has scrolled back

### Ably

- deliver chart updates to browsers over private channels
- absorb browser fanout
- avoid one browser tab becoming one Massive upstream subscription

## Channel Naming

Initial channel names should be explicit and narrow:

```text
private:chart:{symbol}:{resolution}
```

Examples:

```text
private:chart:NVDA:1m
private:chart:TSLA:1m
```

The first production slice should subscribe only to the active chart ticker.
Watchlist-wide realtime updates are a later step.

## Message Shape

Final chart messages use normalized aggregate bars:

```json
{
  "type": "bar",
  "symbol": "NVDA",
  "resolution": "1m",
  "time": 1777815000,
  "open": 121.01,
  "high": 121.25,
  "low": 120.98,
  "close": 121.18,
  "volume": 184522,
  "source": "massive",
  "status": "final",
  "receivedAt": "2026-05-03T18:30:00.000Z"
}
```

`time` is Unix seconds UTC, matching the existing `Bar` type used by
Lightweight Charts.

Second-aggregate forming updates use the same channel with event name
`forming_bar`:

```json
{
  "type": "forming_bar",
  "symbol": "NVDA",
  "resolution": "1m",
  "time": 1777815000,
  "open": 121.19,
  "high": 121.22,
  "low": 121.17,
  "close": 121.21,
  "volume": 4200,
  "source": "massive_second",
  "status": "forming",
  "receivedAt": "2026-05-03T18:30:12.000Z"
}
```

`forming_bar.volume` is the second-aggregate volume accumulated since the previous
forming-candle publish for that minute, not the full minute volume.

## Live Chart Rules

- Initial page load uses REST backfill.
- Realtime updates start after initial bars are present.
- If an incoming final `bar` has the same `time` as the last bar, replace that
  candle with the final aggregate.
- If an incoming final `bar` is newer than the last bar, append it.
- If an incoming `forming_bar` has the same `time` as an existing candle, keep
  the existing open, expand high/low, update close, and add the delta volume.
- If an incoming `forming_bar` is newer than the last bar, append it as a
  forming candle.
- If a gap is detected, trigger a REST refresh/backfill for the missing range.
- If the user is at the right edge, keep following live bars.
- If the user has scrolled back, do not pull them forward.
- Show an explicit LIVE / PAUSED / RECONNECTING state.
- If realtime fails, keep the current 60-second refresh fallback.

## Operational Rules

- The bridge must be safe to restart at any time.
- On boot, it should start empty and subscribe only when the web app requests
  or when an explicit configured symbol allowlist exists.
- On reconnect, it should resubscribe and let the browser REST backfill close
  any missed-bar gaps.
- Credentials live outside git in Fly secrets or equivalent.
- Logs must never include API keys.

## Future Decisions

- Whether subscriptions are driven by active browser demand, a fixed watchlist,
  or both.
- Whether to persist recent realtime bars in Supabase for replay.
- Whether to support per-second aggregates.
- Whether to move from Fly.io to AWS ECS/Fargate after the service proves its
  shape.

## Implementation Slices

1. Service skeleton with health checks.
2. Log-only Massive / Polygon WebSocket client.
3. Ably publishing in private channels.
4. Browser test subscriber that logs received bars.
5. Chart integration with LIVE / PAUSED / RECONNECTING state.
