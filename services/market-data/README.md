# Longboard Market Data Service

Foundation for the realtime market-data bridge.

This service is intentionally small in this first slice. It exposes health
checks and proves the deploy/runtime shape. Massive / Polygon WebSocket and
Ably publishing will be added in follow-up slices.

## Architecture

See [docs/architecture/realtime-market-data.md](../../docs/architecture/realtime-market-data.md).

## Local Development

From this directory:

```bash
npm install
npm run dev
```

Health checks:

```bash
curl http://localhost:8080/health
curl http://localhost:8080/ready
```

## Environment

Current foundation env:

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MARKET_DATA_PORT` | no | `8080` | HTTP health server port |
| `PORT` | no | unset | Fallback port, useful on some hosts |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, or `error` |
| `SERVICE_VERSION` | no | `dev` | Version string emitted in health/logs |

Future streaming env:

| Name | Purpose |
| --- | --- |
| `POLYGON_API_KEY` | Massive / Polygon upstream WebSocket auth |
| `ABLY_API_KEY` | Ably server-side publishing |

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
