import type { NextRequest } from "next/server";
import { isChatReaction } from "@/lib/chatMessageReactions";
import {
  pagesJson,
  readBody,
  readLinkReactions,
  requirePagesMember,
  sharedLink,
  UUID,
  validId,
  type PagesViewer,
} from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// #336: reactions on a link on a shared list. The same requests and answers as
// /api/chat/message-reactions, so the chat's reaction chips and picker work on links unchanged:
//   read    {messageIds} (up to 100)         -> {messages: {id: summaries}}
//   set     {messageId, emoji, active}       -> {messages: {id: summaries}}
//   details {messageId, emoji, after?}       -> {people, nextCursor}

const UNAVAILABLE = "reactions_unavailable";

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const body = await readBody(req);
  const action = body?.action;
  if (action !== "read" && action !== "set" && action !== "details") return pagesJson({ error: "invalid_target" }, 400);
  const ids = action === "read" ? body?.messageIds : [body?.messageId];
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(validId))
    return pagesJson({ error: "invalid_target" }, 400);
  if (action !== "read" && (!isChatReaction(body?.emoji) || (action === "set" && typeof body?.active !== "boolean")))
    return pagesJson({ error: "invalid_reaction" }, 400);
  if (action === "details" && body?.after != null && (typeof body.after !== "string" || !UUID.test(body.after)))
    return pagesJson({ error: "invalid_cursor" }, 400);
  try {
    if (action !== "read" && !(await sharedLink(viewer, ids[0]))) return pagesJson({ error: "link_not_found" }, 404);
    if (action === "details") return await details(viewer, ids[0], body!.emoji as string, body!.after as string | null | undefined);
    if (action === "set") {
      const reactions = viewer.admin.from("chat_page_link_reactions");
      const { error } = await (body!.active
        ? reactions.upsert(
            { link_id: ids[0], member_id: viewer.memberId, emoji: body!.emoji },
            { onConflict: "link_id,member_id,emoji", ignoreDuplicates: true },
          )
        : reactions.delete().eq("link_id", ids[0]).eq("member_id", viewer.memberId).eq("emoji", body!.emoji as string));
      if (error?.code === "23503") return pagesJson({ error: "link_not_found" }, 404); // Just removed.
      if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    }
    const summary = await readLinkReactions(viewer, ids);
    if (!summary) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ messages: Object.fromEntries(ids.map((id) => [id, summary[id] ?? []])) });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

/** Who used one emoji on one link, 50 at a time; only names leave here. */
async function details(viewer: PagesViewer, linkId: string, emoji: string, after?: string | null) {
  let query = viewer.admin.from("chat_page_link_reactions").select("member_id").eq("link_id", linkId).eq("emoji", emoji);
  if (after) query = query.gt("member_id", after);
  const { data, error } = await query.order("member_id", { ascending: true }).limit(51);
  if (error) return pagesJson({ error: "reaction_details_unavailable" }, 503);
  const rows = (data ?? []) as Array<{ member_id: string }>;
  const ids = rows.slice(0, 50).map((row) => row.member_id);
  const names = new Map<string, string>();
  if (ids.length) {
    const found = await viewer.admin.from("longboard_chat_members").select("id, display_name").in("id", ids);
    if (found.error) return pagesJson({ error: "reaction_details_unavailable" }, 503);
    for (const row of (found.data ?? []) as Array<{ id: string; display_name: string }>) names.set(row.id, row.display_name);
  }
  return pagesJson({
    people: ids.map((id) => ({ id, name: names.get(id) || "Member" })),
    nextCursor: rows.length > 50 ? ids[ids.length - 1] : null,
  });
}
