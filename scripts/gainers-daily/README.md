# Daily gainers page (#340)

`run.py` runs on Rob's computer. Each weekday evening it checks the market had data, reads that day's
gainers alerts, fetches Polygon bars, saves the page through `/api/chat/gainers/daily`, then posts once
to LB Review as the Gainers Review bot. It lives in the repo so it is reviewed with the route it talks to.

- Secrets (never printed): `~/.config/longboard/lb-review/ingest.token`, `.../bot.token`, the Polygon
  key in `~/projects/market-dashboard/.env.local`, and Night Notes' token for failure notes.
- State: `~/.local/state/longboard-gainers/state.json` (first day, days done).
- Catch-up: weekdays since the first run that aren't done, up to 10 days back.
- Holidays: no market data and no alerts means no page and no post. No market data but alerts present
  tells Rob, because it may be an outage.
- Logs: `journalctl --user -u lb-gainers-daily`.
- Rerun a day, for example after adding a country: `python3 -I run.py --date YYYY-MM-DD`. The page is
  replaced. The post stays as first written.
- Tests: `python3 scripts/gainers-daily/test_run.py`.
