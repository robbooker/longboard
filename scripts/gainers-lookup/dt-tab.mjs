// #472: the ONE DilutionTracker tab the gainers lookup reads every company page in.
//
// Rob keeps a dedicated Chromium open with remote debugging on 127.0.0.1:9333 (README.md). This file
// never starts, closes or restarts that browser and never closes a tab. It finds the browser's open
// dilutiontracker.com tab (or opens one, only when there is none), keeps one DevTools connection to it,
// and every lookup navigates that same tab. When the tab disappears or the connection dies, the next
// lookup attaches again: to the same tab if it is still there, else to another DilutionTracker tab,
// else it opens one. A browser that isn't answering throws BrowserDown and nothing else is tried.
// Node 22+ (built-in WebSocket and fetch), no packages.

/** The lookup browser isn't answering on its debugging port. */
export class BrowserDown extends Error {}
/** The tab's DevTools connection closed or never opened. */
export class TabLost extends Error {}

const DT_PAGE = /^https:\/\/([a-z0-9-]+\.)*dilutiontracker\.com(\/|$)/i;
/** A dilutiontracker.com page (any of its subdomains). */
export const isDilutionTrackerUrl = (url) => typeof url === "string" && DT_PAGE.test(url);

/** "9333" from "http://127.0.0.1:9333", for the log. */
export function cdpPort(cdpUrl) {
  try {
    const url = new URL(cdpUrl);
    return url.port || (url.protocol === "https:" ? "443" : "80");
  } catch {
    return String(cdpUrl);
  }
}

/** Where a new tab starts when the browser has no DilutionTracker tab (the lookup then navigates it). */
const NEW_TAB_URL = "https://dilutiontracker.com/";

/**
 * @param {{ cdpUrl: string, log?: (line: string) => void, WebSocketImpl?: typeof WebSocket, sendTimeoutMs?: number, httpTimeoutMs?: number }} options
 */
export function createDtTab({ cdpUrl, log = () => {}, WebSocketImpl = globalThis.WebSocket, sendTimeoutMs = 10_000, httpTimeoutMs = 10_000 } = {}) {
  if (!cdpUrl) throw new Error("cdpUrl is required");
  const base = String(cdpUrl).replace(/\/$/, "");
  const downMessage = `DilutionTracker browser not running on ${cdpPort(base)}`;
  let session = null;
  let attaching = null;
  let targetId = null;

  async function http(path, method = "GET") {
    let response;
    try {
      response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(httpTimeoutMs) });
    } catch {
      throw new BrowserDown(downMessage);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(`the lookup browser answered ${response.status} to ${path.replace(/\?.*/, "")}`);
    return data;
  }

  function connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocketImpl(url);
      const pending = new Map();
      const waiters = new Set();
      let id = 0;
      let opened = false;
      let dead = false;
      const die = (why) => {
        if (dead) return;
        dead = true;
        if (session?.ws === ws) session = null;
        for (const entry of pending.values()) {
          clearTimeout(entry.timer);
          entry.reject(new TabLost(why));
        }
        pending.clear();
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(new TabLost(why));
        }
        waiters.clear();
      };
      const s = {
        ws,
        alive: () => !dead && ws.readyState === 1,
        /** One DevTools request; resolves with the whole reply ({ result } or { error }). */
        send(method, params = {}) {
          if (dead) return Promise.reject(new TabLost("the DilutionTracker tab's connection is closed"));
          return new Promise((done, fail) => {
            const n = ++id;
            const timer = setTimeout(() => {
              pending.delete(n);
              fail(new Error(`${method} timed out`));
            }, sendTimeoutMs);
            pending.set(n, { resolve: done, reject: fail, timer });
            try {
              ws.send(JSON.stringify({ id: n, method, params }));
            } catch (error) {
              clearTimeout(timer);
              pending.delete(n);
              fail(new TabLost(`couldn't talk to the DilutionTracker tab (${error.message})`));
            }
          });
        },
        /** The next `method` event's params, or null after `ms`. Rejects if the connection dies. */
        waitFor(method, ms) {
          return new Promise((done, fail) => {
            const waiter = { method, resolve: done, reject: fail, timer: null };
            waiter.timer = setTimeout(() => {
              waiters.delete(waiter);
              done(null);
            }, ms);
            waiters.add(waiter);
          });
        },
      };
      ws.addEventListener("open", () => {
        opened = true;
        resolve(s);
      });
      ws.addEventListener("error", () => {
        die("the DilutionTracker tab's connection failed");
        if (!opened) reject(new TabLost("couldn't reach the DilutionTracker tab"));
      });
      ws.addEventListener("close", () => {
        die("the DilutionTracker tab's connection closed");
        if (!opened) reject(new TabLost("couldn't reach the DilutionTracker tab"));
      });
      ws.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (message.id && pending.has(message.id)) {
          const entry = pending.get(message.id);
          pending.delete(message.id);
          clearTimeout(entry.timer);
          entry.resolve(message);
        } else if (message.method) {
          for (const waiter of [...waiters])
            if (waiter.method === message.method) {
              waiters.delete(waiter);
              clearTimeout(waiter.timer);
              waiter.resolve(message.params ?? {});
            }
        }
      });
    });
  }

  async function attach() {
    const targets = await http("/json/list");
    const pages = (Array.isArray(targets) ? targets : []).filter((t) => t && t.type === "page" && typeof t.id === "string");
    // The tab used before (wherever it is now), else the browser's open DilutionTracker tab.
    let target = (targetId && pages.find((t) => t.id === targetId)) || pages.find((t) => isDilutionTrackerUrl(t.url));
    if (target) {
      if (target.id !== targetId) log(`using the open DilutionTracker tab in the lookup browser`);
    } else {
      // None open: open exactly one, and keep it.
      target = await http(`/json/new?${NEW_TAB_URL}`, "PUT");
      if (!target || typeof target.id !== "string") throw new Error("the lookup browser didn't open a tab");
      log(`opened a DilutionTracker tab in the lookup browser (none was open); it stays open`);
    }
    targetId = target.id;
    const url = target.webSocketDebuggerUrl || `${base.replace(/^http/, "ws")}/devtools/page/${target.id}`;
    const s = await connect(url);
    const enabled = await s.send("Page.enable");
    if (enabled.error) throw new Error(`Page.enable: ${enabled.error.message}`);
    session = s;
    return s;
  }

  /** The live connection to the one tab, attaching (or opening the tab) when there is none. */
  async function ensure() {
    if (session?.alive()) return session;
    session = null;
    attaching ||= attach().finally(() => {
      attaching = null;
    });
    return attaching;
  }

  return {
    downMessage,
    /** The tab id in use (null before the first attach). */
    targetId: () => targetId,
    /** Attaches if needed. Throws BrowserDown when the browser isn't answering. */
    async ready() {
      await ensure();
    },
    /** Navigates the one tab to `url` and waits for its load event (at most `loadTimeoutMs`). */
    async navigate(url, { loadTimeoutMs = 30_000 } = {}) {
      const s = await ensure();
      const loaded = s.waitFor("Page.loadEventFired", loadTimeoutMs);
      loaded.catch(() => {});
      const reply = await s.send("Page.navigate", { url });
      if (reply.error) throw new Error(`Page.navigate: ${reply.error.message}`);
      if (reply.result?.errorText) throw new Error(`the page didn't open (${reply.result.errorText})`);
      await loaded;
    },
    /** The value of `expression` in the tab (undefined when the page couldn't run it, e.g. mid-load). */
    async evaluate(expression) {
      const s = await ensure();
      const reply = await s.send("Runtime.evaluate", { expression, returnByValue: true });
      return reply.result?.result?.value;
    },
    /** Drops this program's connection only. The tab and the browser stay open. */
    disconnect() {
      try {
        session?.ws.close();
      } catch {}
      session = null;
    },
  };
}
