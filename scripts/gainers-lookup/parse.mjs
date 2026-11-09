// #371: reads the facts the Gainers Table needs from a DilutionTracker company page's text
// (document.body.innerText of https://dilutiontracker.com/app/search/<TICKER>). Pure, no I/O.
//
// What the page says, as seen on 2026-11-07 (wording varies by company):
//   Header:  "...Country:ChinaExchange:NASDAQ"  (the U.S. shows as "U.S" here; it is saved as "U.S.")
//            "...Est. Net Cash/Sh:1.7Inst Own:0.1%SI:41.7%"
//   "Cash Position" section, one sentence:
//     "The company has 304.7 months of cash left based on quarterly cash burn of -$0.31M and
//      estimated current cash of $31.5M."
//     "The company is cashflow positive based on quarterly operating cash flow of $5.53M."
//   Large companies (AAPL) have no Cash Position section at all: cash is saved as empty.
//   A ticker it doesn't know shows the search page ("POPULAR TICKERS") and no "Country:".

const UNITS = { "": 1, K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9 };

/** "31.5", "M" -> 31500000. Null for anything that isn't a plain amount. */
export function amount(digits, unit = "") {
  const value = Number(String(digits).replace(/,/g, ""));
  const scale = UNITS[String(unit || "").toUpperCase()];
  if (!Number.isFinite(value) || scale === undefined) return null;
  return Math.round(value * scale);
}

function country(text) {
  const match = text.match(/Country:\s*([^\n]*?)\s*Exchange:/);
  if (!match) return null;
  let value = match[1].replace(/\s+/g, " ").trim();
  if (!value || /^(?:n\/?a|-+|—|unknown)$/i.test(value) || value.length > 60) return null;
  if (value === "U.S" || value === "US" || value === "USA" || value === "United States") value = "U.S.";
  return value;
}

function instOwn(text) {
  const match = text.match(/Inst(?:itutional)? Own(?:ership)?:\s*([\d,]+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value >= 0 && value <= 1000 ? value : null;
}

/** The Cash Position section's text (up to the chart below it), or "" when the page has none. */
export function cashSection(text) {
  const at = text.search(/Cash Position/);
  if (at < 0) return "";
  // The sentence follows the heading; the chart's dates and axis come after it.
  const rest = text.slice(at + "Cash Position".length, at + 1200);
  const end = rest.search(/\n\s*\d{2}\/\d{2}\/\d{4}\b|\bMillions of USD\b|\bWarrant\b/);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function cash(text) {
  const section = cashSection(text);
  const out = { cashUsd: null, cashMonthsLeft: null, cashFlowPositive: false, cashSection: !!section };
  if (!section) return out;
  const money = String.raw`\$\s?([\d,]+(?:\.\d+)?)\s*(thousand|million|billion|[KMBT])?\b`;
  const current =
    section.match(new RegExp(String.raw`(?:estimated\s+)?current\s+cash(?:\s+position)?(?:\s+of|\s+is|:)?\s+(?:approximately\s+|about\s+)?` + money, "i")) ||
    section.match(new RegExp(String.raw`(?:cash\s+(?:and\s+(?:cash\s+)?equivalents\s+)?|cash\s+balance\s+)of\s+` + money, "i"));
  if (current) out.cashUsd = amount(current[1], current[2]);
  const months = section.match(/([\d,]+(?:\.\d+)?)\s+months?\s+of\s+cash\s+(?:left|remaining|runway)/i);
  if (months) {
    const value = Number(months[1].replace(/,/g, ""));
    if (Number.isFinite(value) && value >= 0) out.cashMonthsLeft = value;
  }
  out.cashFlowPositive = /cash\s?flow\s+positive|positive\s+(?:operating\s+)?cash\s?flow/i.test(section);
  if (out.cashFlowPositive) {
    // A company that makes cash has no months left to count; the amount, if the page gives one, stays.
    out.cashMonthsLeft = null;
  }
  return out;
}

/**
 * state: "found" (the company's header is on the page), "not_found" (the search page with no
 * company: only trust this once the page has had time to load), or "loading".
 */
export function parseDilutionTracker(text) {
  const body = typeof text === "string" ? text : "";
  const found = /Country:/.test(body);
  const facts = { country: null, instOwnPct: null, cashUsd: null, cashMonthsLeft: null, cashFlowPositive: false, cashSection: false };
  if (!found) return { state: /POPULAR TICKERS/i.test(body) ? "not_found" : "loading", ...facts };
  return { state: "found", ...facts, country: country(body), instOwnPct: instOwn(body), ...cash(body) };
}

/** The body the facts route takes, from a parse. */
export function factsPayload(ticker, parsed) {
  if (parsed.state === "not_found")
    return { ticker, notFound: true, country: null, cashUsd: null, cashMonthsLeft: null, cashFlowPositive: false, instOwnPct: null };
  return {
    ticker,
    notFound: false,
    country: parsed.country,
    cashUsd: parsed.cashUsd,
    cashMonthsLeft: parsed.cashMonthsLeft,
    cashFlowPositive: parsed.cashFlowPositive,
    instOwnPct: parsed.instOwnPct,
  };
}

// --- #387: the company page's News tab ("PR Releases"), read once per ticker per Eastern day.
//
// What the tab looks like, as seen on 2026-11-08 (SMX, AEHL). The tab is a
// <div class="… search-result-heading-selection-tab …">News</div> that gets "active-selection-tab"
// when shown; the list then draws under <p class="heading-filing-category">PR Releases</p>, one
// <div class="callout2Wrapper"> per release:
//   <div><span>2 days ago</span><svg/><span>11/6/2026, 9:15:00 AM </span><svg/><span>ACCESS Newswire</span></div>
//   <div class="mt-2 newsTitle"><a href="https://dilution.news/bdd806ef20e2f0afc6aa4a9f68db15c9">Plastic Recycling …</a></div>
// The exact time is New York time whatever the browser's zone (the lookup browser runs on Chicago
// time, and AEHL's 10/1/2026 4:08 PM GlobeNewswire release is 16:08 Eastern at the wire too). Older
// releases (years back) follow; only the recent ones are kept.

/**
 * Runs inside the DilutionTracker page (serialized with toString(), so it must stand alone). The
 * first call shows the News tab (the only thing this program ever clicks); later calls read it.
 * Returns { tab, active, headings, rows: [{ meta: [span texts], links: [{ href, text }] }] }.
 */
export function dtNewsSnapshot() {
  const tab = [...document.querySelectorAll(".search-result-heading-selection-tab")].find((el) => el.textContent.trim() === "News");
  if (!tab) return { tab: false, active: false, headings: [], rows: [] };
  if (!/\bactive-selection-tab\b/.test(tab.className)) {
    tab.click();
    return { tab: true, active: false, headings: [], rows: [] };
  }
  const heads = [...document.querySelectorAll("p.heading-filing-category")];
  const head = heads.find((el) => /^PR Releases$/i.test(el.textContent.trim()));
  const rows = head
    ? [...head.parentElement.querySelectorAll(".callout2Wrapper")].slice(0, 300).map((item) => ({
        meta: [...(item.firstElementChild ? item.firstElementChild.querySelectorAll(":scope > span") : [])].map((s) => s.textContent),
        links: [...item.querySelectorAll("a[href]")].slice(0, 3).map((a) => ({ href: a.href, text: a.textContent })),
      }))
    : [];
  return { tab: true, active: true, headings: heads.map((el) => el.textContent.trim()), rows };
}

/** The expression the lookup sends to the page. */
export const DT_NEWS_EXPRESSION = `(${dtNewsSnapshot.toString()})()`;

export const NEWS_KEEP_DAYS = 30;
export const NEWS_MAX_ITEMS = 50;
const EASTERN = "America/New_York";

/** The UTC instant of a New York wall-clock time (handles EST and EDT). */
export function easternToUtc(year, month, day, hour, minute, second = 0) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetAt = (instant) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone: EASTERN, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
        .formatToParts(new Date(instant))
        .map((p) => [p.type, Number(p.value)]),
    );
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
}

/** "11/6/2026, 9:15:00 AM" (New York time) -> ISO UTC, or null. */
export function dtNewsTime(text) {
  const m = String(text ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;
  const [, mo, d, y, h, mi, s, ampm] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(h) < 1 || Number(h) > 12 || Number(mi) > 59) return null;
  const hour = (Number(h) % 12) + (/pm/i.test(ampm) ? 12 : 0);
  return new Date(easternToUtc(Number(y), Number(mo), Number(d), hour, Number(mi), Number(s ?? 0))).toISOString();
}

const tidy = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function httpUrl(value) {
  try {
    const url = new URL(String(value));
    return (url.protocol === "https:" || url.protocol === "http:") && url.href.length <= 2000 ? url.href : null;
  } catch {
    return null;
  }
}

/** DilutionTracker's id for a release: the path of its dilution.news short link. */
export function dtItemId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "dilution.news") return null;
    const id = parsed.pathname.replace(/^\/+|\/+$/g, "");
    return /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * The releases from a snapshot's rows: published in the last `keepDays` days, each once (by
 * DilutionTracker's id, else its link), newest first, at most NEWS_MAX_ITEMS.
 * Each: { publishedAt, source, title, url, dtItemId }.
 */
export function parseDtNews(rows, { now = Date.now(), keepDays = NEWS_KEEP_DAYS } = {}) {
  const since = now - keepDays * 86_400_000;
  const seen = new Set();
  const items = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const meta = Array.isArray(row?.meta) ? row.meta.map((m) => tidy(m, 200)) : [];
    const link = (Array.isArray(row?.links) ? row.links : []).find((l) => httpUrl(l?.href) && tidy(l?.text, 300));
    if (!link) continue;
    // The exact time is the span that reads like one; the wire's name is the span after it.
    const at = meta.findIndex((m) => dtNewsTime(m));
    if (at < 0) continue;
    const publishedAt = dtNewsTime(meta[at]);
    const time = Date.parse(publishedAt);
    if (time < since || time > now + 86_400_000) continue;
    const url = httpUrl(link.href);
    const id = dtItemId(url);
    const key = id ?? url;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ publishedAt, source: tidy(meta[at + 1], 80), title: tidy(link.text, 300), url, dtItemId: id });
  }
  return items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, NEWS_MAX_ITEMS);
}

/**
 * Whether a snapshot is a finished read: the tab is shown and either releases are listed, or the
 * tab has drawn (its other headings are there) and has had `settleMs` to list any.
 */
export function dtNewsSettled(snapshot, shownFor, settleMs = 8_000) {
  if (!snapshot?.active) return false;
  if (snapshot.rows?.length) return true;
  return (snapshot.headings?.length ?? 0) > 0 && shownFor >= settleMs;
}

/** The body the facts route takes for one ticker's news read (the oldest dropped to stay under 30 KB). */
export function newsPayload(ticker, items) {
  const kept = [...items];
  while (kept.length && JSON.stringify({ kind: "news", ticker, items: kept }).length > 30_000) kept.pop();
  return { kind: "news", ticker, items: kept };
}
