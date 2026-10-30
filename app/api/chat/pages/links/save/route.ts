import type { NextRequest } from "next/server";
import { parseLinkInput } from "@/lib/chatPages";
import { pagesJson, readBody, requirePagesMember, sharedLink, UNAVAILABLE, validId } from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// #336: "Save" copies a link on a shared list to the verified member's own My Links. It is a full
// copy, so it outlives the original and can be edited or removed like any other private link.
// Saving again changes nothing: the link is already saved if the member holds a copy of it, or
// already has that web address on My Links (typed in, or shared from there).

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const id = (await readBody(req))?.id;
  if (!validId(id)) return pagesJson({ error: "That link can't be found." }, 404);
  try {
    const link = await sharedLink(viewer, id);
    if (!link) return pagesJson({ error: "That link can't be found." }, 404);
    // Saved before the https rule could change: checked again on the way in, as Share does.
    const parsed = parseLinkInput(link);
    if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
    const mine = () => viewer.admin.from("chat_private_links").select("id").eq("member_id", viewer.memberId);
    const [copy, sameAddress] = await Promise.all([
      mine().eq("saved_from_link_id", id).limit(1),
      mine().eq("url", parsed.value.url).limit(1),
    ]);
    if (copy.error || sameAddress.error) return pagesJson({ error: UNAVAILABLE }, 503);
    if (copy.data?.length || sameAddress.data?.length) return pagesJson({ saved: true });
    const { error } = await viewer.admin
      .from("chat_private_links")
      .insert({ ...parsed.value, member_id: viewer.memberId, saved_from_link_id: id });
    if (error?.code === "23505") return pagesJson({ saved: true }); // A second tap got there first.
    if (error?.code === "23503") return pagesJson({ error: "That link can't be found." }, 404); // Just removed.
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ saved: true }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
