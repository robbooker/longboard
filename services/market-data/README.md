# Longboard Market Data Service

Foundation for the realtime market-data bridge.

The current service exposes health checks and can optionally connect to the
Massive / Polygon stocks WebSocket in log-only mode. It can also publish
normalized bars to Ably private chart channels.

## Architecture

See [docs/architecture/realtime-market-data.md](../../docs/architecture/realtime-market-data.md).

## Local Development

From this directory:

```bash
npm install
npm run dev
```

Log-only stream mode:

```bash
POLYGON_API_KEY=... MARKET_DATA_STREAM_MODE=log MARKET_DATA_SYMBOLS=NVDA,AAPL npm run dev
```

Log and publish to Ably:

```bash
POLYGON_API_KEY=... \
ABLY_API_KEY=... \
MARKET_DATA_STREAM_MODE=log \
MARKET_DATA_PUBLISH_MODE=ably \
MARKET_DATA_SYMBOLS=NVDA,AAPL \
npm run dev
```

Local Ably subscriber:

```bash
ABLY_API_KEY=... MARKET_DATA_SUBSCRIBE_SYMBOL=NVDA npm run subscribe
```

The default upstream endpoint is the Massive Business stocks WebSocket:
`wss://business.massive.com/stocks`. Override `MASSIVE_STOCKS_WS_URL` only when
testing another entitled feed.

Health checks:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

## Environment

Current env:

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MARKET_DATA_PORT` | no | `8080` | HTTP health server port |
| `PORT` | no | unset | Fallback port, useful on some hosts |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, or `error` |
| `SERVICE_VERSION` | no | `dev` | Version string emitted in health/logs |
| `MARKET_DATA_STREAM_MODE` | no | `disabled` | `disabled` or `log` |
| `MARKET_DATA_PUBLISH_MODE` | no | `disabled` | `disabled` or `ably` |
| `POLYGON_API_KEY` | when `log` | unset | Massive / Polygon upstream WebSocket auth |
| `ABLY_API_KEY` | when publish mode is `ably` | unset | Ably server-side publishing |
| `MARKET_DATA_SYMBOLS` | when `log` | unset | Comma-separated symbols, e.g. `NVDA,AAPL` |
| `MASSIVE_STOCKS_WS_URL` | no | `wss://business.massive.com/stocks` | Stocks WebSocket endpoint |
| `MARKET_DATA_RECONNECT_INITIAL_MS` | no | `1000` | Initial reconnect delay |
| `MARKET_DATA_RECONNECT_MAX_MS` | no | `30000` | Max reconnect delay |
| `MARKET_DATA_SUBSCRIBE_SYMBOL` | no | `NVDA` | Symbol used by `npm run subscribe` |
| `MARKET_DATA_SUBSCRIBE_CHANNEL` | no | `private:chart:{symbol}:1m` | Explicit channel for `npm run subscribe` |

Do not commit secrets. Use Fly secrets for production.

## Fly.io

The first target runtime is Fly.io:

```bash
fly apps create longboard-market-data
fly secrets set POLYGON_API_KEY=... ABLY_API_KEY=...
fly deploy
```

The app is configured with `min_machines_running = 1` because the upstream
market-data connection must be an always-on process.

## Current Stream Behavior

When `MARKET_DATA_STREAM_MODE=log`, the service:

1. Opens the Massive Business stocks WebSocket.
2. Authenticates with `POLYGON_API_KEY`.
3. Subscribes to minute aggregate channels: `AM.<SYMBOL>`.
4. Normalizes incoming aggregate-minute messages into Longboard bar shape.
5. Logs each normalized bar as `massive_bar`.
6. Publishes each bar to Ably when `MARKET_DATA_PUBLISH_MODE=ably`.

Ably channel names use:

```text
private:chart:{SYMBOL}:1m
```

Each message is published with event name `bar`.
