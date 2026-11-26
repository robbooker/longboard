import type { NextRequest } from "next/server";
import { pagesJson, requirePagesMember } from "@/lib/chatPagesServer";
import { refreshCollection, VIDEO_PICKS_SLUG } from "@/lib/videoPicksServer";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// #529 Booker Tube: "Refresh now" for admins, the same run the daily job does.

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  if (!gate.viewer.isAdmin) return pagesJson({ error: "Only admins can refresh the picks." }, 403);
  try {
    const outcome = await refreshCollection(gate.viewer.admin, VIDEO_PICKS_SLUG);
    if (!outcome) return pagesJson({ error: "The video picks are unavailable. Please try again." }, 404);
    const { stats } = outcome;
    return pagesJson({
      stored: outcome.stored,
      reason: outcome.reason,
      videos: stats.videos,
      channels: stats.channels,
      succeeded: stats.succeeded,
      failed: stats.failed.map(({ name, error }) => ({ name, error })),
    });
  } catch {
    return pagesJson({ error: "The refresh didn't finish. Please try again." }, 503);
  }
}
