import type { NextRequest } from "next/server";
import { parseLinkInput } from "@/lib/chatPages";
import {
  pagesJson,
  projectLinks,
  readBody,
  readLikeSummary,
  readLinkReactions,
  readSavedLinks,
  requirePagesMember,
  UNAVAILABLE,
  validId,
  type LinkRow,
  type PagesViewer,
} from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// LB-PAGES (#321): a shared list of links (Trader Links, or a list page an admin added).
// Any member reads and adds; the adder or an admin edits or removes; only admins pin.
// #323: each link carries its like count and whether the viewer likes it; the list comes back
// ranked by likes (pinned first). Liking is /api/chat/pages/links/likes.
// #336: the list also says which links the viewer has saved, and each link's reactions.

const LINK_COLUMNS = "id, title, url, note, pinned, added_by, created_at";

/** The page exists, is approved (#329: never a suggestion) and is a shared list (never the private My Links or an embed). */
async function sharedListPage(viewer: PagesViewer, pageId: unknown) {
  if (!validId(pageId)) return false;
  const { data, error } = await viewer.admin.from("chat_pages").select("id, kind").eq("id", pageId).eq("status", "approved").maybeSingle();
  if (error) throw new Error("page_lookup_failed");
  return (data as { kind?: string } | null)?.kind === "links";
}

/** The link and whether this viewer may change it. */
async function ownedLink(viewer: PagesViewer, id: unknown) {
  if (!validId(id)) return null;
  const { data, error } = await viewer.admin.from("chat_page_links").select("id, added_by").eq("id", id).maybeSingle();
  if (error) throw new Error("link_lookup_failed");
  const row = data as { id: string; added_by: string | null } | null;
  if (!row) return null;
  return { row, canEdit: viewer.isAdmin || (!!row.added_by && row.added_by === viewer.memberId) };
}

export async function GET(req: NextRequest) {
  const gate = await requirePagesMember(req, false);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const pageId = req.nextUrl.searchParams.get("page");
  try {
    if (!(await sharedListPage(viewer, pageId))) return pagesJson({ error: "That page can't be found." }, 404);
    const { data, error } = await viewer.admin
      .from("chat_page_links")
      .select(LINK_COLUMNS)
      .eq("page_id", pageId!)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    // If likes can't be read the list still loads, without likes (the page hides them).
    const likes = await readLikeSummary(viewer, pageId!).catch(() => null);
    const rows = (data ?? []) as LinkRow[];
    // The same for saving and reactions: null hides them (#336, also before its migration is applied).
    const [saved, reactions] = await Promise.all([
      readSavedLinks(viewer, rows).catch(() => null),
      readLinkReactions(viewer, rows.map((row) => row.id)).catch(() => null),
    ]);
    return pagesJson({
      links: await projectLinks(viewer.admin, rows, viewer, true, likes),
      canPin: viewer.isAdmin,
      likes: likes !== null,
      saved,
      reactions,
    });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const body = await readBody(req);
  const parsed = parseLinkInput(body);
  if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
  try {
    if (!(await sharedListPage(viewer, body?.pageId))) return pagesJson({ error: "That page can't be found." }, 404);
    const { data, error } = await viewer.admin
      .from("chat_page_links")
      .insert({ page_id: body!.pageId, ...parsed.value, added_by: viewer.memberId })
      .select(LINK_COLUMNS)
      .single();
    if (error || !data) return pagesJson({ error: UNAVAILABLE }, 503);
    const [link] = await projectLinks(viewer.admin, [data as LinkRow], viewer, true);
    return pagesJson({ link }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const body = await readBody(req);
  const pinOnly = body && typeof body.pinned === "boolean" && body.title === undefined && body.url === undefined;
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (pinOnly) {
    if (!viewer.isAdmin) return pagesJson({ error: "Only admins can pin links." }, 403);
    update.pinned = body!.pinned;
  } else {
    if (body && body.pinned !== undefined) return pagesJson({ error: "Pin a link on its own." }, 400);
    const parsed = parseLinkInput(body);
    if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
    Object.assign(update, parsed.value);
  }
  try {
    const found = await ownedLink(viewer, body?.id);
    if (!found) return pagesJson({ error: "That link can't be found." }, 404);
    if (!found.canEdit) return pagesJson({ error: "Only the person who added a link, or an admin, can change it." }, 403);
    const { data, error } = await viewer.admin
      .from("chat_page_links")
      .update(update)
      .eq("id", found.row.id)
      .select(LINK_COLUMNS)
      .single();
    if (error || !data) return pagesJson({ error: UNAVAILABLE }, 503);
    const [link] = await projectLinks(viewer.admin, [data as LinkRow], viewer, true);
    return pagesJson({ link });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  try {
    const found = await ownedLink(viewer, req.nextUrl.searchParams.get("id"));
    if (!found) return pagesJson({ error: "That link can't be found." }, 404);
    if (!found.canEdit) return pagesJson({ error: "Only the person who added a link, or an admin, can remove it." }, 403);
    const { error } = await viewer.admin.from("chat_page_links").delete().eq("id", found.row.id);
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ ok: true });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
