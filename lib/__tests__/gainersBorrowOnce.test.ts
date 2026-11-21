import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { borrowRound, createBorrowDay } from "../../scripts/gainers-lookup/lookup.mjs";
import { checkBorrow, createTradeZeroClient } from "../../scripts/gainers-lookup/tradezero.mjs";

// #480: each stock gets ONE TradeZero quote per Eastern day, whatever the answer, kept in a file so a
// restart never asks again; a 429 on a quote (TradeZero's daily limit) stops every request for the rest
// of the day. Everything here runs against a fake TradeZero (a fake fetch with a fake clock); no real
// request is ever sent.

const FRIDAY = Date.parse("2026-11-06T15:00:00Z"); // 10:00 AM in New York
const MONDAY = Date.parse("2026-11-09T15:00:00Z");

/** Every request any fake TradeZero in this file saw, to prove nothing ever took a locate. */
const everyPath: string[] = [];

type Answer = "etb" | "offered" | "none" | "error" | "limit" | "silent";

/** A fake TradeZero: answers per symbol, counts every request, and offers $0.04 on every quote. */
function fakeTradeZero(answers: Record<string, Answer> = {}, start = FRIDAY) {
  let t = start;
  const calls: { method: string; path: string; symbol: string | null; at: number }[] = [];
  const quotes: { quoteReqID: string; symbol: string }[] = [];
  const answer = (symbol: string): Answer => answers[symbol] ?? "offered";
  const fetch = async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const etbSymbol = path.match(/is-easy-to-borrow\/symbol\/(.+)$/)?.[1] ?? null;
    calls.push({ method, path, symbol: etbSymbol ?? body?.symbol ?? null, at: t });
    everyPath.push(`${method} ${path}`);
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (etbSymbol) return reply(200, { isEasyToBorrow: answer(etbSymbol) === "etb" });
    if (path.endsWith("/locates/quote")) {
      const a = answer(body.symbol);
      if (a === "limit") return reply(429, { message: "limit reached" });
      if (a === "error") return reply(500, {});
      quotes.push({ quoteReqID: body.quoteReqID, symbol: body.symbol });
      return reply(200, { locateQuoteSent: "true" });
    }
    if (path.endsWith("/locates/history"))
      return reply(
        200,
        quotes.flatMap((q) => {
          const a = answer(q.symbol);
          if (a === "silent") return [{ quoteReqID: q.quoteReqID, locateStatus: 54 }];
          if (a === "none") return [{ quoteReqID: q.quoteReqID, locateStatus: 56 }];
          return [{ quoteReqID: q.quoteReqID, locateStatus: 65, locatePrice: 0.04, locateType: 1 }];
        }),
      );
    return reply(404, {});
  };
  const now = () => t;
  const sleep = async (ms: number) => {
    t += ms;
  };
  let n = 0;
  const client = createTradeZeroClient({
    keyId: "synthetic-key-id",
    secret: "synthetic-secret",
    accountId: "TESTACCT1",
    fetch: fetch as typeof globalThis.fetch,
    now,
    sleep,
    newId: () => `q${++n}`,
  });
  return {
    client,
    calls,
    now,
    set: (at: number) => (t = at),
    check: (c: unknown, ticker: string) => checkBorrow(c, ticker, { now, sleep }),
    quotesFor: (symbol: string) => calls.filter((c) => c.path.endsWith("/locates/quote") && c.symbol === symbol).length,
    quoteCount: () => calls.filter((c) => c.path.endsWith("/locates/quote")).length,
  };
}

let dir = "";
let file = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lb-480-"));
  file = join(dir, "gainers-lookup", "borrow-day.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function harness(answers: Record<string, Answer> = {}, start = FRIDAY) {
  const tz = fakeTradeZero(answers, start);
  const posts: Record<string, unknown>[] = [];
  const lines: string[] = [];
  let failPosts = false;
  const post = async (body: Record<string, unknown>) => {
    if (failPosts) throw new Error("chat answered 503");
    posts.push(body);
    return { saved: true };
  };
  const day = () => createBorrowDay({ file, now: tz.now });
  let current = day();
  const round = (tickers: string[]) =>
    borrowRound({
      list: tickers.map((ticker) => ({ ticker })),
      client: tz.client,
      day: current,
      post,
      say: (line: string) => lines.push(line),
      check: tz.check,
      now: tz.now,
    });
  return {
    tz,
    posts,
    lines,
    round,
    restart: () => (current = day()),
    failPosts: (on: boolean) => (failPosts = on),
    statusOf: (ticker: string) => posts.filter((p) => p.ticker === ticker).map((p) => p.status),
  };
}

describe("one TradeZero quote per stock per day (#480)", () => {
  it("quotes each symbol once, however often the chat lists it", async () => {
    const h = harness();
    await h.round(["AAA", "BBB"]);
    for (let i = 0; i < 5; i++) {
      h.tz.set(h.tz.now() + 5 * 60_000);
      await h.round(["BBB", "AAA", "BBB", "CCC"]);
    }
    expect(h.tz.quotesFor("AAA")).toBe(1);
    expect(h.tz.quotesFor("BBB")).toBe(1);
    expect(h.tz.quotesFor("CCC")).toBe(1);
    expect(h.posts.map((p) => [p.ticker, p.status, p.pricePerShare])).toEqual([
      ["AAA", "offered", 0.04],
      ["BBB", "offered", 0.04],
      ["CCC", "offered", 0.04],
    ]);
    // An easy-to-borrow answer is final for the day too (no second free read either).
    const etb = harness({ EEE: "etb" });
    await etb.round(["EEE"]);
    await etb.round(["EEE"]);
    expect(etb.tz.calls).toHaveLength(1);
    expect(etb.statusOf("EEE")).toEqual(["etb"]);
  });

  it("never quotes again after an error, an empty answer or no answer: not on the 5/10/20-minute retries either", async () => {
    const h = harness({ ERR: "error", NON: "none", SIL: "silent" });
    await h.round(["ERR", "NON", "SIL"]);
    expect(h.statusOf("ERR")).toEqual(["error"]);
    expect(h.statusOf("NON")).toEqual(["none"]);
    expect(h.statusOf("SIL")).toEqual(["error"]);
    const before = h.tz.calls.length;
    for (const minutes of [5, 10, 20, 15, 60, 120]) {
      h.tz.set(h.tz.now() + minutes * 60_000);
      await h.round(["ERR", "NON", "SIL"]);
    }
    expect(h.tz.calls).toHaveLength(before);
    expect(h.tz.quoteCount()).toBe(3); // one each: ERR's refused, NON's empty and SIL's unanswered quote
    expect([h.tz.quotesFor("ERR"), h.tz.quotesFor("NON"), h.tz.quotesFor("SIL")]).toEqual([1, 1, 1]);
  });

  it("a result the chat didn't save is posted again, without asking TradeZero again", async () => {
    const h = harness();
    h.failPosts(true);
    await h.round(["AAA"]);
    await h.round(["AAA"]);
    expect(h.posts).toHaveLength(0);
    h.failPosts(false);
    await h.round(["AAA"]);
    await h.round(["AAA"]);
    expect(h.statusOf("AAA")).toEqual(["offered"]);
    expect(h.tz.quotesFor("AAA")).toBe(1);
  });

  it("survives a restart: the checked list is in the file, written before the quote goes out", async () => {
    const h = harness();
    await h.round(["AAA"]);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.day).toBe("2026-11-06");
    expect(saved.tickers.AAA).toMatchObject({ posted: true, result: { status: "offered" } });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toMatch(/synthetic-secret|synthetic-key-id|TESTACCT1/);

    h.restart();
    await h.round(["AAA", "BBB"]);
    expect(h.tz.quotesFor("AAA")).toBe(1);
    expect(h.tz.quotesFor("BBB")).toBe(1);

    // A check cut short (written in, no answer yet) counts as checked: an error, never quoted again.
    const cut = JSON.parse(readFileSync(file, "utf8"));
    cut.tickers.CUT = { result: null, posted: false };
    writeFileSync(file, JSON.stringify(cut));
    h.restart();
    await h.round(["CUT", "AAA"]);
    expect(h.tz.quotesFor("CUT")).toBe(0);
    expect(h.statusOf("CUT")).toEqual(["error"]);
    expect(h.posts.find((p) => p.ticker === "CUT")).toEqual({ kind: "borrow", ticker: "CUT", status: "error", etb: null, pricePerShare: null, locateType: null });
  });

  it("writes a ticker in before its quote: if that write fails, TradeZero isn't asked", async () => {
    const tz = fakeTradeZero();
    writeFileSync(join(dir, "gainers-lookup"), "a file where the folder should be");
    const lines: string[] = [];
    await borrowRound({
      list: [{ ticker: "AAA" }],
      client: tz.client,
      day: createBorrowDay({ file, now: tz.now }),
      post: async () => ({}),
      say: (line: string) => lines.push(line),
      check: tz.check,
      now: tz.now,
    });
    expect(tz.calls).toHaveLength(0);
    expect(lines.join("\n")).toMatch(/not asking TradeZero/);
  });
});

describe("TradeZero's daily limit (#480)", () => {
  it("a 429 on a quote stops every request for the rest of the day; the rest show the limit", async () => {
    const h = harness({ BBB: "limit" });
    await h.round(["AAA", "BBB", "CCC"]);
    const callsAtLimit = h.tz.calls.length;
    // BBB's quote was asked once and not retried.
    expect(h.tz.quotesFor("BBB")).toBe(1);
    expect(h.statusOf("AAA")).toEqual(["offered"]);
    expect(h.statusOf("BBB")).toEqual(["limit"]);
    // CCC was never asked (not even the free easy-to-borrow read).
    expect(h.tz.calls.some((c) => c.symbol === "CCC")).toBe(false);
    expect(h.posts.find((p) => p.ticker === "CCC")).toEqual({ kind: "borrow", ticker: "CCC", status: "limit", etb: null, pricePerShare: null, locateType: null });
    expect(h.lines.filter((l) => /^TradeZero daily limit reached/.test(l))).toHaveLength(1);

    // Later gainers and later rounds: still nothing asked, each new ticker posted as "limit" once.
    h.tz.set(h.tz.now() + 3 * 3_600_000);
    await h.round(["DDD", "AAA", "CCC"]);
    await h.round(["DDD", "EEE"]);
    expect(h.tz.calls).toHaveLength(callsAtLimit);
    expect(h.statusOf("DDD")).toEqual(["limit"]);
    expect(h.statusOf("EEE")).toEqual(["limit"]);
    expect(h.statusOf("CCC")).toEqual(["limit"]);

    // A restart remembers it.
    expect(JSON.parse(readFileSync(file, "utf8")).limitReachedAt).toMatch(/^2026-11-06T15:00:\d\d\.\d{3}Z$/);
    h.restart();
    await h.round(["FFF"]);
    expect(h.tz.calls).toHaveLength(callsAtLimit);
    expect(h.statusOf("FFF")).toEqual(["limit"]);
  });
});

describe("a new trading day (#480)", () => {
  it("starts fresh: yesterday's tickers and yesterday's limit are forgotten", async () => {
    const h = harness({ BBB: "limit" });
    await h.round(["AAA", "BBB", "CCC"]);
    expect(h.tz.quoteCount()).toBe(2);
    const fresh = harness({}, MONDAY);
    await fresh.round(["AAA", "BBB", "CCC"]);
    expect([fresh.tz.quotesFor("AAA"), fresh.tz.quotesFor("BBB"), fresh.tz.quotesFor("CCC")]).toEqual([1, 1, 1]);
    expect(fresh.posts.map((p) => p.status)).toEqual(["offered", "offered", "offered"]);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.day).toBe("2026-11-09");
    expect(saved.limitReachedAt).toBeNull();
    expect(Object.keys(saved.tickers).sort()).toEqual(["AAA", "BBB", "CCC"]);
  });

  it("a program left running over the night rolls over by itself", async () => {
    const h = harness();
    await h.round(["AAA"]);
    h.tz.set(MONDAY);
    await h.round(["AAA"]);
    expect(h.tz.quotesFor("AAA")).toBe(2);
    // Outside market hours nothing is asked at all.
    h.tz.set(Date.parse("2026-11-10T02:00:00Z"));
    await h.round(["ZZZ"]);
    expect(h.tz.quotesFor("ZZZ")).toBe(0);
  });
});

describe("pacing and quote-only (#480)", () => {
  it("at most one request a second", async () => {
    const h = harness({ AAA: "none", BBB: "silent" });
    await h.round(["AAA", "BBB", "CCC"]);
    const gaps = h.tz.calls.slice(1).map((c, i) => c.at - h.tz.calls[i].at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1_000);
  });

  afterAll(() => {
    // Every request every fake TradeZero in this file saw: only the three read/quote addresses, and
    // never an accept (or anything else that takes, places or changes something).
    expect(everyPath.length).toBeGreaterThan(0);
    for (const path of everyPath) {
      expect(path).not.toMatch(/accept|sell|cancel|order|DELETE|PUT|PATCH/i);
      expect(path).toMatch(/^(GET \/v1\/api\/accounts\/TESTACCT1\/is-easy-to-borrow\/symbol\/[A-Z]+|POST \/v1\/api\/accounts\/locates\/quote|GET \/v1\/api\/accounts\/TESTACCT1\/locates\/history)$/);
    }
  });
});
