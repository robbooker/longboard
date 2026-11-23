import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { gainersAuthorized } from "@/lib/chatGainers";
import { readFmpNews } from "@/lib/chatNewsFmp";
import { cachedNews } from "@/lib/chatNewsPolygon";
import {
  GAINER_NEWS_DAYS,
  GAINERS_ROOM,
  MISSING,
  PRODUCER_FEED_TOKEN_ENV,
  PRODUCER_ROOM,
  easternToday,
  feedWindow,
  gainerHeadlines,
  isMemberQuestion,
  marketHeadlines,
  parseFeedDate,
  parseGainersLimit,
  pickQuestion,
  rankPremarketGainers,
  type GainerNewsRow,
  type GainersAlertRow,
  type ProducerFeed,
  type ProducerGainer,
  type ProducerMarketHeadline,
  type ProducerQuestion,
  type RoomMessageRow,
} from "@/lib/producerFeed";

// #484 PRODUCER-FEED: GET /api/producer/morning?date=YYYY-MM-DD[&limit=N], the read-only morning
// feed for the Producer agent in Marketing HQ. Its own token (PRODUCER_FEED_TOKEN) reaches only
// this route, and this route only reads: the Gainers room's premarket alerts with their saved
// DilutionTracker facts and releases, the general market headlines (Polygon and FMP), and one
// unanswered ShortScout member question (first name only). Nothing from other rooms or DMs.
// A part that fails or has no data is left empty with a plain-English note in `missing`; the
// answer is still 200.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const PAGE_ROWS = 1000;
const MAX_ALERT_ROWS = 5000;
const MAX_ROOM_MESSAGES = 300;
const REPLY_CHUNK = 100;

class ReadError extends Error {}

async function readAlerts(db: SupabaseClient, start: number, until: number): Promise<GainersAlertRow[]> {
  const rows: GainersAlertRow[] = [];
  if (until <= start) return rows;
  for (let from = 0; from < MAX_ALERT_ROWS; from += PAGE_ROWS) {
    const { data, error } = await db
      .from("longboard_chat_messages")
      .select("id,created_at,body")
      .eq("room_slug", GAINERS_ROOM)
      .is("reply_to_id", null)
      .eq("removed", false)
      .gte("created_at", new Date(start).toISOString())
      .lt("created_at", new Date(until).toISOString())
      .order("created_at")
      .order("id")
      .range(from, from + PAGE_ROWS - 1);
    if (error) throw new ReadError("alerts");
    rows.push(...((data ?? []) as GainersAlertRow[]));
    if ((data ?? []).length < PAGE_ROWS) break;
  }
  return rows;
}

async function readGainers(
  db: SupabaseClient,
  start: number,
  until: number,
  limit: number,
  missing: string[],
): Promise<ProducerGainer[]> {
  let ranked;
  try {
    ranked = rankPremarketGainers(await readAlerts(db, start, until), until, limit);
  } catch {
    missing.push(MISSING.gainersError);
    return [];
  }
  if (!ranked.length) {
    missing.push(MISSING.gainers);
    return [];
  }
  const symbols = ranked.map((g) => g.symbol);
  const [facts, news] = await Promise.all([
    db.from("chat_gainers_facts").select("ticker,country").in("ticker", symbols),
    db.rpc("chat_gainers_news_for", {
      p_tickers: symbols,
      p_since: new Date(start - GAINER_NEWS_DAYS * 86_400_000).toISOString(),
    }),
  ]);
  const countries = new Map<string, string>();
  if (facts.error) missing.push(MISSING.countryError);
  else
    for (const row of (facts.data ?? []) as Array<{ ticker: string; country: string | null }>)
      if (row.country) countries.set(row.ticker, row.country);
  if (news.error) missing.push(MISSING.gainerNewsError);
  const headlines = gainerHeadlines(news.error ? [] : ((news.data ?? []) as GainerNewsRow[]), until);
  return ranked.map((g) => ({
    ...g,
    country: countries.get(g.symbol) ?? null,
    headlines: headlines.get(g.symbol) ?? [],
  }));
}

const QUESTION_COLUMNS =
  "id,author_label,body,created_at,reply_to_id,member_id,guest_id,bot_slug,agent_id,deleted_at,removed";

async function readQuestion(
  db: SupabaseClient,
  since: number,
  until: number,
  missing: string[],
): Promise<ProducerQuestion | null> {
  try {
    if (until <= since) {
      missing.push(MISSING.question);
      return null;
    }
    const { data, error } = await db
      .from("longboard_chat_messages")
      .select(QUESTION_COLUMNS)
      .eq("room_slug", PRODUCER_ROOM)
      .is("reply_to_id", null)
      .is("deleted_at", null)
      .eq("removed", false)
      .is("bot_slug", null)
      .is("agent_id", null)
      .not("member_id", "is", null)
      .gte("created_at", new Date(since).toISOString())
      .lt("created_at", new Date(until).toISOString())
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_ROOM_MESSAGES);
    if (error) throw new ReadError("questions");
    const asked = ((data ?? []) as RoomMessageRow[]).filter(isMemberQuestion);
    const replies: RoomMessageRow[] = [];
    for (let i = 0; i < asked.length; i += REPLY_CHUNK) {
      const ids = asked.slice(i, i + REPLY_CHUNK).map((m) => m.id);
      const read = await db
        .from("longboard_chat_messages")
        .select(QUESTION_COLUMNS)
        .eq("room_slug", PRODUCER_ROOM)
        .in("reply_to_id", ids)
        .is("deleted_at", null)
        .eq("removed", false)
        .limit(5000);
      if (read.error) throw new ReadError("replies");
      replies.push(...((read.data ?? []) as RoomMessageRow[]));
    }
    const question = pickQuestion(asked, replies);
    if (!question) missing.push(MISSING.question);
    return question;
  } catch {
    missing.push(MISSING.questionError);
    return null;
  }
}

async function readMarketHeadlines(isToday: boolean, missing: string[]): Promise<ProducerMarketHeadline[]> {
  if (!isToday) {
    missing.push(MISSING.headlinesPast);
    return [];
  }
  const polygonOn = !!process.env.POLYGON_API_KEY;
  const [polygon, fmp] = await Promise.all([
    polygonOn ? cachedNews(null) : Promise.resolve({ ok: false, articles: [] }),
    readFmpNews().catch(() => ({ configured: true, okReads: 0, reads: 2, articles: [] })),
  ]);
  if (!polygonOn) missing.push(MISSING.polygonOff);
  else if (!polygon.ok) missing.push(MISSING.polygonError);
  if (!fmp.configured) missing.push(MISSING.fmpOff);
  else if (fmp.okReads < fmp.reads) missing.push(MISSING.fmpError);
  const headlines = marketHeadlines(polygon.articles, fmp.articles);
  if (!headlines.length) missing.push(MISSING.headlines);
  return headlines;
}

/** GET: the morning feed for one New York day (today when no date). Read-only. */
export async function GET(request: NextRequest) {
  const secret = process.env[PRODUCER_FEED_TOKEN_ENV];
  if (!secret || secret.length < 32) return json({ error: "producer_feed_not_configured" }, 503);
  if (!gainersAuthorized(request.headers.get("authorization"), secret)) return json({ error: "unauthorized" }, 401);

  const now = Date.now();
  const date = parseFeedDate(request.nextUrl.searchParams.get("date"), now);
  if (!date) return json({ error: "invalid_date" }, 400);
  const limit = parseGainersLimit(request.nextUrl.searchParams.get("limit"));
  if (!limit) return json({ error: "invalid_limit" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "producer_feed_unavailable" }, 503);

  const window = feedWindow(date, now);
  const gainersMissing: string[] = [];
  const headlinesMissing: string[] = [];
  const questionMissing: string[] = [];
  const [gainers, market_headlines, question] = await Promise.all([
    readGainers(db, window.dayStart, window.until, limit, gainersMissing),
    readMarketHeadlines(date === easternToday(now), headlinesMissing),
    readQuestion(db, window.questionsSince, window.until, questionMissing),
  ]);
  const feed: ProducerFeed = {
    date,
    generated_at: new Date(now).toISOString(),
    gainers,
    market_headlines,
    question,
    missing: [...gainersMissing, ...headlinesMissing, ...questionMissing],
  };
  return json(feed);
}
