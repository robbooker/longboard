// #386 Booker Stock Club, server side: every 15 minutes in market hours, the morning report's scan
// (lib/morning-email/polygon.ts, the same rules) lists today's candidates; Rob's country weighting
// ranks them (lib/stockClub.ts). #403: when today's Longboard morning report exists, its #1 is the
// club's #1 and the scan's ranking follows it; the scan alone picks only without a report. The first
// #1 of the day is posted and, by default (CLUB_INTRADAY_UPDATES), nothing automatic after it; with
// intraday updates on, a later new #1 that hasn't been posted today posts too. An admin can post a
// pick by hand, which stops automatic changes for that day. Each post carries the stock's numbers, the levels above its price (lib/stockClubLevels.ts,
// run.py's math) and today's 2-minute closes for the small chart.
import type { SupabaseClient } from "@supabase/supabase-js";
import { borrowNeeded, type GainersBorrow } from "@/lib/chatGainersBorrow";
import { borrowForDay } from "@/lib/chatGainersBorrowDb";
import { easternDay, factsNeeded } from "@/lib/chatGainersFacts";
import { isUsMarketHoliday } from "@/lib/marketCalendar";
import {
  fetchPolygonReference,
  fetchPolygonTickerSnapshots,
  fetchSingleSnapshot,
  pickMoverCandidates,
  type MoverCandidate,
  type ReferenceData,
} from "@/lib/morning-email/polygon";
import type { QaMessage } from "@/lib/morning-email/types";
import { nyClockToUtcMs, polygonAggsAll, type PolygonAgg } from "@/lib/polygon/client";
import { CLUB_INTRADAY_UPDATES, decidePost, pickBody, rankCandidates, reportTopTicker, type ClubChart, type ClubPick, type ClubTopSource, type PostDecision } from "@/lib/stockClub";
import { dailySma200, etDay, levelsAbove, monthlyPivots, type StockClubLevels } from "@/lib/stockClubLevels";

/** How many names the scan passes on to the ranking (the morning report itself keeps five). */
export const CANDIDATE_LIMIT = 15;
/** run.py reads this many days of hour bars for the monthly pivots. */
const HOUR_HISTORY_DAYS = 1130;
/** Enough calendar days for 200 daily closes before the day. */
const DAILY_HISTORY_DAYS = 320;

/** One candidate as the day's row keeps it, ranked, with its country when known. */
export type StoredCandidate = {
  ticker: string;
  name: string;
  changePct: number;
  price: number;
  volume: number;
  marketCap: number | null;
  country: string | null;
};

export type ClubFactsRow = {
  ticker: string;
  country: string | null;
  country_checked_at: string | null;
  inst_own_pct: number | string | null;
  inst_own_checked_at: string | null;
  cash_checked_at: string | null;
  not_found: boolean;
  checked_at: string | null;
};

export type TickResult = {
  status: "posted" | "skipped" | "failed" | "no_quote" | "waiting_for_report" | PostDecision;
  day: string;
  /** #403: where this run's #1 came from. */
  from?: ClubTopSource;
  top?: string | null;
  candidates?: string[];
  messageId?: string;
  error?: string;
};

const num = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const etMinutes = (now: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { minutes: Number(get("hour")) * 60 + Number(get("minute")), weekday: get("weekday") };
};

/** Weekdays that aren't market holidays (New York). */
export function isClubDay(now: Date): boolean {
  const { weekday } = etMinutes(now);
  return weekday !== "Sat" && weekday !== "Sun" && !isUsMarketHoliday(easternDay(now.getTime()));
}

/**
 * When the 15-minute run works: 4:00 AM to 4:00 PM New York on market days. #403: it starts with
 * the pre-market so the report's #1 posts as soon as the report has one (the report itself also
 * posts it the moment it's saved; this run is the safety net).
 */
export function inClubWindow(now: Date): boolean {
  const { minutes } = etMinutes(now);
  return isClubDay(now) && minutes >= 4 * 60 && minutes <= 16 * 60;
}

/** #403: from the open (9:30 AM New York) the club's own scan may pick the #1 when there's still no report. */
export function scanFallbackOpen(now: Date): boolean {
  return etMinutes(now).minutes >= 9 * 60 + 30;
}

const shiftDay = (day: string, days: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function readFacts(db: SupabaseClient, tickers: string[]): Promise<Map<string, ClubFactsRow>> {
  if (!tickers.length) return new Map();
  const { data, error } = await db
    .from("chat_gainers_facts")
    .select("ticker, country, country_checked_at, inst_own_pct, inst_own_checked_at, cash_checked_at, not_found, checked_at")
    .in("ticker", tickers);
  if (error) throw new Error("facts_unavailable");
  return new Map(((data ?? []) as ClubFactsRow[]).map((row) => [row.ticker, row]));
}

export async function readDayState(db: SupabaseClient, day: string) {
  const [dayRow, picks] = await Promise.all([
    db.from("chat_club_days").select("locked, candidates, candidates_at").eq("day", day).maybeSingle(),
    db.from("chat_club_picks").select("ticker, source, message_id, created_at").eq("day", day).order("created_at", { ascending: true }),
  ]);
  if (dayRow.error || picks.error) throw new Error("club_unavailable");
  const rows = (picks.data ?? []) as { ticker: string; source: "auto" | "admin"; message_id: string; created_at: string }[];
  return {
    locked: !!dayRow.data?.locked,
    candidates: (Array.isArray(dayRow.data?.candidates) ? dayRow.data.candidates : []) as StoredCandidate[],
    candidatesAt: (dayRow.data?.candidates_at as string | null) ?? null,
    picks: rows,
    posted: rows.map((row) => row.ticker),
  };
}

/** Monthly pivots from hour bars and the daily 200 SMA. Empty levels when the bars can't be read. */
export async function loadLevels(ticker: string, day: string): Promise<StockClubLevels> {
  const [hours, daily] = await Promise.all([
    polygonAggsAll(ticker, 1, "hour", shiftDay(day, -HOUR_HISTORY_DAYS), day),
    polygonAggsAll(ticker, 1, "day", shiftDay(day, -DAILY_HISTORY_DAYS), day),
  ]);
  return { ...monthlyPivots(hours, day), sma200: dailySma200(daily, day) };
}

/** Today's 2-minute closes (extended hours, from 4 AM New York). */
export function chartFromBars(bars: PolygonAgg[], day: string): ClubChart | null {
  const [y, m, d] = day.split("-").map(Number);
  const start = nyClockToUtcMs(y, m, d, 4, 0);
  const points = bars
    .filter((bar) => etDay(bar.t) === day)
    .map((bar): [number, number] => [Math.round((bar.t - start) / 60_000), Math.round(bar.c * 10_000) / 10_000]);
  return points.length ? { start, points } : null;
}

const candidateFrom = ({ raw, ref }: MoverCandidate): Omit<StoredCandidate, "country"> => ({
  ticker: raw.ticker,
  name: ref.name ?? "",
  changePct: Math.round(raw.changePct * 100) / 100,
  price: raw.lastPrice,
  volume: raw.volume,
  marketCap: ref.marketCap,
});

/** Builds the full post for one candidate. Levels or chart that can't be read are left empty. */
export async function buildPick(
  db: SupabaseClient,
  day: string,
  candidate: Omit<StoredCandidate, "country">,
  facts: ClubFactsRow | undefined,
  source: "auto" | "admin",
  now = new Date(),
): Promise<ClubPick> {
  const [levels, bars, borrows] = await Promise.all([
    loadLevels(candidate.ticker, day).catch((): StockClubLevels => ({ cmp: null, missed: [], sma200: null })),
    polygonAggsAll(candidate.ticker, 2, "minute", day, day).catch(() => [] as PolygonAgg[]),
    borrowForDay(db, day),
  ]);
  return {
    ticker: candidate.ticker,
    name: candidate.name,
    day,
    at: now.toISOString(),
    source,
    price: candidate.price || null,
    changePct: candidate.changePct,
    volume: candidate.volume,
    marketCap: candidate.marketCap,
    country: facts?.country ?? null,
    instOwnPct: num(facts?.inst_own_pct),
    borrow: borrows?.get(candidate.ticker) ?? null,
    levels: levelsAbove(levels, candidate.price),
    chart: chartFromBars(bars, day),
  };
}

export async function postPick(db: SupabaseClient, pick: ClubPick): Promise<{ posted: boolean; messageId?: string; reason?: string }> {
  const { data, error } = await db.rpc("post_chat_club_pick", {
    p_day: pick.day,
    p_ticker: pick.ticker,
    p_source: pick.source,
    p_body: pickBody(pick),
    p_data: pick,
  });
  if (error) throw new Error(error.message.includes("longboard_chat_paused") ? "room_paused" : "club_unavailable");
  return data as { posted: boolean; messageId?: string; reason?: string };
}

/**
 * #403: the #1 of the newest version of today's Longboard morning report, or null when there is no
 * report for today yet (rows for an older sent_date, like Friday's report still refreshing on a
 * Monday morning, don't count). Service role: the archive has RLS on and no policies.
 */
export async function readReportTop(db: SupabaseClient, day: string): Promise<string | null> {
  const { data, error } = await db
    .from("morning_email_archive")
    .select("sent_date, stocks_json, created_at")
    .eq("sent_date", day)
    .eq("status", "success")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("club_unavailable");
  return reportTopTicker(data as { sent_date?: unknown; stocks_json?: unknown } | null, day);
}

const emptyRef = (ticker: string): ReferenceData => ({ ticker, type: null, name: null, marketCap: null, shareClassShares: null, weightedSharesOutstanding: null });

/** A fresh quote for one ticker as a candidate, the scan's rules skipped. Null without a price. */
async function quoteCandidate(ticker: string): Promise<Omit<StoredCandidate, "country"> | null> {
  const [snap, ref] = await Promise.all([fetchSingleSnapshot(ticker), fetchPolygonReference(ticker)]);
  if (!snap || !(snap.lastPrice > 0)) return null;
  return candidateFrom({ raw: snap, ref: ref ?? emptyRef(ticker) });
}

/**
 * One 15-minute run. Saves the day's candidates (the lookup program reads them), then posts if due.
 * #403: when there is a Longboard morning report for today, its #1 is the club's #1, quoted fresh
 * even when the scan's rules would drop it (over $20, for one), and it goes first in the saved
 * candidates so the lookup program finds its country and borrow. Without a report for today, the
 * club's own scan and Rob's country weighting pick the #1, but only from the open (9:30 AM New
 * York); before that the run waits for the report. Each post says which ("from").
 */
export async function runStockClubTick(db: SupabaseClient, now = new Date(), opts: { intraday?: boolean; scanFallback?: boolean } = {}): Promise<TickResult> {
  const day = easternDay(now.getTime());
  const qa: QaMessage[] = [];
  const [snapshots, reportTop] = await Promise.all([fetchPolygonTickerSnapshots(), readReportTop(db, day)]);
  const passed = (await pickMoverCandidates(snapshots, CANDIDATE_LIMIT, qa)).map(candidateFrom);
  const reportCandidate = reportTop ? (passed.find((c) => c.ticker === reportTop) ?? (await quoteCandidate(reportTop))) : null;
  const scanned = passed.filter((c) => c.ticker !== reportTop);
  const facts = await readFacts(db, [...(reportCandidate ? [reportCandidate.ticker] : []), ...scanned.map((c) => c.ticker)]);
  const countryOf = (ticker: string) => facts.get(ticker)?.country ?? null;
  const countries = new Map(scanned.map((c) => [c.ticker, countryOf(c.ticker)]));
  const ranked: StoredCandidate[] = [...(reportCandidate ? [reportCandidate] : []), ...rankCandidates(scanned, countries)].map((c) => ({
    ...c,
    country: countryOf(c.ticker),
  }));
  const saved = await db
    .from("chat_club_days")
    .upsert({ day, candidates: ranked, candidates_at: now.toISOString(), updated_at: now.toISOString() }, { onConflict: "day" });
  if (saved.error) throw new Error("club_unavailable");
  const from: ClubTopSource = reportTop ? "report" : "scan";
  const base = { day, from, top: reportTop ?? ranked[0]?.ticker ?? null, candidates: ranked.map((c) => c.ticker) };
  // The report names a #1 that has no quote right now: wait for the next run, don't post the scan's.
  if (reportTop && !reportCandidate) return { status: "no_quote", ...base };
  // Before the open only today's report can name the #1.
  if (!reportTop && !(opts.scanFallback ?? scanFallbackOpen(now))) return { status: "waiting_for_report", ...base, top: null };
  const state = await readDayState(db, day);
  const top = ranked[0] ?? null;
  const decision = decidePost(state, top?.ticker ?? null, opts.intraday ?? CLUB_INTRADAY_UPDATES);
  if (decision !== "post" || !top) return { status: decision, ...base };
  const pick: ClubPick = { ...(await buildPick(db, day, top, facts.get(top.ticker), "auto", now)), from };
  const result = await postPick(db, pick);
  return result.posted
    ? { status: "posted", messageId: result.messageId, ...base }
    : { status: (result.reason as PostDecision) ?? "same", ...base };
}

/**
 * #403: posts today's morning report #1 the moment a report version is saved (called by
 * lib/morning-report/service.ts), so the club gets its stock when Longboard does, pre-market
 * included. Only a report whose sent_date is today (New York) counts, so a refresh of an older
 * day's report never posts. The same rules as the 15-minute run: once a day, no repeats, an admin's
 * pick locks the day, market days only. No market scan: the next run adds the candidates.
 */
export async function postReportPick(db: SupabaseClient, now = new Date(), opts: { intraday?: boolean } = {}): Promise<TickResult> {
  const day = easternDay(now.getTime());
  if (!isClubDay(now)) return { status: "skipped", day };
  const top = await readReportTop(db, day);
  const base = { day, from: "report" as const, top };
  if (!top) return { status: "none", ...base };
  const decision = decidePost(await readDayState(db, day), top, opts.intraday ?? CLUB_INTRADAY_UPDATES);
  if (decision !== "post") return { status: decision, ...base };
  const [candidate, facts] = await Promise.all([quoteCandidate(top), readFacts(db, [top])]);
  if (!candidate) return { status: "no_quote", ...base };
  const pick: ClubPick = { ...(await buildPick(db, day, candidate, facts.get(top), "auto", now)), from: "report" };
  const result = await postPick(db, pick);
  return result.posted
    ? { status: "posted", messageId: result.messageId, ...base }
    : { status: (result.reason as PostDecision) ?? "same", ...base };
}

/** An admin's pick for today: posts it at once and stops automatic changes for the day. */
export async function postAdminPick(db: SupabaseClient, ticker: string, now = new Date()) {
  const day = easternDay(now.getTime());
  const [candidate, facts] = await Promise.all([quoteCandidate(ticker), readFacts(db, [ticker])]);
  if (!candidate) return { posted: false as const, reason: "no_quote" };
  const pick = await buildPick(db, day, candidate, facts.get(ticker), "admin", now);
  return postPick(db, pick);
}

/** How many of the day's top-ranked candidates get a TradeZero borrow check (plus every posted pick). */
const BORROW_TOP = 3;

/**
 * What the lookup program on Rob's computer should also look up for the Booker Stock Club: today's
 * candidates that never alerted in Gainers (so aren't in `skip`, the Gainers Table's tickers) and
 * still need a country, cash or inst own; and a TradeZero borrow check for the top few and the
 * posted picks, on the Gainers schedule (first sight, then every 15 minutes while they're still
 * candidates). Never throws: without the club tables it adds nothing.
 */
export async function clubLookupNeeds(
  db: SupabaseClient,
  day: string,
  skip: Set<string>,
  borrows: Map<string, GainersBorrow> | null,
  now = Date.now(),
): Promise<{ needs: { ticker: string; fields: string[] }[]; borrow: { ticker: string }[] }> {
  try {
    const state = await readDayState(db, day);
    const seen = state.candidatesAt ?? new Date(now).toISOString();
    const tickers = state.candidates.map((c) => c.ticker).filter((t) => typeof t === "string" && !skip.has(t));
    const facts = await readFacts(db, tickers);
    const needs = tickers.flatMap((ticker) => {
      const row = facts.get(ticker);
      const fields = factsNeeded(
        {
          ticker,
          last_alert_at: seen,
          alerts: 0,
          country: row?.country ?? null,
          country_checked_at: row?.country_checked_at ?? null,
          cash_usd: null,
          cash_months_left: null,
          cash_flow_positive: false,
          cash_checked_at: row?.cash_checked_at ?? null,
          inst_own_pct: row?.inst_own_pct ?? null,
          inst_own_checked_at: row?.inst_own_checked_at ?? null,
          not_found: !!row?.not_found,
          checked_at: row?.checked_at ?? null,
        },
        now,
      );
      return fields ? [{ ticker, fields }] : [];
    });
    const due = new Set([...tickers.slice(0, BORROW_TOP), ...state.posted.filter((t) => !skip.has(t))]);
    const borrow = borrows
      ? [...due].filter((ticker) => borrowNeeded(seen, borrows.get(ticker), now)).map((ticker) => ({ ticker }))
      : [];
    return { needs, borrow };
  } catch {
    return { needs: [], borrow: [] };
  }
}

/** Admin: turn automatic picks back on for today. */
export async function resumeAutomatic(db: SupabaseClient, now = new Date()) {
  const day = easternDay(now.getTime());
  const { error } = await db.from("chat_club_days").update({ locked: false, updated_at: now.toISOString() }).eq("day", day);
  if (error) throw new Error("club_unavailable");
  return { day, locked: false };
}
