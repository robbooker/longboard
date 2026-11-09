// #403 Booker Stock Club: the morning report tells the club the moment it saves a version, so the
// club's #1 posts when Longboard gets it (the 5:30 AM CT build, or an admin's build by hand). Called
// from saveReportVersion in lib/morning-report/service.ts. It never fails or slows the report beyond
// the post itself: every error is logged and swallowed.
import { createChatAdminClient } from "@/lib/chatAdmin";
import { easternDay } from "@/lib/chatGainersFacts";
import { publishRoomEventAfterResponse } from "@/lib/chatRealtimePublish";
import { postReportPick, type TickResult } from "@/lib/stockClubServer";

/**
 * After a report version for `sentDate` is saved. Only today's report (New York) can post: a live
 * refresh of an older day's report (Friday's, refreshing on a Monday morning) does nothing.
 */
export async function clubAfterReportSaved(sentDate: string, now = new Date()): Promise<TickResult | null> {
  if (sentDate !== easternDay(now.getTime())) return null;
  const db = createChatAdminClient();
  if (!db) return null;
  try {
    const result = await postReportPick(db, now);
    if (result.status === "posted") publishRoomEventAfterResponse("club", { kind: "changed", topics: ["history"] });
    return result;
  } catch (e) {
    console.error("stock-club report post failed:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}
