import { createChatAdminClient } from "@/lib/chatAdmin";
import { gainersAuthorized } from "@/lib/chatGainers";
import { borrowNeeded, parseGainersBorrow } from "@/lib/chatGainersBorrow";
import { borrowForDay } from "@/lib/chatGainersBorrowDb";
import { parseGainersIb } from "@/lib/chatGainersIb";
import { newsCheckedForDay, newsNeeded, parseGainersNews } from "@/lib/chatGainersNews";
import { postGainersAlertNews } from "@/lib/chatGainersAlertNews";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { easternDay, factsNeeded, parseGainersFacts, type GainersTableDbRow } from "@/lib/chatGainersFacts";
import { clubLookupNeeds } from "@/lib/stockClubServer";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 32_768;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** #371: the lookup program's own token. It reaches only this route: today's tickers and their facts. */
function refused(request: NextRequest) {
  const secret = process.env.CHAT_GAINERS_LOOKUP_TOKEN;
  if (!secret || secret.length < 32) return json({ error: "lookup_not_configured" }, 503);
  if (!gainersAuthorized(request.headers.get("authorization"), secret))
    return json({ error: "unauthorized" }, 401);
  return null;
}

/**
 * GET: today's (Eastern) gainers tickers that still need a lookup, newest alert first.
 * #373: and, in `borrow`, the ones due a TradeZero borrow check (first sight, then every 15 minutes
 * while still alerting). Without the borrow table (not migrated yet) that list is empty.
 * #376: and, in `tickers`, every ticker in today's table (the Interactive Brokers rows to send).
 * #387: and, in `news`, the ones whose DilutionTracker News tab hasn't been read yet today. A ticker
 * leaves that list once one read is saved, until the next Eastern day. Without the news tables (not
 * migrated yet) that list is empty.
 * #386: needs and borrow also list the Booker Stock Club candidates (see clubLookupNeeds).
 */
export async function GET(request: NextRequest) {
  const denied = refused(request);
  if (denied) return denied;
  const db = createChatAdminClient();
  if (!db) return json({ error: "lookup_unavailable" }, 503);
  const day = easternDay();
  const { data, error } = await db.rpc("chat_gainers_table", { p_day: day });
  if (error) return json({ error: "lookup_unavailable" }, 503);
  const now = Date.now();
  const rows = (data ?? []) as GainersTableDbRow[];
  const needs = rows.flatMap((row) => {
    const fields = factsNeeded(row, now);
    return fields ? [{ ticker: row.ticker, fields }] : [];
  });
  const borrows = await borrowForDay(db, day);
  const borrow = borrows
    ? rows
        .filter((row) => borrowNeeded(row.last_alert_at, borrows.get(row.ticker), now))
        .map((row) => ({ ticker: row.ticker }))
    : [];
  const tickers = rows.map((row) => row.ticker);
  // #387: the tickers whose DilutionTracker news hasn't been read yet today (once a day each).
  const checked = rows.length ? await newsCheckedForDay(db, day) : null;
  const news = checked ? newsNeeded(tickers, checked) : [];
  // #386: and the Booker Stock Club's candidates that never alerted in Gainers, after Gainers' own.
  const club = await clubLookupNeeds(db, day, new Set(tickers), borrows, now);
  return json({ day, needs: [...needs, ...club.needs], borrow: [...borrow, ...club.borrow], tickers, news });
}

/**
 * POST: one ticker's lookup result. Saving never replaces a known value with an empty one.
 * #373: a body with kind "borrow" is one TradeZero borrow check instead, saved for today.
 * #376: a body with kind "ib" is Interactive Brokers' rows for some of today's tickers from one file.
 * #387/#436: a body with kind "news" is one DilutionTracker News read; once saved, the newest release
 * goes under the stock's first alert today (`headline` says whether it did, or why not).
 */
export async function POST(request: NextRequest) {
  const denied = refused(request);
  if (denied) return denied;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    return json({ error: "invalid_content_type" }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "invalid_json" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      // #376: an "ib" post carries up to 200 rows (about 20 KB).
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return json({ error: "payload_too_large" }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (payload && typeof payload === "object" && (payload as { kind?: unknown }).kind === "news") {
    const news = parseGainersNews(payload);
    if (!news) return json({ error: "invalid_news" }, 400);
    const db = createChatAdminClient();
    if (!db) return json({ error: "lookup_unavailable" }, 503);
    const day = easternDay();
    const { data, error } = await db.rpc("save_chat_gainers_news", {
      p_day: day,
      p_ticker: news.ticker,
      p_items: news.items,
    });
    if (error) return json({ error: "lookup_unavailable" }, 503);
    // #436: the newest release under the stock's first alert today (once; the database decides and
    // guards). A failure here never fails the saved read.
    const headline = await postGainersAlertNews(db, day, news.ticker);
    if (headline === "posted")
      publishRoomEventAfterResponse("gainers", { kind: "changed", topics: ["history"] });
    return json({
      saved: typeof data === "number" ? data : news.items.length,
      ticker: news.ticker,
      kind: "news",
      headline,
    });
  }
  if (payload && typeof payload === "object" && (payload as { kind?: unknown }).kind === "ib") {
    const ib = parseGainersIb(payload);
    if (!ib) return json({ error: "invalid_ib" }, 400);
    const db = createChatAdminClient();
    if (!db) return json({ error: "lookup_unavailable" }, 503);
    const { data, error } = await db.rpc("save_chat_gainers_ib", {
      p_file_time: ib.fileTime,
      p_rows: ib.rows.map((row) => ({
        ticker: row.ticker,
        fee_pct: row.feePct,
        rebate_pct: row.rebatePct,
        available: row.available,
        available_more: row.availableMore,
      })),
    });
    if (error) return json({ error: "lookup_unavailable" }, 503);
    return json({ saved: typeof data === "number" ? data : ib.rows.length, kind: "ib" });
  }
  if (payload && typeof payload === "object" && "kind" in payload) {
    const borrow = parseGainersBorrow(payload);
    if (!borrow) return json({ error: "invalid_borrow" }, 400);
    const db = createChatAdminClient();
    if (!db) return json({ error: "lookup_unavailable" }, 503);
    const { error } = await db.rpc("save_chat_gainers_borrow", {
      p_day: easternDay(),
      p_ticker: borrow.ticker,
      p_status: borrow.status,
      p_etb: borrow.etb,
      p_price_per_share: borrow.pricePerShare,
      p_locate_type: borrow.locateType,
    });
    if (error) return json({ error: "lookup_unavailable" }, 503);
    return json({ saved: true, ticker: borrow.ticker, kind: "borrow" });
  }
  const facts = parseGainersFacts(payload);
  if (!facts) return json({ error: "invalid_facts" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "lookup_unavailable" }, 503);
  const { error } = await db.rpc("save_chat_gainers_facts", {
    p_ticker: facts.ticker,
    p_country: facts.country,
    p_cash_usd: facts.cashUsd,
    p_cash_months_left: facts.cashMonthsLeft,
    p_cash_flow_positive: facts.cashFlowPositive,
    p_inst_own_pct: facts.instOwnPct,
    p_not_found: facts.notFound,
  });
  if (error) return json({ error: "lookup_unavailable" }, 503);
  return json({ saved: true, ticker: facts.ticker });
}
