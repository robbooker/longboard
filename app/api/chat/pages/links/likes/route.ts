import type { NextRequest } from "next/server";
import {
  pagesJson,
  readBody,
  readLikeSummary,
  requirePagesMember,
  UNAVAILABLE,
  validId,
  type PagesViewer,
} from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// #323 LB-PAGES-LIKES: like (POST {id}) or take back a like (DELETE ?id=) on a link on a shared
// list page. One like per member per link; nobody likes their own link; links on anything but a
// shared list can't be liked. Answers with the link's count and whether the viewer likes it, so
// the page can settle its optimistic update.

/** The link, if it is on a shared list page, and whether the viewer added it. */
async function likeableLink(viewer: PagesViewer, id: unknown) {
  if (!validId(id)) return null;
  const { data, error } = await viewer.admin
    .from("chat_page_links")
    .select("id, page_id, added_by")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("link_lookup_failed");
  const row = data as { id: string; page_id: string; added_by: string | null } | null;
  if (!row) return null;
  const page = await viewer.admin.from("chat_pages").select("id, kind").eq("id", row.page_id).eq("status", "approved").maybeSingle();
  if (page.error) throw new Error("page_lookup_failed");
  if ((page.data as { kind?: string } | null)?.kind !== "links") return null;
  return { row, own: !!row.added_by && row.added_by === viewer.memberId };
}

async function change(req: NextRequest, like: boolean) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const id = like ? (await readBody(req))?.id : req.nextUrl.searchParams.get("id");
  if (!validId(id)) return pagesJson({ error: "That link can't be found." }, 404);
  try {
    const found = await likeableLink(viewer, id);
    if (!found) return pagesJson({ error: "That link can't be found." }, 404);
    if (found.own) return pagesJson({ error: "You can't like your own link." }, 403);
    const write = like
      ? viewer.admin
          .from("chat_page_link_likes")
          .upsert({ link_id: found.row.id, member_id: viewer.memberId }, { onConflict: "link_id,member_id", ignoreDuplicates: true })
      : viewer.admin.from("chat_page_link_likes").delete().eq("link_id", found.row.id).eq("member_id", viewer.memberId);
    const { error } = await write;
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    const summary = await readLikeSummary(viewer, found.row.page_id, found.row.id);
    if (!summary) return pagesJson({ error: UNAVAILABLE }, 503);
    const now = summary.get(found.row.id) ?? { likeCount: 0, likedByMe: false };
    return pagesJson({ id: found.row.id, ...now });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function POST(req: NextRequest) {
  return change(req, true);
}

export async function DELETE(req: NextRequest) {
  return change(req, false);
}
