#!/usr/bin/env python3
"""#386: writes stock-club-levels.json, the fixture lib/__tests__/stockClubLevels.test.ts checks the
TypeScript level math against. The expected values come from scripts/gainers-daily/run.py itself
(chart_stock, with Polygon swapped for the synthetic bars below), so the two can't drift apart.

  python3 -I lib/__tests__/fixtures/make-stock-club-levels.py

Synthetic bars only; nothing is fetched.
"""
import datetime as D, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "scripts", "gainers-daily"))
import run  # noqa: E402

DAY = D.date(2026, 11, 6)
NY = run.NY


def ms(day, hour, minute=0):
    return int(D.datetime(day.year, day.month, day.day, hour, minute, tzinfo=NY).timestamp() * 1000)


# Hour bars from June 2 to the chart day: a stock sliding from about $9 to about $2 with waves, four
# bars a weekday (pre-market, open, afternoon, after hours), then a gap up on the chart day.
hours = []
d, i = D.date(2026, 6, 1), 0
while d <= DAY:
    if d.weekday() < 5:
        for h in (4, 9, 13, 19):
            base = 9 * math.exp(-i / 220) + 0.6 * math.sin(i / 11)
            if d == DAY:
                base = 3.4 + 0.1 * (h - 4)
            o = round(base, 4)
            c = round(base + 0.05 * math.sin(i), 4)
            hours.append(dict(t=ms(d, h), o=o, h=round(max(o, c) + 0.12, 4), l=round(min(o, c) - 0.12, 4), c=c, v=1000 + i))
            i += 1
    d += D.timedelta(days=1)

two_minute = [dict(t=ms(DAY, 9, 30) + k * 120000, o=3.4, h=3.5, l=3.3, c=3.45, v=500) for k in range(10)]


def fake(key, sym, mult, span, fr, to):
    return hours if span == "hour" else two_minute


run.polygon_get = fake
chart = run.chart_stock("KEY", dict(sym="TEST"), DAY)
out = dict(
    day=str(DAY),
    hours=[dict(t=r["t"], h=r["h"], l=r["l"], c=r["c"]) for r in hours],
    expected=dict(cmp=chart["cmp"], missed=chart["missed"]),
)
with open(os.path.join(HERE, "stock-club-levels.json"), "w") as f:
    json.dump(out, f)
print(json.dumps(out["expected"]))
