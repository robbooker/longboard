import { canAccessChatRoom } from "@/lib/chatAccess";
import { requestOriginAllowed } from "@/lib/chatAdmin";
import { requireChatUser } from "@/lib/chatAuth";
import { isDefaultPlace, placeById } from "@/lib/gainerBalloons/places.server";
import { parseCoords } from "@/lib/gainerBalloons/weather";
import { weatherAllowed, weatherFor } from "@/lib/gainerBalloons/weather.server";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const MAX_BYTES = 200;

/**
 * #528 Gainer Balloons: the weather behind the balloons. POST {} answers New York's; POST
 * {lat, lon} (already rounded to one decimal place by the browser, about 10 km) answers that area's
 * when it is covered, otherwise New York's with covered: false. POST {place: "tx:austin"} (#531: a
 * place the member chose by typing its name; the id comes from the places route) answers that
 * place's, under its own name; New York, NY is the default again.
 *  - The place travels in the body, never in the address, so it is in no access log; this route
 *    writes it nowhere (no log, no database, nothing tied to the member) and rounds it again itself.
 *  - Same members as the balloons; at most 20 asks per member per 10 minutes.
 *  - Any failure answers weather: null and the page keeps its plain time-of-day sky.
 */
export async function POST(request: NextRequest) {
  if (!requestOriginAllowed(request)) return json({ error: "origin_not_allowed" }, 403);
  const auth = await requireChatUser(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  if (!canAccessChatRoom(auth.access, "gainers")) return json({ error: "room_access_required" }, 403);
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BYTES) return json({ error: "invalid_place" }, 400);
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "invalid_place" }, 400);
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_place" }, 400);
  const { lat, lon, place } = body as { lat?: unknown; lon?: unknown; place?: unknown };
  const given = lat !== undefined || lon !== undefined;
  // One or the other: a chosen place, or the browser's own (rounded) position.
  if (given && place !== undefined) return json({ error: "invalid_place" }, 400);
  const chosen = place !== undefined ? placeById(place) : null;
  if (place !== undefined && !chosen) return json({ error: "invalid_place" }, 400);
  const typed = chosen && !isDefaultPlace(chosen) ? chosen : null;
  const coords = typed ? parseCoords(typed.lat, typed.lon) : given ? parseCoords(lat, lon) : null;
  if ((given || typed) && !coords) return json({ error: "invalid_place" }, 400);
  if (!weatherAllowed(auth.user.id)) return json({ error: "slow_down" }, 429);
  try {
    return json(await weatherFor(coords, Date.now(), typed?.name));
  } catch {
    return json({ weather: null, covered: true });
  }
}
