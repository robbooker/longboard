import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { easternDay, type GainersTableDbRow } from "@/lib/chatGainersFacts";
import { buildNewsFeed, type NewsFeedData } from "@/lib/chatNews";
import { NEWS_TICKERS, readNewsSources } from "@/lib/chatNewsPolygon";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #383 News Feed: newest-first headlines from Polygon, the stocks in today's Gainers Table first
 * (the top 15 by latest alert, the same list the table shows), then the general market. For the
 * members who can open the Gainers room, the same rule as the Gainers Table, nobody else.
 * Polygon reads are cached a minute for every viewer; a slow or failed read leaves its part out
 * (partial: true). When nothing at all could be read the answer is a 503 and the page keeps what
 * it already shows. Without the gainers list (database down) the market headlines still come back.
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  let gainers: string[] = [];
  let partial = false;
  try {
    const db = createChatAdminClient();
    if (!db) throw new Error("no database");
    const { data, error } = await db.rpc("chat_gainers_table", { p_day: easternDay() });
    if (error) throw error;
    // The rows come newest alert first, as the table shows them.
    gainers = [...new Set(((data ?? []) as GainersTableDbRow[]).map((row) => row.ticker))].slice(0, NEWS_TICKERS);
  } catch {
    partial = true;
  }
  try {
    const sources = await readNewsSources(gainers);
    if (sources.okReads === 0) return json({ error: "news_unavailable" }, 503);
    const body: NewsFeedData = {
      gainers,
      items: buildNewsFeed(sources.gainerArticles, sources.marketArticles, gainers),
      partial: partial || sources.okReads < sources.reads,
    };
    return json(body);
  } catch {
    return json({ error: "news_unavailable" }, 503);
  }
}
