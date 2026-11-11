import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { easternDay, gainersRowLeftOff, tableRow, type GainersTableDbRow } from "@/lib/chatGainersFacts";
import { gainersSnapshots, type GainersSnapshot } from "@/lib/chatGainersQuotes";
import { gainersShares } from "@/lib/chatGainersShares";
import { borrowForDay } from "@/lib/chatGainersBorrowDb";
import { ibForTickers } from "@/lib/chatGainersIbDb";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * #371 Gainers Table: one row per stock that alerted in the gainers room today (Eastern), newest
 * alert first, with its saved facts. For the members who can open the gainers room, nobody else.
 * #372: each row also carries its price, % today and volume today from Polygon's snapshot (cached
 * 15 seconds for all viewers); without a snapshot the row still comes back, with quote null.
 * #373: and today's TradeZero borrow check, or borrow null before the first one.
 * #376: and Interactive Brokers' latest fee and shares available, or ib null when there's none.
 * #433: a stock that was below yesterday's close when it alerted is left off: one whose only alerts
 * were after hours (up from today's close) at or below yesterday's close, which comes from the same
 * snapshot as the quotes. Without that close, or before the function has the #433 columns, every
 * row stays (gainersRowLeftOff in lib/chatGainersFacts.ts).
 * #442: and its shares outstanding from Polygon's ticker details (cached a day), or null; the table
 * multiplies them by the row's price for Market Cap.
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const db = createChatAdminClient();
  if (!db) return json({ error: "table_unavailable" }, 503);
  const day = easternDay();
  try {
    const { data, error } = await db.rpc("chat_gainers_table", { p_day: day });
    if (error) return json({ error: "table_unavailable" }, 503);
    const dbRows = (data ?? []) as GainersTableDbRow[];
    const tickers = dbRows.map((row) => row.ticker);
    const [snapshots, borrows, ibs, shares] = dbRows.length
      ? await Promise.all([
          // The table without prices beats no table.
          gainersSnapshots(tickers).catch(() => new Map<string, GainersSnapshot>()),
          borrowForDay(db, day),
          ibForTickers(db, tickers),
          gainersShares(tickers).catch(() => new Map<string, number | null>()),
        ])
      : [new Map<string, GainersSnapshot>(), null, null, new Map<string, number | null>()];
    const rows = dbRows.filter((row) => !gainersRowLeftOff(row, snapshots.get(row.ticker)?.prevClose)).map(tableRow);
    return json({
      day,
      rows: rows.map((row) => ({ ...row, quote: snapshots.get(row.sym)?.quote ?? null, borrow: borrows?.get(row.sym) ?? null,
        ib: ibs?.get(row.sym) ?? null, sharesOutstanding: shares.get(row.sym) ?? null,
      })),
    });
  } catch {
    return json({ error: "table_unavailable" }, 503);
  }
}
