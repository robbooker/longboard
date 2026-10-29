import type { NextRequest } from "next/server";
import { parseLinkInput } from "@/lib/chatPages";
import {
  pagesJson,
  projectLinks,
  readBody,
  requirePagesMember,
  UNAVAILABLE,
  validId,
  type LinkRow,
} from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// LB-PAGES (#321): each trader's private links. Every read and write is limited to the verified
// member's own rows (member_id), so no one else's links can be seen, changed or guessed at;
// admins get no extra access here.

const COLUMNS = "id, title, url, note, created_at";

export async function GET(req: NextRequest) {
  const gate = await requirePagesMember(req, false);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  try {
    const { data, error } = await viewer.admin
      .from("chat_private_links")
      .select(COLUMNS)
      .eq("member_id", viewer.memberId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ links: await projectLinks(viewer.admin, (data ?? []) as LinkRow[], viewer, false) });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const parsed = parseLinkInput(await readBody(req));
  if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
  try {
    const { data, error } = await viewer.admin
      .from("chat_private_links")
      .insert({ ...parsed.value, member_id: viewer.memberId })
      .select(COLUMNS)
      .single();
    if (error || !data) return pagesJson({ error: UNAVAILABLE }, 503);
    const [link] = await projectLinks(viewer.admin, [data as LinkRow], viewer, false);
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
  if (!validId(body?.id)) return pagesJson({ error: "That link can't be found." }, 404);
  const parsed = parseLinkInput(body);
  if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
  try {
    const { data, error } = await viewer.admin
      .from("chat_private_links")
      .update({ ...parsed.value, updated_at: new Date().toISOString() })
      .eq("id", body!.id)
      .eq("member_id", viewer.memberId)
      .select(COLUMNS)
      .maybeSingle();
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    if (!data) return pagesJson({ error: "That link can't be found." }, 404);
    const [link] = await projectLinks(viewer.admin, [data as LinkRow], viewer, false);
    return pagesJson({ link });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const viewer = gate.viewer;
  const id = req.nextUrl.searchParams.get("id");
  if (!validId(id)) return pagesJson({ error: "That link can't be found." }, 404);
  try {
    const { data, error } = await viewer.admin
      .from("chat_private_links")
      .delete()
      .eq("id", id)
      .eq("member_id", viewer.memberId)
      .select("id");
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    if (!data?.length) return pagesJson({ error: "That link can't be found." }, 404);
    return pagesJson({ ok: true });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
