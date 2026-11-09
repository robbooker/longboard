// #386 Booker Stock Club: the read-only room that names the #1 stock of the day. This file holds the
// rules that need no server: how the #1 is chosen (Rob's country weighting), when
// a new post goes up, what a post carries and how its plain text reads. The server side (scan,
// levels, posting) is lib/stockClubServer.ts; the card is components/chat/StockClubCard.tsx.
import type { GainersBorrow } from "@/lib/chatGainersBorrow";
import { borrowLabel } from "@/lib/chatGainersBorrow";
import { changeLabel, priceLabel, volumeLabel } from "@/lib/chatGainersFacts";
import type { LevelAbove } from "@/lib/stockClubLevels";

export const CLUB_ROOM = "club" as const;
export const CLUB_BOT = "club";
export const CLUB_AUTHOR = "Booker Stock Club";
export const CLUB_DESCRIPTION = "The #1 stock of the day";

// Who can open the room: clubRoomAccess in lib/chatAccess.ts.

// --- Rob's country weighting (Nov 8): these four rank ahead of every other country.
const PRIORITY = /(^|[^a-z])(china|hong kong|malaysia|singapore)([^a-z]|$)/i;

/** China, Hong Kong ("China Hong Kong" too), Malaysia or Singapore. Unknown (null) is not. */
export function isPriorityCountry(country: string | null | undefined): boolean {
  return !!country && PRIORITY.test(country);
}

export type ClubCandidate = { ticker: string; changePct: number };

/**
 * The day's ranking: stocks from the priority countries first, by % gain among themselves, then
 * everyone else by % gain. A stock whose country isn't known yet counts as not priority; the next
 * 15-minute run looks again once the lookup program has found it.
 */
export function rankCandidates<T extends ClubCandidate>(candidates: T[], countries: Map<string, string | null>): T[] {
  const priority = (c: T) => (isPriorityCountry(countries.get(c.ticker)) ? 0 : 1);
  return [...candidates].sort((a, b) => priority(a) - priority(b) || b.changePct - a.changePct || a.ticker.localeCompare(b.ticker));
}

/** #403: where the automatic #1 came from: today's Longboard morning report, or the club's own scan. */
export type ClubTopSource = "report" | "scan";

const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;

/**
 * #403: the #1 of today's Longboard morning report: the first ticker of the newest report version
 * whose sent_date is `day` (New York). A report for an older day (Friday's still refreshing on a
 * Monday morning) or an empty one gives null, and the club falls back to its own scan.
 */
export function reportTopTicker(row: { sent_date?: unknown; stocks_json?: unknown } | null | undefined, day: string): string | null {
  if (!row || typeof row.sent_date !== "string" || row.sent_date.slice(0, 10) !== day || !Array.isArray(row.stocks_json)) return null;
  const first = row.stocks_json[0] as { ticker?: unknown } | undefined;
  const ticker = typeof first?.ticker === "string" ? first.ticker.trim().toUpperCase() : "";
  return TICKER.test(ticker) ? ticker : null;
}

export type ClubDayState = { locked: boolean; posted: string[] };
export type PostDecision = "post" | "none" | "locked" | "same" | "done_for_day" | "already_posted";

/**
 * #403 (Rob, Nov 9): the room shows ONE stock each trading morning: the first run of the day posts
 * and nothing automatic follows. Set true (e.g. for a future higher tier) to post a new #1 during
 * the day again, under the rules below.
 */
export const CLUB_INTRADAY_UPDATES = false;

/**
 * Whether the automatic run posts `top` now. The first pick of the day posts. Once a day (the
 * default), that's all: any post today, automatic or an admin's, ends automatic posting for the
 * day. With intraday updates, a different #1 posts later, but never a stock already posted today
 * (no repeat posts for the same stock, even if the #1 swings back). An admin's pick stops automatic
 * changes for the rest of that day either way. The database checks the repeat and lock rules again
 * under a lock (post_chat_club_pick).
 */
export function decidePost(state: ClubDayState, top: string | null, intraday = CLUB_INTRADAY_UPDATES): PostDecision {
  if (!top) return "none";
  if (state.locked) return "locked";
  if (state.posted[state.posted.length - 1] === top) return "same";
  if (!intraday && state.posted.length > 0) return "done_for_day";
  if (state.posted.includes(top)) return "already_posted";
  return "post";
}

/** The 2-minute closes of the day so far, for the small chart: [minutes since 4 AM New York, close]. */
export type ClubChart = { start: number; points: [number, number][] };

/** What a post shows. Saved with the post; country, inst own and borrow are also read fresh. */
export type ClubPick = {
  ticker: string;
  name: string;
  day: string;
  at: string;
  source: "auto" | "admin";
  /** #403: automatic picks only: "report" (today's morning report #1) or "scan". Older picks lack it. */
  from?: ClubTopSource;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  marketCap: number | null;
  country: string | null;
  instOwnPct: number | null;
  borrow: GainersBorrow | null;
  levels: LevelAbove[];
  chart: ClubChart | null;
};

const NONE = "—";
export const countryText = (country: string | null) => country ?? "looking up…";
export const instOwnText = (pct: number | null) => (pct === null ? NONE : `${Number(pct.toFixed(1))}%`);
export const levelPrice = (price: number) => priceLabel({ price, changePct: null, volume: null });

/** At most six: the CMP and the 200 SMA always (when above price), then the nearest missed pivots. */
export function cardLevels(levels: LevelAbove[], max = 6) {
  const fixed = levels.filter((level) => level.kind !== "missed");
  const missed = levels.filter((level) => level.kind === "missed").slice(0, Math.max(0, max - fixed.length));
  return [...fixed, ...missed].sort((a, b) => a.price - b.price);
}

/** The post's plain text: what search, copy and a notification preview see. The card draws the rest. */
export function pickBody(pick: ClubPick): string {
  const quote = { price: pick.price, changePct: pick.changePct, volume: pick.volume };
  const lines = [
    `${pick.source === "admin" ? "Today's pick" : "#1 stock of the day"}: ${pick.ticker}${pick.name ? ` (${pick.name})` : ""}`,
    `${priceLabel(quote)} · ${changeLabel(quote)} today · Volume ${volumeLabel(quote)}`,
    `Country: ${countryText(pick.country)} · Inst own: ${instOwnText(pick.instOwnPct)} · Borrow at TZ: ${borrowLabel(pick.borrow)}`,
  ];
  lines.push(
    pick.levels.length
      ? `Levels above: ${cardLevels(pick.levels).map((level) => `${levelPrice(level.price)} ${level.label}`).join(" · ")}`
      : "Levels above: none",
  );
  return lines.join("\n");
}
