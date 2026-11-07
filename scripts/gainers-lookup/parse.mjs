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
