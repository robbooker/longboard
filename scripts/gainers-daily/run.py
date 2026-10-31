#!/usr/bin/env python3
"""#340: builds each trading day's gainers page and posts it once to the LB Review room.

Runs on Rob's computer from a systemd user timer (see README.md). Standard library only.

  run.py                         every trading day still waiting, oldest first (the timer's job)
  run.py --date 2026-10-30       just that day, even if done before; replaces the page, never posts twice
  run.py --date D --notes-file F  the same, with {TICKER: note} lines only a person knows
  run.py --date D --dry-run --out DIR [--alerts-file F] [--notes-file F]
                                 builds and writes DIR/payload.json and DIR/post.txt; nothing is sent

Same calculations as the approved gainers-charts skill (fetch_day.py). Read-only for trading.
A day is a trading day when the market had data for it. Failures post nothing and tell Rob by DM.
"""
import argparse, datetime as D, fcntl, json, os, re, sys, urllib.error, urllib.parse, urllib.request, uuid
from zoneinfo import ZoneInfo

HOME = os.path.expanduser("~")
NY = ZoneInfo("America/New_York")
MIN_VOLUME, CHARTS = 150000, 6
RUN_FROM_HOUR = 20  # Today only counts once the extended session has ended at 8 PM Eastern.
CATCH_UP_DAYS = 10
ROOM = "lb-review"
CHAT_URL = os.environ.get("GAINERS_CHAT_URL", "https://chat.robbooker.com")
POLYGON_URL = os.environ.get("GAINERS_POLYGON_URL", "https://api.polygon.io")
NOTIFY_URL = os.environ.get("GAINERS_NOTIFY_URL", "https://company.robbooker.com/api/agent/messages")
STATE_DIR = os.environ.get("GAINERS_STATE_DIR", f"{HOME}/.local/state/longboard-gainers")
DAILY_TOKEN_FILE = os.environ.get("GAINERS_DAILY_TOKEN_FILE", f"{HOME}/.config/longboard/lb-review/ingest.token")
BOT_TOKEN_FILE = os.environ.get("GAINERS_BOT_TOKEN_FILE", f"{HOME}/.config/longboard/lb-review/bot.token")
NOTIFY_TOKEN_FILE = os.environ.get("GAINERS_NOTIFY_TOKEN_FILE", f"{HOME}/.config/company-dashboard/agents/night-notes.token")
POLYGON_ENV_FILE = os.environ.get("GAINERS_POLYGON_ENV", f"{HOME}/projects/market-dashboard/.env.local")
COUNTRIES_FILE = os.environ.get("GAINERS_COUNTRIES", f"{HOME}/Documents/AGENT WORK/longboard-dev-tools/company-countries.json")
UA = "longboard-gainers-daily/1"


class Failed(Exception):
    """A plain-English reason to stop this day. It never holds a key or a URL."""


def read_secret(path, what):
    try:
        with open(path) as f:
            value = f.read().strip()
    except OSError:
        raise Failed(f"The {what} file can't be read.")
    if not value:
        raise Failed(f"The {what} file is empty.")
    return value


def polygon_key():
    try:
        with open(POLYGON_ENV_FILE) as f:
            for line in f:
                if line.startswith("POLYGON_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    raise Failed("The Polygon key can't be read.")


def http(url, what, headers=None, body=None):
    """One retry on a network error or 5xx. Errors name the step, never the URL, which can hold a key."""
    data = json.dumps(body).encode() if body is not None else None
    request_headers = {"User-Agent": UA, **(headers or {})}
    if data is not None:
        request_headers["Content-Type"] = "application/json"
    problem = None
    for _ in range(2):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=request_headers), timeout=120) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            try:
                detail = json.load(e)
            except Exception:
                detail = {}
            if e.code < 500:
                return e.code, detail
            problem = f"HTTP {e.code}"
        except Exception as e:
            problem = type(e).__name__
    raise Failed(f"{what} failed ({problem}).")


def polygon_get(key, sym, mult, span, fr, to):
    sym = urllib.parse.quote(sym.replace(" ", "."))
    url = f"{POLYGON_URL}/v2/aggs/ticker/{sym}/range/{mult}/{span}/{fr}/{to}?adjusted=true&sort=asc&limit=50000&apiKey={key}"
    rows = []
    while url:  # next_url must be followed, or long history is silently cut short
        status, j = http(url, f"Polygon for {sym}")
        if status != 200:
            raise Failed(f"Polygon for {sym} answered HTTP {status}.")
        rows += j.get("results") or []
        url = j.get("next_url")
        url = f"{url}&apiKey={key}" if url else None
    return rows


def etd(ms):
    return D.datetime.fromtimestamp(ms / 1000, NY)


def market_had_data(key, day):
    """SPY traded during regular hours that day. An outage raises instead of reading as a holiday."""
    for r in polygon_get(key, "SPY", 1, "hour", day, day):
        et = etd(r["t"])
        if et.strftime("%Y-%m-%d") == str(day) and 9 <= et.hour < 16:
            return True
    return False


def num(s):
    return float(s.replace(",", ""))


def iso_ts(ts):
    return D.datetime.fromisoformat(re.sub(r"\+00$", "+00:00", ts.replace(" ", "T", 1))).astimezone(D.timezone.utc).isoformat().replace("+00:00", "Z")


def rank_alerts(rows):
    """Step 1 of the skill: one entry per stock, no after-hours, counted from the first 150K+ alert."""
    alerts, skipped = {}, 0
    for r in rows:
        b = r["body"]
        m = re.match(r"🚨 ([A-Z. ]+?) \(\+([\d.]+)%\)", b)
        px = re.search(r"Extended Price: \$([\d.]+)", b) or re.search(r"Price: \$([\d.]+)", b)
        cap = re.search(r"Market Cap: ([\d.,]+)([KMB]?)", b)
        v = re.search(r"Volume: ([\d,]+)", b)
        if not (m and px and v):
            skipped += 1
            continue
        capv = num(cap[1]) * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[cap[2]] if cap else 0
        sess = "pre" if "Pre-Market" in b else "after" if "After-Hours" in b else "day"
        alerts.setdefault(m[1], []).append(dict(ts=iso_ts(r["ts"]), pct=float(m[2]), px=float(px[1]), vol=int(num(v[1])), cap=capv, sess=sess))
    total, out = len(alerts), []
    for sym, a in alerts.items():
        a = [x for x in a if x["sess"] != "after"]
        q = [x for x in a if x["vol"] >= MIN_VOLUME]
        if q:
            out.append(dict(sym=sym, alerts=a, first=q[0], peak=max(x["pct"] for x in a), last=a[-1]))
    out.sort(key=lambda x: -x["peak"])
    return total, out, skipped


def next_month(k):
    y, mo = map(int, k.split("-"))
    mo += 1
    if mo > 12:
        y, mo = y + 1, 1
    return f"{y}-{mo:02d}"


def chart_stock(key, o, day):
    """Bars, 200 SMA, VWAP, monthly pivot and missed pivots. None when the stock has no bars that day."""
    day_s = str(day)
    raw = polygon_get(key, o["sym"], 2, "minute", day - D.timedelta(days=20), day)
    closes = [r["c"] for r in raw]
    bars, sma, vwap, cv, ct, lo, hi = [], [], [], 0, 0, None, None
    for i, r in enumerate(raw):
        et = etd(r["t"])
        if et.strftime("%Y-%m-%d") != day_s:
            continue
        ct += (r["h"] + r["l"] + r["c"]) / 3 * r["v"]
        cv += r["v"]
        t = int(et.replace(tzinfo=D.timezone.utc).timestamp())
        bars.append([t, round(r["o"], 4), round(r["h"], 4), round(r["l"], 4), round(r["c"], 4), round(r["v"])])
        lo = r["l"] if lo is None else min(lo, r["l"])
        hi = r["h"] if hi is None else max(hi, r["h"])
        if i >= 199:
            sma.append([t, round(sum(closes[i - 199 : i + 1]) / 200, 4)])
        if cv:
            vwap.append([t, round(ct / cv, 4)])
    if not bars:
        return None
    hours = polygon_get(key, o["sym"], 1, "hour", day - D.timedelta(days=1130), day)
    months = {}
    for r in hours:
        k = etd(r["t"]).strftime("%Y-%m")
        m = months.setdefault(k, dict(h=r["h"], l=r["l"], c=r["c"]))
        m["h"], m["l"], m["c"] = max(m["h"], r["h"]), min(m["l"], r["l"]), r["c"]
    cur, cmp_, missed = day_s[:7], None, []
    for k, m in sorted(months.items()):
        act = next_month(k)
        if act > cur:
            continue
        p = (m["h"] + m["l"] + m["c"]) / 3
        if act == cur:
            cmp_ = p
            continue
        touched = False
        for r in hours:
            ds = etd(r["t"]).strftime("%Y-%m-%d")
            if ds[:7] >= act and ds < day_s and r["l"] <= p <= r["h"]:
                touched = True
                break
        if not touched:
            missed.append(dict(price=p, month=D.date(int(act[:4]), int(act[5:]), 1).strftime("%b %y")))
    return dict(cmp=cmp_, missed=sorted(missed, key=lambda x: x["price"]), historyFrom=etd(hours[0]["t"]).strftime("%Y-%m-%d") if hours else None, lo=lo, hi=hi, bars=bars, sma=sma, vwap=vwap)


def first_alert(a):
    return dict(ts=a["ts"], px=a["px"], vol=a["vol"], sess=a["sess"])


def build_page(key, day, rows, countries, notes=None):
    notes = notes or {}
    total, ranked, skipped = rank_alerts(rows)
    country = lambda s: (countries.get(s) or {}).get("country") or "Unknown"
    top, nobars = [], []
    for o in ranked:
        if len(top) == CHARTS:
            break
        chart = chart_stock(key, o, day)
        if not chart:
            nobars.append(o["sym"])
            continue
        top.append(dict(sym=o["sym"], country=country(o["sym"]), peak=o["peak"], alertCount=len(o["alerts"]), first=first_alert(o["first"]), lastCap=o["last"]["cap"], note=notes.get(o["sym"]), **chart))
    chosen = {s["sym"] for s in top}
    rest = [dict(sym=o["sym"], country=country(o["sym"]), peak=o["peak"], first=first_alert(o["first"]), lastCap=o["last"]["cap"]) for o in ranked if o["sym"] not in chosen and o["sym"] not in nobars]
    page = dict(day=str(day), total=total, top=top, rest=rest)
    report = dict(unknown=sorted(s["sym"] for s in top + rest if s["country"] == "Unknown"), skipped=skipped, nobars=nobars)
    return page, report


def post_text(page):
    day = D.date.fromisoformat(page["day"])
    tickers = "\n".join(f"{s['sym']} ({s['country']})" for s in page["top"])
    return f"{day.strftime('%A')}'s top gainers, {day.strftime('%b')} {day.day}, {day.year}\n{tickers}\n{CHAT_URL}/gainers/{page['day']}"


def client_id(kind, day, extra=""):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"longboard-gainers:{kind}:{day}:{extra}"))


def read_alerts(day):
    status, j = http(f"{CHAT_URL}/api/chat/gainers/daily?alerts={day}", "Reading the gainers alerts", {"Authorization": f"Bearer {read_secret(DAILY_TOKEN_FILE, 'daily token')}"})
    if status != 200 or not isinstance(j.get("rows"), list):
        raise Failed(f"Reading the gainers alerts answered HTTP {status}.")
    return j["rows"]


def save_page(page):
    status, j = http(f"{CHAT_URL}/api/chat/gainers/daily", "Saving the page", {"Authorization": f"Bearer {read_secret(DAILY_TOKEN_FILE, 'daily token')}"}, page)
    if status != 200 or j.get("saved") is not True or j.get("day") != page["day"]:
        raise Failed(f"Saving the page answered HTTP {status} ({j.get('error', 'no detail')}).")


def post_to_room(page):
    """The same day always sends the same clientId, so the server can only ever keep one post."""
    body = {"room": ROOM, "action": "send", "body": post_text(page), "clientId": client_id("post", page["day"])}
    status, j = http(f"{CHAT_URL}/api/chat", "Posting to LB Review", {"Authorization": f"Bearer {read_secret(BOT_TOKEN_FILE, 'bot token')}"}, body)
    if status == 200 and isinstance(j.get("message"), dict):
        return
    if status == 409 and j.get("error") == "send_conflict":  # Already posted, with older wording. Leave it.
        return
    raise Failed(f"Posting to LB Review answered HTTP {status} ({j.get('error', 'no detail')}).")


def notify(body, cid):
    try:
        status, _ = http(NOTIFY_URL, "Telling Rob", {"Authorization": f"Bearer {read_secret(NOTIFY_TOKEN_FILE, 'Night Notes token')}"}, {"dm": "rob", "body": body[:7900], "clientId": cid})
        if status >= 300:
            print(f"could not tell Rob: HTTP {status}", file=sys.stderr)
    except Failed as e:
        print(f"could not tell Rob: {e}", file=sys.stderr)


def report_lines(day, report):
    lines = []
    if report["unknown"]:
        lines.append(f"Countries not on the saved list, shown as Unknown: {', '.join(report['unknown'])}. Add them to company-countries.json, then rerun with --date {day}.")
    if report["skipped"]:
        lines.append(f"{report['skipped']} alerts could not be read and were left out.")
    if report["nobars"]:
        lines.append(f"No chart data, left out: {', '.join(report['nobars'])}.")
    return lines


def process_day(key, day, notes=None):
    """Returns 'posted' or 'holiday'. Raises Failed before anything is posted when a step fails."""
    rows = read_alerts(day)
    if not market_had_data(key, day):
        if rows:
            raise Failed(f"Polygon shows no market data, but the gainers room has {len(rows)} alerts that day. Nothing was posted. If it was a real holiday, ignore this.")
        return "holiday"
    with open(COUNTRIES_FILE) as f:
        countries = json.load(f)
    page, report = build_page(key, day, rows, countries, notes)
    if not page["top"]:
        raise Failed(f"The market traded but no stock passed the 150,000-share rule ({len(rows)} alerts read). The alert feed may be down. Nothing was posted.")
    save_page(page)
    post_to_room(page)
    lines = report_lines(day, report)
    if lines:
        notify(f"Gainers page for {day} is posted.\n" + "\n".join(lines), client_id("report", day, "|".join(lines)))
    return "posted"


def load_state():
    try:
        with open(f"{STATE_DIR}/state.json") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def save_state(state):
    tmp = f"{STATE_DIR}/state.json.tmp"
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, f"{STATE_DIR}/state.json")


def latest_day(now):
    return now.date() if now.hour >= RUN_FROM_HOUR else now.date() - D.timedelta(days=1)


def waiting_days(state, now):
    """Weekdays not done yet, from the first run onward. Weekends never reach the market check."""
    latest = latest_day(now)
    start = D.date.fromisoformat(state["start"]) if state.get("start") else latest
    start = max(start, latest - D.timedelta(days=CATCH_UP_DAYS))
    done = set(state.get("done", []))
    days, d = [], start
    while d <= latest:
        if d.weekday() < 5 and str(d) not in done:
            days.append(d)
        d += D.timedelta(days=1)
    return days


def run_waiting(key, now):
    state = load_state()
    state.setdefault("start", str(latest_day(now)))
    failures = 0
    for day in waiting_days(state, now):
        try:
            print(day, process_day(key, day))
        except Exception as e:  # One bad day never stops the others, and Rob hears once per day.
            failures += 1
            reason = str(e) if isinstance(e, Failed) else f"The job hit an error ({type(e).__name__})."
            print(day, "FAILED", reason, file=sys.stderr)
            notify(f"Gainers page for {day} did not go out. {reason} See: journalctl --user -u lb-gainers-daily", client_id("failure", day))
            continue
        state["done"] = sorted(set(state.get("done", []) + [str(day)]))[-60:]
        save_state(state)
    save_state(state)
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", type=D.date.fromisoformat)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--alerts-file")
    ap.add_argument("--notes-file")
    args = ap.parse_args()
    if args.dry_run and not (args.date and args.out):
        ap.error("--dry-run needs --date and --out")
    if args.alerts_file and not args.dry_run:
        ap.error("--alerts-file only works with --dry-run")
    if args.notes_file and not args.date:
        ap.error("--notes-file needs --date")
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(f"{STATE_DIR}/lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("another run is going; leaving it to that one")
            return 0
        try:
            key = polygon_key()
            notes = json.load(open(args.notes_file)) if args.notes_file else None
            if args.dry_run:
                rows = json.load(open(args.alerts_file)) if args.alerts_file else read_alerts(args.date)
                page, report = build_page(key, args.date, rows, json.load(open(COUNTRIES_FILE)), notes)
                os.makedirs(args.out, exist_ok=True)
                json.dump(page, open(f"{args.out}/payload.json", "w"))
                open(f"{args.out}/post.txt", "w").write(post_text(page) if page["top"] else "")
                print(json.dumps(report))
                return 0
            if args.date:
                print(args.date, process_day(key, args.date, notes))
                return 0
            return run_waiting(key, D.datetime.now(NY))
        except Failed as e:
            print("FAILED", e, file=sys.stderr)
            day = args.date or D.datetime.now(NY).date()
            notify(f"Gainers job did not finish for {day}. {e}", client_id("failure", day))
            return 1
        except Exception as e:  # A bug or bad data: same promise, nothing broken posted and Rob hears.
            print("FAILED", type(e).__name__, file=sys.stderr)
            day = args.date or D.datetime.now(NY).date()
            notify(f"Gainers job crashed for {day} ({type(e).__name__}). Nothing more was posted. See: journalctl --user -u lb-gainers-daily", client_id("crash", day))
            return 1


if __name__ == "__main__":
    sys.exit(main())
