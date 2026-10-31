import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireChatUser } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { findChatMember } from "@/lib/chatMembers";
import { canUseChatPages, sortPageLinks, type ChatPageLink } from "@/lib/chatPages";
import type { ChatReaction } from "@/lib/chatMessageReactions";

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
  /** #339: on My Links, who posted the shared link this copy was saved from. */
  saved_from_member_id?: string | null;
};

export type LikeSummary = Map<string, { likeCount: number; likedByMe: boolean }>;

/**
 * #323: like counts on a shared list page, and which ones the viewer likes, in one grouped read
 * (links with no likes are absent). Null when likes can't be read, so the list still loads.
 */
export async function readLikeSummary(viewer: PagesViewer, pageId: string, linkId?: string): Promise<LikeSummary | null> {
  const { data, error } = await viewer.admin.rpc("chat_page_link_like_summary", {
    p_page: pageId,
    p_member: viewer.memberId,
    p_link: linkId ?? null,
  });
  if (error || !Array.isArray(data)) return null;
  const summary: LikeSummary = new Map();
  for (const row of data as Array<{ link_id: string; like_count: number | string; liked_by_me: boolean }>)
    summary.set(row.link_id, { likeCount: Number(row.like_count) || 0, likedByMe: row.liked_by_me === true });
  return summary;
}

/** #336: a link, if it is on a shared list page (never a suggestion, the private list or an embed). */
export async function sharedLink(viewer: PagesViewer, id: unknown) {
  if (!validId(id)) return null;
  const { data, error } = await viewer.admin.from("chat_page_links").select("id, page_id, title, url, note").eq("id", id).maybeSingle();
  if (error) throw new Error("link_lookup_failed");
  const row = data as { id: string; page_id: string; title: string; url: string; note: string | null } | null;
  if (!row) return null;
  const page = await viewer.admin.from("chat_pages").select("id, kind").eq("id", row.page_id).eq("status", "approved").maybeSingle();
  if (page.error) throw new Error("page_lookup_failed");
  return (page.data as { kind?: string } | null)?.kind === "links" ? row : null;
}

/**
 * #336: which of these links the viewer already has on My Links: they saved a copy (even one they
 * have since edited), or that web address is already there. Null when that can't be read (the
 * migration isn't applied yet), so the list still loads, without Save buttons.
 */
export async function readSavedLinks(viewer: PagesViewer, rows: LinkRow[]): Promise<string[] | null> {
  const { data, error } = await viewer.admin
    .from("chat_private_links")
    .select("url, saved_from_link_id")
    .eq("member_id", viewer.memberId)
    .limit(1000);
  if (error || !Array.isArray(data)) return null;
  const mine = data as Array<{ url: string; saved_from_link_id: string | null }>;
  const copies = new Set(mine.map((row) => row.saved_from_link_id));
  const addresses = new Set(mine.map((row) => row.url));
  return rows.filter((row) => copies.has(row.id) || addresses.has(row.url)).map((row) => row.id);
}

/** #336: one reaction on a link, in the shape chat message reactions use. */
export type LinkReactionSummary = { emoji: ChatReaction; count: number; mine: boolean; names: string[] };

/**
 * #336: reactions on these links, by link (links with none are absent). Null when they can't be
 * read (the migration isn't applied yet), so the list still loads, without reactions.
 */
export async function readLinkReactions(viewer: PagesViewer, ids: string[]): Promise<Record<string, LinkReactionSummary[]> | null> {
  const { data, error } = await viewer.admin.rpc("chat_page_link_reaction_summary", { p_member: viewer.memberId, p_links: ids });
  if (error || !Array.isArray(data)) return null;
  const summary: Record<string, LinkReactionSummary[]> = {};
  for (const row of data as Array<{ link_id: string; emoji: ChatReaction; reaction_count: number | string; mine: boolean; names: string[] | null }>)
    (summary[row.link_id] ??= []).push({ emoji: row.emoji, count: Number(row.reaction_count) || 0, mine: row.mine === true, names: row.names ?? [] });
  return summary;
}

/** Rows to the shape the browser gets; names come from the members table in one lookup. */
export async function projectLinks(
  admin: SupabaseClient,
  rows: LinkRow[],
  viewer: PagesViewer,
  shared: boolean,
  likes?: LikeSummary | null,
) {
  const names = new Map<string, string>();
  // #339: the name under a link is its adder on a shared list, its original poster on My Links.
  const posterOf = (row: LinkRow) => (shared ? row.added_by : row.saved_from_member_id) ?? null;
  const ids = [...new Set(rows.map(posterOf).filter((id): id is string => !!id))];
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
    addedByName: posterOf(row) ? (names.get(posterOf(row)!) ?? "Former member") : null,
    canEdit: shared ? viewer.isAdmin || (!!row.added_by && row.added_by === viewer.memberId) : true,
    createdAt: row.created_at,
    likeCount: (shared && likes?.get(row.id)?.likeCount) || 0,
    likedByMe: (shared && likes?.get(row.id)?.likedByMe) || false,
    addedByMe: shared ? !!row.added_by && row.added_by === viewer.memberId : true,
  }));
  return sortPageLinks(links);
}

export async function readBody(req: NextRequest) {
  return (await req.json().catch(() => null)) as Record<string, unknown> | null;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
