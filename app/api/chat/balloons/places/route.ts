import { canAccessChatRoom } from "@/lib/chatAccess";
import { requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { PLACE_QUERY_MAX, placeSearchAllowed, searchPlaces } from "@/lib/gainerBalloons/places.server";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const MAX_BYTES = 400;

/**
 * #531 Gainer Balloons: "Change weather". POST {q: "austin tx"} answers up to six U.S. places as
 * {id, name, label: "Austin, TX"}; the browser then asks the weather route for the chosen id.
 *  - What was typed travels in the body, never in the address, so it is in no access log; this
 *    route writes it nowhere.
 *  - Same members as the balloons; at most 60 searches per member per minute.
 */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BYTES) return json({ error: "invalid_search" }, 400);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "invalid_search" }, 400);
  }
  const q = body && typeof body === "object" && !Array.isArray(body) ? (body as { q?: unknown }).q : undefined;
  if (typeof q !== "string" || q.length > PLACE_QUERY_MAX) return json({ error: "invalid_search" }, 400);
  if (!placeSearchAllowed(auth.user.id)) return json({ error: "slow_down" }, 429);
  return json({ places: searchPlaces(q).map(({ id, name, label }) => ({ id, name, label })) });
}
