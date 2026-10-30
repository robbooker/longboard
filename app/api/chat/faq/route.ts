import type { NextRequest } from "next/server";
import { parseFaqItemInput, type ChatFaqItem } from "@/lib/chatFaq";
import { pagesJson, readBody, requirePagesMember, validId } from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// #332 LB-FAQ: the FAQ page's items. Any chat member reads them; only admins change them. Whether
// the caller is an admin comes from the verified viewer, never from anything the caller sent.

const UNAVAILABLE = "The FAQ is unavailable. Please try again.";
const ONLY_ADMINS = "Only admins can change the FAQ.";
const COLUMNS = "id, question, answer";

export async function GET(req: NextRequest) {
  const gate = await requirePagesMember(req, false);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin } = gate.viewer;
  try {
    const { data, error } = await admin
      .from("chat_faq_items")
      .select(COLUMNS)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ items: (data ?? []) as ChatFaqItem[], canManage: isAdmin });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin, memberId } = gate.viewer;
  if (!isAdmin) return pagesJson({ error: ONLY_ADMINS }, 403);
  const parsed = parseFaqItemInput(await readBody(req));
  if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
  try {
    // A new item goes at the end of the page.
    const last = await admin.from("chat_faq_items").select("position").order("position", { ascending: false }).limit(1);
    if (last.error) return pagesJson({ error: UNAVAILABLE }, 503);
    const position = (((last.data ?? [])[0] as { position?: number } | undefined)?.position ?? 0) + 10;
    const { data, error } = await admin
      .from("chat_faq_items")
      .insert({ ...parsed.value, position, created_by: memberId, updated_by: memberId })
      .select(COLUMNS)
      .single();
    if (error || !data) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ item: data as ChatFaqItem }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function PATCH(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin, memberId } = gate.viewer;
  if (!isAdmin) return pagesJson({ error: ONLY_ADMINS }, 403);
  const body = await readBody(req);
  if (!validId(body?.id)) return pagesJson({ error: "That FAQ item is gone." }, 404);
  const parsed = parseFaqItemInput(body);
  if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
  try {
    const { data, error } = await admin
      .from("chat_faq_items")
      .update({ ...parsed.value, updated_by: memberId, updated_at: new Date().toISOString() })
      .eq("id", body.id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    if (!data) return pagesJson({ error: "That FAQ item is gone." }, 404);
    return pagesJson({ item: data as ChatFaqItem });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin } = gate.viewer;
  if (!isAdmin) return pagesJson({ error: ONLY_ADMINS }, 403);
  const id = req.nextUrl.searchParams.get("id");
  if (!validId(id)) return pagesJson({ error: "That FAQ item is gone." }, 404);
  try {
    const { error } = await admin.from("chat_faq_items").delete().eq("id", id);
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ ok: true });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
