import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { easternDay, type GainersTableDbRow } from "@/lib/chatGainersFacts";
import { DT_KEEP_DAYS, mergeNewsFeed, type DtNewsRow, type NewsFeedData } from "@/lib/chatNews";
import { readFmpNews } from "@/lib/chatNewsFmp";
import { NEWS_TICKERS, readNewsSources } from "@/lib/chatNewsPolygon";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
/** #387: the chip row and DilutionTracker's releases cover this many of today's gainers. */
const FEED_TICKERS = 30;

/**
 * #383 News Feed: newest-first headlines, the stocks in today's Gainers Table first, then the
 * general market. For the members who can open the Gainers room, the same rule as the Gainers
 * Table, nobody else.
 *
 * #387: the gainers' part is every press release DilutionTracker lists for them (read once a day
 * by the lookup program and saved; the last three days show, older ones under the stock's chip)
 * plus Polygon's stories for the top 15; the market part is Polygon's and FMP's. Polygon and FMP
 * reads are cached a minute for every viewer; a slow or failed read leaves its part out
 * (partial: true). When nothing at all could be read the answer is a 503 and the page keeps what it
 * already shows. Without the gainers list (database down) the market headlines still come back.
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const now = Date.now();
  let gainers: string[] = [];
  let partial = false;
  const db = createChatAdminClient();
  try {
    if (!db) throw new Error("no database");
    const { data, error } = await db.rpc("chat_gainers_table", { p_day: easternDay() });
    if (error) throw error;
    // The rows come newest alert first, as the table shows them.
    gainers = [...new Set(((data ?? []) as GainersTableDbRow[]).map((row) => row.ticker))].slice(0, FEED_TICKERS);
  } catch {
    partial = true;
  }
  // #387: the saved releases. Not there yet (migration not applied) or unreadable: the feed goes on without them.
  const dtRead = async (): Promise<DtNewsRow[]> => {
    if (!db || !gainers.length) return [];
    try {
      const since = new Date(now - DT_KEEP_DAYS * 86_400_000).toISOString();
      const { data, error } = await db.rpc("chat_gainers_news_for", { p_tickers: gainers, p_since: since });
      return error || !Array.isArray(data) ? [] : (data as DtNewsRow[]);
    } catch {
      return [];
    }
  };
  try {
    const [dtRows, sources, fmp] = await Promise.all([dtRead(), readNewsSources(gainers.slice(0, NEWS_TICKERS)), readFmpNews(now)]);
    const okReads = sources.okReads + fmp.okReads;
    if (okReads === 0 && dtRows.length === 0) return json({ error: "news_unavailable" }, 503);
    const body: NewsFeedData = {
      gainers,
      items: mergeNewsFeed({
        dtRows,
        gainerArticles: sources.gainerArticles,
        marketArticles: sources.marketArticles,
        fmpArticles: fmp.articles,
        gainers,
        now,
      }),
      partial: partial || okReads < sources.reads + fmp.reads,
    };
    return json(body);
  } catch {
    return json({ error: "news_unavailable" }, 503);
  }
}
