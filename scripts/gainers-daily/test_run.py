#!/usr/bin/env python3
"""#340: tests for run.py against fake chat, Polygon and notify servers. No real service is reached."""
import datetime as D, http.server, json, os, sys, tempfile, threading, urllib.parse

tmp = tempfile.mkdtemp(prefix="gainers-test-")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
for name, value in {"daily": "d" * 40, "bot": "lbc_b", "notify": "n"}.items():
    open(f"{tmp}/{name}", "w").write(value)
open(f"{tmp}/env", "w").write('POLYGON_API_KEY="SECRETKEY"\n')
json.dump({"AAA": {"country": "China"}}, open(f"{tmp}/countries.json", "w"))

World = {}
def reset():
    World.update(alerts={}, market=set(), fail=None, posts={}, pages={}, notes=[], polygon_calls=0)

def alert(sym, pct=50, vol=200000, session="", hour=15):
    return {"ts": f"2026-10-30 {hour}:00:00+00", "body": f"🚨 {sym} (+{pct}%)\nPrice: $2.50\nVolume: {vol:,}\nMarket Cap: 10.5M{session}"}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path == "/api/chat/gainers/daily":
            return self.reply(200, {"rows": World["alerts"].get(q["alerts"][0], [])})
        World["polygon_calls"] += 1
        if World["fail"] == "polygon":
            return self.reply(500, {})
        p = u.path.split("/")
        fr, to, sym = p[-2], p[-1], p[4]
        results = []
        if to in World["market"]:
            t = int(D.datetime.fromisoformat(f"{to}T15:00:00+00:00").timestamp() * 1000)
            results = [{"t": t, "o": 2, "h": 3, "l": 1, "c": 2.5, "v": 1000}]
        self.reply(200, {"results": results})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path == "/api/chat/gainers/daily":
            if World["fail"] == "save":
                return self.reply(400, {"error": "invalid_page"})
            World["pages"][body["day"]] = body
            return self.reply(200, {"saved": True, "day": body["day"]})
        if self.path == "/api/chat":
            if World["fail"] == "post":
                return self.reply(423, {"error": "chat_paused"})
            prior = World["posts"].get(body["clientId"])
            if prior and prior != body["body"]:
                return self.reply(409, {"error": "send_conflict"})
            World["posts"][body["clientId"]] = body["body"]
            return self.reply(200, {"message": {"id": "m"}})
        World["notes"].append(body)
        self.reply(200, {})

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_port}"
os.environ.update(GAINERS_CHAT_URL=url, GAINERS_POLYGON_URL=url, GAINERS_NOTIFY_URL=url + "/notify", GAINERS_STATE_DIR=f"{tmp}/state",
    GAINERS_DAILY_TOKEN_FILE=f"{tmp}/daily", GAINERS_BOT_TOKEN_FILE=f"{tmp}/bot", GAINERS_NOTIFY_TOKEN_FILE=f"{tmp}/notify",
    GAINERS_POLYGON_ENV=f"{tmp}/env", GAINERS_COUNTRIES=f"{tmp}/countries.json")
import run  # noqa: E402

FRI = D.date(2026, 10, 30)
NY = run.NY
at = lambda y, m, d, h: D.datetime(y, m, d, h, 20, tzinfo=NY)
os.makedirs(os.environ["GAINERS_STATE_DIR"], exist_ok=True)
state_file = f"{tmp}/state/state.json"
checks = 0
def eq(a, b, what):
    global checks
    assert a == b, f"{what}: {a!r} != {b!r}"
    checks += 1
def fresh(start=None):
    reset()
    if os.path.exists(state_file): os.unlink(state_file)
    if start: run.save_state({"start": start})

# The rules: 150K, no after hours, peak across kept alerts, top six, Unknown country.
total, ranked, skipped = run.rank_alerts([alert("AAA", 30, 100000), alert("AAA", 40), alert("BBB", 90, 100000), alert("CCC", 99, 900000, " After-Hours"), {"ts": "2026-10-30 15:00:00+00", "body": "junk"}])
eq(total, 3, "stocks seen"); eq([o["sym"] for o in ranked], ["AAA"], "only over 150K and not after hours"); eq(skipped, 1, "unreadable")
eq(ranked[0]["first"]["pct"], 40.0, "signal is the first alert over 150K"); eq(ranked[0]["peak"], 40.0, "peak")
eq(run.rank_alerts([alert("PRE", 10, session=" Pre-Market")])[1][0]["first"]["sess"], "pre", "pre-market kept")
eq(run.iso_ts("2026-10-30 14:22:38+00"), "2026-10-30T14:22:38Z", "short offset"); eq(run.iso_ts("2026-10-30T14:22:38.5+00:00"), "2026-10-30T14:22:38.500000Z", "route offset")

# Which days wait.
eq(run.latest_day(at(2026, 10, 30, 20)), FRI, "after 8 PM counts today"); eq(run.latest_day(at(2026, 10, 30, 19)), D.date(2026, 10, 29), "before 8 PM does not")
eq(run.waiting_days({}, at(2026, 10, 31, 9)), [FRI], "first run: just the last day; Saturday is never a day")
eq(run.waiting_days({"start": "2026-10-28", "done": ["2026-10-28"]}, at(2026, 11, 2, 21)), [D.date(2026, 10, 29), FRI, D.date(2026, 11, 2)], "catch-up skips the weekend")
eq(len(run.waiting_days({"start": "2026-01-01"}, at(2026, 11, 2, 21))), 7, "catch-up is capped")

# A real night: one post with the right date and link, twice over.
fresh(); World["alerts"]["2026-10-30"] = [alert("AAA"), alert("ZZZ", 20)]; World["market"].add("2026-10-30")
now = at(2026, 10, 30, 20)
eq(run.run_waiting("SECRETKEY", now), 0, "exit"); eq(len(World["posts"]), 1, "one post")
text = next(iter(World["posts"].values()))
eq(text, f"Friday's top gainers, Oct 30, 2026\nAAA (China)\nZZZ (Unknown)\n{url}/gainers/2026-10-30", "post text")
eq(World["pages"]["2026-10-30"]["top"][1]["country"], "Unknown", "unknown shown")
eq(len(World["notes"]), 1, "unknown reported"); assert "ZZZ" in World["notes"][0]["body"]; checks += 1
calls = World["polygon_calls"]; run.run_waiting("SECRETKEY", now); eq(World["polygon_calls"], calls, "a later try the same night does nothing")
eq(run.process_day("SECRETKEY", FRI), "posted", "forced rerun"); eq(len(World["posts"]), 1, "forced rerun: still one post")
json.dump({"ZZZ": {"country": "Peru"}, "AAA": {"country": "China"}}, open(os.environ["GAINERS_COUNTRIES"], "w"))
run.COUNTRIES_FILE = os.environ["GAINERS_COUNTRIES"]; eq(run.process_day("SECRETKEY", FRI), "posted", "rerun with a new country")
eq(len(World["posts"]), 1, "changed wording: still one post"); eq(World["pages"]["2026-10-30"]["top"][1]["country"], "Peru", "page replaced")

# Weekend: no call to anything. Holiday: no post, no note, and not asked again.
fresh("2026-10-31"); eq(run.run_waiting("SECRETKEY", at(2026, 11, 1, 21)), 0, "weekend"); eq(World["polygon_calls"], 0, "weekend reads nothing"); eq(World["posts"], {}, "weekend posts nothing")
fresh(); eq(run.run_waiting("SECRETKEY", now), 0, "holiday"); eq((World["posts"], World["pages"], World["notes"]), ({}, {}, []), "holiday is silent")
eq(json.load(open(state_file))["done"], ["2026-10-30"], "holiday is settled")

# Failures: nothing broken posted, Rob told once, the day stays waiting and a later try finishes it.
for fail, phrase in (("polygon", "Polygon"), ("save", "Saving"), ("post", "Posting")):
    fresh(); World["alerts"]["2026-10-30"] = [alert("AAA")]; World["market"].add("2026-10-30"); World["fail"] = fail
    eq(run.run_waiting("SECRETKEY", now), 1, f"{fail} exit"); eq(World["posts"], {}, f"{fail} posts nothing")
    assert phrase in World["notes"][0]["body"] and "SECRETKEY" not in json.dumps(World["notes"]); checks += 1
    cid = World["notes"][0]["clientId"]; run.run_waiting("SECRETKEY", now); eq(World["notes"][1]["clientId"], cid, f"{fail}: same note id, so Rob hears once")
    World["fail"] = None; World["notes"].clear(); eq(run.run_waiting("SECRETKEY", now), 0, f"{fail} recovers"); eq(len(World["posts"]), 1, f"{fail} then one post")

# Market data missing while alerts exist may be an outage, so it is raised, not read as a holiday.
fresh(); World["alerts"]["2026-10-30"] = [alert("AAA")]
eq(run.run_waiting("SECRETKEY", now), 1, "suspicious"); eq(World["posts"], {}, "no post"); assert "no market data" in World["notes"][0]["body"]; checks += 1
# Traded, but nothing passes: raised, in case the alert feed is down.
fresh(); World["market"].add("2026-10-30"); World["alerts"]["2026-10-30"] = [alert("AAA", 10, 1000)]
eq(run.run_waiting("SECRETKEY", now), 1, "empty day"); eq((World["posts"], World["pages"]), ({}, {}), "nothing saved or posted")
# A crash on one day doesn't stop the next.
fresh("2026-10-29"); World["alerts"]["2026-10-29"] = [{"ts": "garbage", "body": alert("AAA")["body"]}]; World["alerts"]["2026-10-30"] = [alert("AAA")]; World["market"].update({"2026-10-29", "2026-10-30"})
eq(run.run_waiting("SECRETKEY", now), 1, "crash exit"); eq(list(World["pages"]), ["2026-10-30"], "next day still built"); assert "ValueError" in World["notes"][0]["body"]; checks += 1
print(f"PASS {checks} checks", flush=True)
os._exit(0)
