import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createDtTab, cdpPort, isDilutionTrackerUrl } from "../../scripts/gainers-lookup/dt-tab.mjs";
import { BROWSER_WAIT_MS, createDaySchedule, createLookup, createPacer, waitAfterRound } from "../../scripts/gainers-lookup/lookup.mjs";
import { DT_NEWS_EXPRESSION } from "../../scripts/gainers-lookup/parse.mjs";

// #472: a fake Chromium DevTools endpoint (HTTP /json/* plus a tiny WebSocket server), so the lookup's
// one-tab handling is tested without any real browser or DilutionTracker request. Page texts are small
// synthetic ones in DilutionTracker's shape (never saved pages).

type Target = { id: string; type: string; url: string; mark: string | null };
type Browser = Awaited<ReturnType<typeof fakeBrowser>>;

const COUNTRY: Record<string, string> = { NEWA: "China", NEWB: "Greece", NEWC: "Hong Kong", NEWD: "U.S.", NEWE: "China" };
const pageText = (url: string) => {
  const ticker = decodeURIComponent(url.split("/").pop() ?? "");
  if (ticker === "SLOW") return ""; // never draws: the read times out as "loading"
  const country = COUNTRY[ticker] ?? "China";
  return (
    `DilutionTracker\nSector:IndustrialsIndustry:Building ProductsCountry:${country}Exchange:NASDAQ\n` +
    `Mkt Cap & EV:193.7M / 165.8MFloat & OS:0.55M / 16.46MEst. Net Cash/Sh:1.7Inst Own:0.1%SI:41.7%\n` +
    `Cash Need\nLow\nHistorical O/S\n\nCash Position\n\nThe company has 30.7 months of cash left based on quarterly cash burn of -$0.31M and estimated current cash of $31.5M.\n\n` +
    `12/31/2018\n06/30/2020\nOpCF\nCurrent Est\n0\n8\n            Millions of USD\nWarrant\n`
  );
};
const nyNow = () => new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
const newsSnapshot = (ticker: string) => ({
  active: true,
  headings: ["PR Releases"],
  rows: [{ meta: ["1 hour ago", `${nyNow()} `, "ACCESS Newswire"], links: [{ href: `https://dilution.news/${ticker.toLowerCase()}0001`, text: `${ticker} announces something` }] }],
});

/** Server-to-client WebSocket text frame (unmasked). */
function frame(text: string, opcode = 0x1) {
  const body = Buffer.from(text);
  const head = body.length < 126 ? Buffer.from([0x80 | opcode, body.length]) : body.length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (body.length >= 126 && body.length < 65536) {
    head[0] = 0x80 | opcode;
    head[1] = 126;
    head.writeUInt16BE(body.length, 2);
  } else if (body.length >= 65536) {
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(body.length), 2);
  }
  return Buffer.concat([head, body]);
}

async function fakeBrowser({ port = 0, pages = [] as Array<{ url: string; type?: string }> } = {}) {
  let n = 0;
  const targets: Target[] = pages.map((p) => ({ id: `T${++n}`, type: p.type ?? "page", url: p.url, mark: null }));
  const state = {
    created: 0,
    closed: 0,
    connections: 0,
    navigations: [] as Array<{ target: string; url: string }>,
    requests: [] as string[],
  };
  const sockets = new Map<Socket, string>();
  const server: Server = createServer((req, res) => {
    const url = req.url ?? "";
    state.requests.push(`${req.method} ${url}`);
    const json = (body: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    const { port: at } = server.address() as AddressInfo;
    const describe = (t: Target) => ({ id: t.id, type: t.type, url: t.url, title: "", webSocketDebuggerUrl: `ws://127.0.0.1:${at}/devtools/page/${t.id}` });
    if (url === "/json/list" || url === "/json") return json(targets.map(describe));
    if (url.startsWith("/json/new")) {
      if (req.method !== "PUT") return void ((res.statusCode = 405), res.end("Using unsafe HTTP verb GET"));
      state.created++;
      const t: Target = { id: `T${++n}`, type: "page", url: decodeURIComponent(url.slice("/json/new?".length)) || "about:blank", mark: null };
      targets.push(t);
      return json(describe(t));
    }
    if (url.startsWith("/json/close")) {
      state.closed++;
      return res.end("Target is closing");
    }
    res.statusCode = 404;
    res.end();
  });

  server.on("upgrade", (req, socket: Socket) => {
    const id = (req.url ?? "").split("/").pop() ?? "";
    if (!targets.some((t) => t.id === id)) return socket.destroy();
    const accept = createHash("sha1")
      .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    state.connections++;
    sockets.set(socket, id);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const send = (message: unknown) => socket.writable && socket.write(frame(JSON.stringify(message)));
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 2) return;
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const masked = (buffer[1] & 0x80) !== 0;
        const total = offset + (masked ? 4 : 0) + length;
        if (buffer.length < total) return;
        const key = masked ? buffer.subarray(offset, offset + 4) : null;
        const payload = Buffer.from(buffer.subarray(total - length, total));
        if (key) for (let i = 0; i < payload.length; i++) payload[i] ^= key[i % 4];
        buffer = buffer.subarray(total);
        if (opcode === 0x8) {
          socket.end(frame("", 0x8));
          return;
        }
        if (opcode === 0x9) {
          socket.write(frame(payload.toString(), 0xa));
          continue;
        }
        if (opcode === 0x1) handle(JSON.parse(payload.toString()));
      }
    });
    const target = () => targets.find((t) => t.id === id);
    const handle = (message: { id: number; method: string; params?: Record<string, unknown> }) => {
      const t = target();
      if (!t) return socket.destroy();
      const reply = (result: unknown) => send({ id: message.id, result });
      if (message.method === "Page.enable") return reply({});
      if (message.method === "Page.navigate") {
        const url = String(message.params?.url);
        state.navigations.push({ target: t.id, url });
        reply({ frameId: t.id, loaderId: `L${state.navigations.length}` });
        // Like a real browser: the old page stays a moment, then the new document replaces it and loads.
        setTimeout(() => {
          t.url = url;
          t.mark = null;
        }, 30);
        setTimeout(() => send({ method: "Page.loadEventFired", params: { timestamp: Date.now() / 1000 } }), 50);
        return;
      }
      if (message.method === "Runtime.evaluate") {
        const expression = String(message.params?.expression);
        const value = (v: unknown) => reply({ result: { type: typeof v, value: v } });
        if (expression.startsWith("window.__lbGainersLookup = ")) {
          t.mark = JSON.parse(expression.slice("window.__lbGainersLookup = ".length));
          return value(t.mark);
        }
        if (expression === DT_NEWS_EXPRESSION) return value(newsSnapshot(decodeURIComponent(t.url.split("/").pop() ?? "")));
        const asked = /^window\.__lbGainersLookup === ("[^"]*")/.exec(expression);
        if (asked && expression.includes("document.body.innerText")) return value(t.mark === JSON.parse(asked[1]) ? null : pageText(t.url));
        return value(undefined);
      }
      send({ id: message.id, error: { code: -32601, message: `'${message.method}' wasn't found` } });
    };
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const at = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${at}`,
    port: at,
    state,
    targets,
    /** Every open DevTools connection drops (the tab stays). */
    dropConnections() {
      for (const socket of sockets.keys()) socket.destroy();
    },
    /** A tab goes away (closed by hand), with its connections. */
    removeTab(id: string) {
      targets.splice(
        targets.findIndex((t) => t.id === id),
        1,
      );
      for (const [socket, of] of sockets) if (of === id) socket.destroy();
    },
    async stop() {
      for (const socket of sockets.keys()) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const TIMING = { pollMs: 10, newsPollMs: 10, pageTimeoutMs: 400, cashWaitMs: 100, newsWaitMs: 1000 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const browsers: Browser[] = [];
const tabs: Array<{ disconnect(): void }> = [];
afterEach(async () => {
  for (const tab of tabs.splice(0)) tab.disconnect();
  for (const browser of browsers.splice(0)) await browser.stop();
});

function setup(url: string, clock = { now: Date.now() }) {
  const lines: string[] = [];
  const posts: Array<Record<string, unknown>> = [];
  const tab = createDtTab({ cdpUrl: url, log: (line: string) => lines.push(line), httpTimeoutMs: 2000, sendTimeoutMs: 2000 });
  tabs.push(tab);
  const lookup = createLookup({
    tab,
    post: async (body: Record<string, unknown>) => {
      posts.push(body);
      return { saved: Array.isArray(body.items) ? body.items.length : true };
    },
    say: (line: string) => lines.push(line),
    pacer: createPacer({ gap: 0 }),
    now: () => clock.now,
    timing: TIMING,
  });
  return { tab, lookup, lines, posts, clock };
}
const list = (tickers: string[], { news = tickers, needs = tickers } = {}) => ({
  tickers,
  needs: needs.map((ticker) => ({ ticker })),
  news: news.map((ticker) => ({ ticker })),
});
const facts = (posts: Array<Record<string, unknown>>) => posts.filter((p) => p.kind === undefined).map((p) => `${p.ticker}:${p.country}`);
const newsPosts = (posts: Array<Record<string, unknown>>) => posts.filter((p) => p.kind === "news").map((p) => p.ticker);

describe("#472 one DilutionTracker tab", () => {
  it("reuses the browser's open DilutionTracker tab for every lookup: nothing opened, nothing closed", async () => {
    const browser = await fakeBrowser({ pages: [{ url: "chrome://newtab/" }, { url: "https://dilutiontracker.com/app/search/AEHL" }] });
    browsers.push(browser);
    const { lookup, posts, tab } = setup(browser.url);
    await lookup.round(list([])); // start: nothing on today's list yet
    const tickers = ["NEWA", "NEWB", "NEWC", "NEWD", "NEWE"];
    for (let i = 1; i <= tickers.length; i++) await lookup.round(list(tickers.slice(0, i)));
    expect(browser.state.created).toBe(0);
    expect(browser.state.closed).toBe(0);
    expect(browser.state.requests.filter((r) => /\/json\/(new|close)/.test(r))).toEqual([]);
    expect(browser.state.connections).toBe(1);
    expect(tab.targetId()).toBe("T2");
    // (b) every page went through that one tab, by navigation, each new ticker once.
    expect(browser.state.navigations).toEqual(tickers.map((t) => ({ target: "T2", url: `https://dilutiontracker.com/app/search/${t}` })));
    // Each ticker's own page was read, never the page before it.
    expect(facts(posts)).toEqual(["NEWA:China", "NEWB:Greece", "NEWC:Hong Kong", "NEWD:U.S.", "NEWE:China"]);
    expect(newsPosts(posts)).toEqual(tickers);
    expect(browser.targets.map((t) => t.id)).toEqual(["T1", "T2"]);
  });

  it("opens exactly one tab when the browser has no DilutionTracker tab, and keeps using it", async () => {
    const browser = await fakeBrowser({ pages: [{ url: "chrome://newtab/" }, { url: "", type: "service_worker" }] });
    browsers.push(browser);
    const { lookup, lines } = setup(browser.url);
    await lookup.round(list([]));
    for (const ticker of ["NEWA", "NEWB", "NEWC", "NEWD"]) await lookup.round(list([ticker]));
    expect(browser.state.created).toBe(1);
    expect(browser.state.closed).toBe(0);
    expect(new Set(browser.state.navigations.map((n) => n.target))).toEqual(new Set(["T3"]));
    expect(browser.state.navigations).toHaveLength(4);
    expect(lines.filter((l) => l.startsWith("opened a DilutionTracker tab"))).toHaveLength(1);
  });

  it("never looks up the tickers already on today's list at start; looks up the ones that show up later", async () => {
    const browser = await fakeBrowser({ pages: [{ url: "https://dilutiontracker.com/" }] });
    browsers.push(browser);
    const { lookup, lines, posts, clock } = setup(browser.url);
    const atStart = ["OLDA", "OLDB", "OLDC"];
    // OLDA still needs facts, OLDB's news isn't read, OLDC is on the table only: all count as done.
    expect(await lookup.round({ tickers: atStart, needs: [{ ticker: "OLDA" }], news: [{ ticker: "OLDB" }] })).toMatchObject({ skipped: 3 });
    expect(lines).toContain("3 tickers already on today's list: not looked up (only tickers that show up from now on are)");
    expect(browser.state.requests).toEqual([]); // the first round doesn't even touch the browser
    for (let i = 0; i < 4; i++) {
      await lookup.round(list(atStart));
      clock.now += 30 * 60_000; // hours of retries' worth: still never
    }
    expect(browser.state.navigations).toEqual([]);
    await lookup.round(list([...atStart, "NEWA"]));
    expect(browser.state.navigations.map((n) => n.url)).toEqual(["https://dilutiontracker.com/app/search/NEWA"]);
    expect(posts.map((p) => p.ticker)).toEqual(["NEWA", "NEWA"]);
    // Done once; still listed later today, it isn't loaded again.
    clock.now += 60 * 60_000;
    await lookup.round(list([...atStart, "NEWA"]));
    expect(browser.state.navigations).toHaveLength(1);
  });

  it("tries a failed new ticker again after 5, 10, 20 minutes, then leaves it until tomorrow", async () => {
    const browser = await fakeBrowser({ pages: [{ url: "https://dilutiontracker.com/" }] });
    browsers.push(browser);
    const { lookup, lines, clock } = setup(browser.url, { now: Date.parse("2026-11-20T14:00:00Z") });
    await lookup.round(list([]));
    const loads: number[] = [];
    for (let minute = 0; minute <= 120; minute++) {
      const before = browser.state.navigations.length;
      await lookup.round(list(["SLOW"], { news: [] }));
      if (browser.state.navigations.length > before) loads.push(minute);
      clock.now += 60_000;
    }
    expect(loads).toEqual([0, 5, 15, 35]);
    expect(lines.filter((l) => l.startsWith("SLOW: the page didn't load"))).toHaveLength(4);
    expect(lines.at(-1)).toMatch(/try 4; not tried again until tomorrow/);
  }, 20_000);

  it("re-attaches to the same tab when the connection dies, and opens one (only one) when the tab is gone", async () => {
    const browser = await fakeBrowser({ pages: [{ url: "https://dilutiontracker.com/app/search/AEHL" }] });
    browsers.push(browser);
    const { lookup } = setup(browser.url);
    await lookup.round(list([]));
    await lookup.round(list(["NEWA"]));
    expect(browser.state.connections).toBe(1);
    browser.dropConnections();
    await wait(50);
    await lookup.round(list(["NEWA", "NEWB"]));
    expect(browser.state.connections).toBe(2);
    expect(browser.state.created).toBe(0);
    expect(browser.state.navigations.map((n) => n.target)).toEqual(["T1", "T1"]);
    // Rob closes the tab: the next lookup opens one and every later one uses it.
    browser.removeTab("T1");
    await wait(50);
    for (const ticker of ["NEWC", "NEWD", "NEWE"]) await lookup.round(list(["NEWA", "NEWB", ticker]));
    expect(browser.state.created).toBe(1);
    expect(browser.state.closed).toBe(0);
    expect(browser.state.navigations.map((n) => n.target)).toEqual(["T1", "T1", "T2", "T2", "T2"]);
    expect(browser.state.connections).toBe(3);
  });

  it("says once that the browser isn't running, waits 2 minutes between checks, and carries on when it is back", async () => {
    // A port nothing listens on.
    const probe = await fakeBrowser();
    const port = probe.port;
    await probe.stop();
    const { lookup, lines, posts } = setup(`http://127.0.0.1:${port}`);
    await lookup.round(list([]));
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await lookup.round(list(["NEWA", "NEWB", "NEWC"])));
    expect(results.every((r) => r.browserDown)).toBe(true);
    expect(results.map((r) => waitAfterRound(r, true))).toEqual(Array(5).fill(BROWSER_WAIT_MS));
    expect(BROWSER_WAIT_MS).toBe(120_000);
    expect(lines.filter((l) => l.includes("not running"))).toEqual([`DilutionTracker browser not running on ${port}; checking again every 2 minutes`]);
    expect(lines).toHaveLength(2); // the start line and that one: nothing per ticker
    expect(posts).toEqual([]);
    // Rob starts the browser: the waiting tickers are looked up (no tries were used up while it was down).
    const browser = await fakeBrowser({ port, pages: [{ url: "https://dilutiontracker.com/" }] });
    browsers.push(browser);
    const back = await lookup.round(list(["NEWA", "NEWB", "NEWC"]));
    expect(back).toMatchObject({ browserDown: false, looked: 3 });
    expect(lines).toContain("DilutionTracker browser answering again; using its one DilutionTracker tab");
    expect(facts(posts)).toEqual(["NEWA:China", "NEWB:Greece", "NEWC:Hong Kong"]);
    expect(browser.state.created).toBe(0);
  });

  it("names the port in its message and knows DilutionTracker's pages", () => {
    expect(createDtTab({ cdpUrl: "http://127.0.0.1:9333" }).downMessage).toBe("DilutionTracker browser not running on 9333");
    expect(cdpPort("http://127.0.0.1:9333/")).toBe("9333");
    expect(isDilutionTrackerUrl("https://dilutiontracker.com/app/search/SMX")).toBe(true);
    expect(isDilutionTrackerUrl("https://www.dilutiontracker.com/")).toBe(true);
    expect(isDilutionTrackerUrl("https://dilutiontracker.com.evil.example/")).toBe(false);
    expect(isDilutionTrackerUrl("chrome://newtab/")).toBe(false);
  });
});

describe("#472 never closes or starts anything", () => {
  it("has no tab-closing, browser-closing or process-starting code", () => {
    for (const file of ["lookup.mjs", "dt-tab.mjs"]) {
      const source = readFileSync(`scripts/gainers-lookup/${file}`, "utf8");
      expect(source).not.toMatch(/\/json\/close|closeTarget|Browser\.close|Target\.close|child_process|spawn\(|execFile|\bexec\(/);
    }
    // /json/new appears once: dt-tab.mjs's open-a-tab-only-when-none-is-open path.
    expect(readFileSync("scripts/gainers-lookup/lookup.mjs", "utf8")).not.toContain("/json/new");
    expect(readFileSync("scripts/gainers-lookup/dt-tab.mjs", "utf8").match(/\/json\/new/g)).toHaveLength(1);
  });
});

describe("#472 day schedule", () => {
  it("skips the tickers marked at start for the rest of that day only", () => {
    const schedule = createDaySchedule();
    const t = Date.parse("2026-11-20T15:00:00Z"); // 10 AM New York
    schedule.skip(["OLDA"], t);
    expect(schedule.ready("OLDA", t + 3_600_000)).toBe(false);
    expect(schedule.ready("NEWA", t)).toBe(true);
    expect(schedule.ready("OLDA", Date.parse("2026-11-21T10:00:00Z"))).toBe(true); // the next New York day
  });
});
