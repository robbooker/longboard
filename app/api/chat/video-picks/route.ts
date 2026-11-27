import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requirePagesMember } from "@/lib/chatPagesServer";
import { readPicksAnswer, VIDEO_PICKS_SLUG } from "@/lib/videoPicksServer";
export const dynamic = "force-dynamic";

// #529 Booker Tube: the list the page shows. Any signed-in chat member reads it (the same
// people who have Pages); nobody else. The list changes once a day, so a browser keeps its copy
// for five minutes and then asks "anything new?" (an unchanged list answers 304, with no body).
// Never indexed, and the answer carries no phrases, weights or notes: only cards and filters.

const HEADERS = {
  "Cache-Control": "private, max-age=300",
  Vary: "Cookie",
  "X-Robots-Tag": "noindex, nofollow",
};
const NO_STORE = { "Cache-Control": "private, no-store" };
const UNAVAILABLE = "The video picks are unavailable. Please try again.";

export async function GET(req: NextRequest) {
  const gate = await requirePagesMember(req, false);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin } = gate.viewer;
  try {
    // An admin may have just changed the list, so an admin always reads it again and keeps no copy.
    const found = await readPicksAnswer(admin, VIDEO_PICKS_SLUG, { fresh: isAdmin });
    if (!found) return NextResponse.json({ error: UNAVAILABLE }, { status: 404, headers: NO_STORE });
    if (isAdmin)
      return NextResponse.json(
        { ...found.answer, canManage: true },
        { headers: { ...NO_STORE, "X-Robots-Tag": HEADERS["X-Robots-Tag"] } },
      );
    const headers = { ...HEADERS, ETag: found.etag };
    if (req.headers.get("if-none-match") === found.etag)
      return new NextResponse(null, { status: 304, headers });
    return NextResponse.json({ ...found.answer, canManage: false }, { headers });
  } catch {
    return NextResponse.json({ error: UNAVAILABLE }, { status: 503, headers: NO_STORE });
  }
}
