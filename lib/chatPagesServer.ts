import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { findChatMember } from "@/lib/chatMembers";
import { canUseChatPages, sortPageLinks, type ChatPageLink } from "@/lib/chatPages";

// LB-PAGES (#321): every Pages route goes through here. The tables have RLS on and no policies;
// only the service role reads them, and only for the verified member (never a caller-sent id).

export const pagesJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export type PagesViewer = { admin: SupabaseClient; memberId: string; isAdmin: boolean };

/** The signed-in chat member (any tier, not a guest), or the response to send instead. */
export async function requirePagesMember(
  req: NextRequest,
  write: boolean,
): Promise<{ ok: true; viewer: PagesViewer } | { ok: false; response: NextResponse }> {
  const fail = (error: string, status: number) => ({ ok: false as const, response: pagesJson({ error }, status) });
  if (write && !requestOriginAllowed(req)) return fail("origin_not_allowed", 403);
  const auth = await requireChatUser(req);
  if (!auth.ok) return fail(auth.error, auth.status);
  if (!canUseChatPages(auth.access)) return fail("Pages are for chat members.", 403);
  const admin = createChatAdminClient();
  if (!admin) return fail("Pages are unavailable. Please try again.", 503);
  let member: Awaited<ReturnType<typeof findChatMember>>;
  try {
    member = await findChatMember(admin, auth.user.id);
  } catch {
    return fail("Pages are unavailable. Please try again.", 503);
  }
  if (!member) return fail("Choose your chat name first.", 403);
  return { ok: true, viewer: { admin, memberId: member.id, isAdmin: auth.access.admin === true } };
}

export const UNAVAILABLE = "Pages are unavailable. Please try again.";

export type LinkRow = {
  id: string;
  title: string;
  url: string;
  note: string | null;
  pinned?: boolean | null;
  added_by?: string | null;
  member_id?: string;
  created_at: string;
};

/** Rows to the shape the browser gets; names come from the members table in one lookup. */
export async function projectLinks(admin: SupabaseClient, rows: LinkRow[], viewer: PagesViewer, shared: boolean) {
  const names = new Map<string, string>();
  const ids = shared ? [...new Set(rows.map((row) => row.added_by).filter((id): id is string => !!id))] : [];
  if (ids.length) {
    const { data, error } = await admin.from("longboard_chat_members").select("id, display_name").in("id", ids);
    if (error) throw new Error("names_unavailable");
    for (const row of (data ?? []) as Array<{ id: string; display_name: string }>) names.set(row.id, row.display_name);
  }
  const links: ChatPageLink[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    note: row.note ?? null,
    pinned: shared && row.pinned === true,
    addedBy: shared ? (row.added_by ?? null) : null,
    addedByName: shared && row.added_by ? (names.get(row.added_by) ?? "Former member") : null,
    canEdit: shared ? viewer.isAdmin || (!!row.added_by && row.added_by === viewer.memberId) : true,
    createdAt: row.created_at,
  }));
  return sortPageLinks(links);
}

export async function readBody(req: NextRequest) {
  return (await req.json().catch(() => null)) as Record<string, unknown> | null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
