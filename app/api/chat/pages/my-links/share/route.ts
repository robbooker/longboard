import type { NextRequest } from "next/server";
import { parseLinkInput, TRADER_LINKS_SLUG } from "@/lib/chatPages";
import { pagesJson, readBody, requirePagesMember, UNAVAILABLE, validId } from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// LB-PAGES (#321): "Share" copies one of the member's own private links to Trader Links, added
// by them. The private link stays where it is.

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const body = await readBody(req);
  if (!validId(body?.id)) return pagesJson({ error: "That link can't be found." }, 404);
  try {
    const { data: own, error: ownError } = await viewer.admin
      .from("chat_private_links")
      .select("title, url, note")
      .eq("id", body!.id)
      .eq("member_id", viewer.memberId)
      .maybeSingle();
    if (ownError) return pagesJson({ error: UNAVAILABLE }, 503);
    if (!own) return pagesJson({ error: "That link can't be found." }, 404);
    // Saved before the https rule could change: checked again on the way out.
    const parsed = parseLinkInput(own);
    if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
    const { data: page, error: pageError } = await viewer.admin
      .from("chat_pages")
      .select("id")
      .eq("slug", TRADER_LINKS_SLUG)
      .eq("kind", "links")
      .eq("status", "approved")
      .maybeSingle();
    if (pageError || !page) return pagesJson({ error: UNAVAILABLE }, 503);
    const pageId = (page as { id: string }).id;
    const { data: existing, error: existingError } = await viewer.admin
      .from("chat_page_links")
      .select("id")
      .eq("page_id", pageId)
      .eq("url", parsed.value.url)
      .limit(1);
    if (existingError) return pagesJson({ error: UNAVAILABLE }, 503);
    if (existing?.length) return pagesJson({ error: "That link is already on Trader Links." }, 409);
    const { error } = await viewer.admin
      .from("chat_page_links")
      .insert({ page_id: pageId, ...parsed.value, added_by: viewer.memberId });
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ ok: true }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
