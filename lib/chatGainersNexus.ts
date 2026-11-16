// #458 Gainers Table: whether a U.S.-listed company is run from overseas, from WoodsBear's Short
// Check "operating nexus" feed (GET https://short-check.vercel.app/api/nexus/<TICKER>, setup notes:
// github.com/gdwoods/pump-scorecard/blob/main/docs/nexus-api.md). DilutionTracker's country is the
// SEC business address, so a company with a Houston address and its operations in Taiwan shows "US";
// Short Check reads the company's own 10-K/20-F and proxy filings for where it really operates or is
// controlled. When it says so, the table puts a small marker beside the "US" block.
//
// Only a data source: nothing here scores or flags anything else. Asked only for rows whose block is
// "US" (the route decides), once a day per ticker per server instance (Short Check asked for 24 hours
// on our side; a module-level cache like the shares in lib/chatGainersShares.ts). A failed or "unknown"
// answer is asked again after an hour. Quiet in every failure: no key, a refused key, the daily limit,
// a slow or broken answer all mean no marker, never an error, and the key is never logged or sent on.

export const NEXUS_URL = "https://short-check.vercel.app/api/nexus/";
export const NEXUS_TTL_MS = 24 * 3_600_000;
/** A failed read or an "unknown" answer is asked again after this long. */
export const NEXUS_RETRY_MS = 3_600_000;
/** One request gives up after this long. */
export const NEXUS_TIMEOUT_MS = 4_000;
/** The table answers after this long even if Short Check hasn't; the late answer fills the cache. */
export const NEXUS_WAIT_MS = 2_500;
const PARALLEL = 4;

/** What a row carries when Short Check says the company operates overseas (the only case the table shows). */
export type GainersNexus = {
  countries: string[];
  reason: string | null;
  /** The SEC filing it read (https on sec.gov only), or null. */
  evidenceUrl: string | null;
  /** YYYY-MM-DD, or null. */
  asOf: string | null;
};

const TICKER = /^[A-Z][A-Z.]{0,11}$/;
const PLAIN = /^[^\0<>]+$/;
const MAX_COUNTRIES = 8;

const text = (value: unknown, max: number) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed && trimmed.length <= max && PLAIN.test(trimmed) ? trimmed : null;
};

function secUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 600) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "sec.gov" || host.endsWith(".sec.gov")) ? url.href : null;
  } catch {
    return null;
  }
}

function day(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value.trim());
  return match && Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`)) ? match[1] : null;
}

/** "flagged" with its details, "clear" (no marker, kept a day), or "unknown" (no marker, asked again in an hour). */
export type NexusAnswer = { kind: "flagged"; nexus: GainersNexus } | { kind: "clear" } | { kind: "unknown" };

/**
 * One Short Check answer, checked on the way in. Only `status: "flagged"` with `overseas: true` and at
 * least one country gives a marker; "clear" and "not_applicable" are kept as no marker for a day;
 * "unknown", anything else and anything malformed are no marker, asked again in an hour.
 */
export function parseNexus(value: unknown, ticker: string): NexusAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { kind: "unknown" };
  const p = value as Record<string, unknown>;
  if (typeof p.ticker === "string" && p.ticker.trim().toUpperCase() !== ticker) return { kind: "unknown" };
  if (p.status === "clear" || p.status === "not_applicable") return { kind: "clear" };
  if (p.status !== "flagged" || p.overseas !== true || !Array.isArray(p.countries))
    return { kind: "unknown" };
  const countries = [...new Set(p.countries.map((c) => text(c, 60)).filter((c): c is string => !!c))].slice(
    0,
    MAX_COUNTRIES,
  );
  if (!countries.length) return { kind: "unknown" };
  return {
    kind: "flagged",
    nexus: { countries, reason: text(p.reason, 400), evidenceUrl: secUrl(p.evidenceUrl), asOf: day(p.asOf) },
  };
}

type Entry = { at: number; answer: NexusAnswer };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<void>>();

const fresh = (entry: Entry | undefined, now: number) =>
  !!entry && now - entry.at < (entry.answer.kind === "unknown" ? NEXUS_RETRY_MS : NEXUS_TTL_MS);

async function readOne(ticker: string, key: string): Promise<NexusAnswer> {
  try {
    const response = await fetch(NEXUS_URL + encodeURIComponent(ticker), {
      headers: { "x-api-key": key, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(NEXUS_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { kind: "unknown" };
    }
    return parseNexus(await response.json(), ticker);
  } catch {
    // Slow, down, or not JSON: no marker, asked again later. Nothing is logged (the error could
    // carry the request).
    return { kind: "unknown" };
  }
}

/**
 * Short Check's overseas answer for these tickers: a map with an entry only for each ticker it says
 * operates overseas. Without SHORT_CHECK_API_KEY nothing is asked and the map is empty.
 */
export async function gainersNexus(tickers: string[]): Promise<Map<string, GainersNexus>> {
  const key = process.env.SHORT_CHECK_API_KEY?.trim();
  const wanted = [...new Set(tickers.map((t) => t.trim().toUpperCase()))].filter((t) => TICKER.test(t));
  if (!key || !wanted.length) return new Map();
  const now = Date.now();
  const due = wanted.filter((t) => !pending.has(t) && !fresh(cache.get(t), now));
  // A few at a time; the rest wait their turn behind them.
  let next = 0;
  const lane = async () => {
    while (next < due.length) {
      const ticker = due[next++];
      const answer = await readOne(ticker, key);
      cache.set(ticker, { at: Date.now(), answer });
    }
  };
  if (due.length) {
    const lanes = Promise.all(Array.from({ length: Math.min(PARALLEL, due.length) }, lane)).then(() => {});
    for (const ticker of due) pending.set(ticker, lanes);
    void lanes.finally(() => {
      for (const ticker of due) if (pending.get(ticker) === lanes) pending.delete(ticker);
    });
  }
  const waits = [...new Set(wanted.map((t) => pending.get(t)).filter(Boolean))];
  if (waits.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(waits),
      new Promise((resolve) => (timer = setTimeout(resolve, NEXUS_WAIT_MS))),
    ]);
    clearTimeout(timer);
  }
  if (cache.size > 2_000) for (const [t, e] of cache) if (now - e.at > NEXUS_TTL_MS) cache.delete(t);
  const found = new Map<string, GainersNexus>();
  for (const ticker of wanted) {
    const answer = cache.get(ticker)?.answer;
    if (answer?.kind === "flagged") found.set(ticker, answer.nexus);
  }
  return found;
}

/** For tests. */
export function resetGainersNexus() {
  cache.clear();
  pending.clear();
}

// --- Display.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-10" → "Nov 10, 2026". */
export function nexusDay(asOf: string) {
  const [y, m, d] = asOf.split("-").map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${d}, ${y}` : asOf;
}

/** The marker's words: "Operates overseas: Taiwan, Cayman Islands. <reason> (as of Nov 10, 2026). Source: Short Check". */
export function nexusWords(nexus: GainersNexus) {
  const asOf = nexus.asOf ? ` (as of ${nexusDay(nexus.asOf)})` : "";
  const reason = nexus.reason
    ? ` ${nexus.reason.replace(/[.\s]+$/, "")}${asOf}.`
    : asOf
      ? ` Checked${asOf}.`
      : "";
  return `Operates overseas: ${nexus.countries.join(", ")}.${reason} Source: Short Check`;
}
