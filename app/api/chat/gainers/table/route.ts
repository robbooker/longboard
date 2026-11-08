import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { easternDay, tableRow, type GainersQuote, type GainersTableDbRow } from "@/lib/chatGainersFacts";
import { gainersQuotes } from "@/lib/chatGainersQuotes";
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
    const rows = ((data ?? []) as GainersTableDbRow[]).map(tableRow);
    const [quotes, borrows, ibs] = rows.length
      ? await Promise.all([
          // The table without prices beats no table.
          gainersQuotes(rows.map((row) => row.sym)).catch(() => new Map<string, GainersQuote | null>()),
          borrowForDay(db, day),
          ibForTickers(db, rows.map((row) => row.sym)),
        ])
      : [new Map<string, GainersQuote | null>(), null, null];
    return json({
      day,
      rows: rows.map((row) => ({ ...row, quote: quotes.get(row.sym) ?? null, borrow: borrows?.get(row.sym) ?? null,
        ib: ibs?.get(row.sym) ?? null,
      })),
    });
  } catch {
    return json({ error: "table_unavailable" }, 503);
  }
}
