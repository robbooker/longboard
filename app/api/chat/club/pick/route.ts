import { NextRequest, NextResponse } from "next/server";
import { canAccessChatRoom } from "@/lib/chatAccess";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { borrowForDay } from "@/lib/chatGainersBorrowDb";
import type { ClubPick } from "@/lib/stockClub";
import { readFacts } from "@/lib/stockClubServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #386: one Booker Stock Club post's card, for the members who can open the room. The saved pick,
 * with the country, inst own and TradeZero borrow read fresh, since the lookup program often fills
 * those in a few minutes after the post.
 */
export async function GET(request: NextRequest) {
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "club")) return json({ error: "room_access_required" }, 403);
  const message = request.nextUrl.searchParams.get("message") ?? "";
  if (!UUID.test(message)) return json({ error: "invalid_message" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "club_unavailable" }, 503);
  try {
    const { data, error } = await db
      .from("chat_club_picks")
      .select("data")
      .eq("message_id", message)
      .maybeSingle();
    if (error) return json({ error: "club_unavailable" }, 503);
    if (!data) return json({ error: "not_found" }, 404);
    const pick = data.data as ClubPick;
    const [facts, borrows] = await Promise.all([
      readFacts(db, [pick.ticker]).catch(() => null),
      borrowForDay(db, pick.day),
    ]);
    const fresh = facts?.get(pick.ticker);
    const inst = fresh?.inst_own_pct;
    return json({
      pick: {
        ...pick,
        country: fresh?.country ?? pick.country,
        instOwnPct: inst === null || inst === undefined || inst === "" ? pick.instOwnPct : Number(inst),
        borrow: borrows?.get(pick.ticker) ?? pick.borrow,
      },
    });
  } catch {
    return json({ error: "club_unavailable" }, 503);
  }
}
