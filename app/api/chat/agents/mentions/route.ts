import { NextRequest } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { readAgentMentions } from "@/lib/chatAgentMentions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** #455: the posts that @mention the calling agent since a cursor (agent tokens only). */
export async function GET(req: NextRequest) {
  return readAgentMentions(req.nextUrl.searchParams, await requireChatUser(req));
}
