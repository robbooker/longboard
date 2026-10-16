import { requireChatUser } from "@/lib/chatAuth";
import { readEvents } from "@/lib/chatReads/events";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  return readEvents(req, await requireChatUser(req));
}
