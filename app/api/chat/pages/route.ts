import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  MAX_PENDING_PAGE_SUGGESTIONS,
  pageSlug,
  parsePageInput,
  type ChatPage,
  type ChatPageKind,
  type ChatPageSuggestion,
} from "@/lib/chatPages";
import { pagesJson, readBody, requirePagesMember, UNAVAILABLE, validId, type PagesViewer } from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// LB-PAGES (#321): the sidebar's pages. Any chat member reads them; admins add and remove them.
// #329: a member's new page is a suggestion, seen only by them and by admins until an admin
// approves it (PATCH). A declined one stays, marked, until the member dismisses it (DELETE ?dismiss=1).

type PageRow = { id: string; slug: string; name: string; kind: ChatPageKind; embed_url: string | null; built_in: boolean };
const project = (row: PageRow): ChatPage => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  kind: row.kind,
  embedUrl: row.kind === "embed" ? row.embed_url : null,
  builtIn: row.built_in === true,
});

const SUGGESTION_COLUMNS = "id, name, kind, embed_url, status, suggested_by, created_at";
type SuggestionRow = {
  id: string;
  name: string;
  kind: "embed" | "links";
  embed_url: string | null;
  status: ChatPageSuggestion["status"];
  suggested_by: string | null;
  created_at: string;
};
const projectSuggestion = (row: SuggestionRow, suggestedByName: string | null = null): ChatPageSuggestion => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  embedUrl: row.kind === "embed" ? row.embed_url : null,
  status: row.status,
  suggestedByName,
  createdAt: row.created_at,
});

/** The admins' waiting list, oldest first, with each suggester's chat name. */
async function readWaiting(admin: PagesViewer["admin"]) {
  const { data, error } = await admin
    .from("chat_pages")
    .select(SUGGESTION_COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error("waiting_unavailable");
  const rows = (data ?? []) as SuggestionRow[];
  const ids = [...new Set(rows.map((row) => row.suggested_by).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const found = await admin.from("longboard_chat_members").select("id, display_name").in("id", ids);
    if (found.error) throw new Error("names_unavailable");
    for (const row of (found.data ?? []) as Array<{ id: string; display_name: string }>) names.set(row.id, row.display_name);
  }
  return rows.map((row) => projectSuggestion(row, row.suggested_by ? (names.get(row.suggested_by) ?? "Former member") : "Former member"));
}

/** This site's own host names: an embedded page may not frame the chat itself. */
function ownHosts(req: NextRequest) {
  const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host"), req.nextUrl.host];
  try {
    if (process.env.NEXT_PUBLIC_SITE_URL) hosts.push(new URL(process.env.NEXT_PUBLIC_SITE_URL).host);
  } catch {}
  return hosts.filter((host): host is string => !!host);
}

export async function GET(req: NextRequest) {
  const gate = await requirePagesMember(req, false);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin, memberId } = gate.viewer;
  try {
    const [approved, mine, waiting] = await Promise.all([
      admin
        .from("chat_pages")
        .select("id, slug, name, kind, embed_url, built_in")
        .eq("status", "approved")
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
      // #329: only the viewer's own; never anyone else's, admins included (they have the waiting list).
      admin
        .from("chat_pages")
        .select(SUGGESTION_COLUMNS)
        .eq("suggested_by", memberId)
        .in("status", ["pending", "declined"])
        .order("created_at", { ascending: true }),
      isAdmin ? readWaiting(admin) : [],
    ]);
    if (approved.error || mine.error) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({
      pages: ((approved.data ?? []) as PageRow[]).map(project),
      canManage: isAdmin,
      suggestions: ((mine.data ?? []) as SuggestionRow[]).map((row) => projectSuggestion(row)),
      waiting,
    });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin, memberId } = gate.viewer;
  const parsed = parsePageInput(await readBody(req), ownHosts(req));
  if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
  try {
    // #329: an admin's page is live at once; a member's waits for an admin. Decided here from the
    // verified viewer, never from anything the caller sent.
    const fields = {
      slug: pageSlug(parsed.value.name, randomBytes(3).toString("hex")),
      name: parsed.value.name,
      kind: parsed.value.kind,
      embed_url: parsed.value.embedUrl,
      created_by: memberId,
    };
    if (!isAdmin) {
      const { data, error } = await admin
        .from("chat_pages")
        .insert({ ...fields, status: "pending", suggested_by: memberId })
        .select(SUGGESTION_COLUMNS)
        .single();
      if (error?.message?.includes("chat_page_suggestion_limit"))
        return pagesJson({ error: `You already have ${MAX_PENDING_PAGE_SUGGESTIONS} pages waiting for approval. Please wait for an admin to look at them.` }, 409);
      if (error || !data) return pagesJson({ error: UNAVAILABLE }, 503);
      return pagesJson({ suggestion: projectSuggestion(data as SuggestionRow) }, 201);
    }
    const { data, error } = await admin.from("chat_pages").insert(fields).select("id, slug, name, kind, embed_url, built_in").single();
    if (error || !data) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ page: project(data as PageRow) }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

/** #329: an admin approves or declines a suggestion that is still waiting. */
export async function PATCH(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin, memberId } = gate.viewer;
  if (!isAdmin) return pagesJson({ error: "Only admins can approve or decline pages." }, 403);
  const body = await readBody(req);
  const decision = body?.decision === "approve" ? "approved" : body?.decision === "decline" ? "declined" : null;
  if (!decision) return pagesJson({ error: "Choose approve or decline." }, 400);
  if (!validId(body?.id)) return pagesJson({ error: "That page can't be found." }, 400);
  try {
    // Only a page still pending changes, so a page can't be decided twice or an approved page pulled.
    const { data, error } = await admin
      .from("chat_pages")
      .update({ status: decision, decided_by: memberId, decided_at: new Date().toISOString() })
      .eq("id", body!.id)
      .eq("status", "pending")
      .select("id");
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    if (!data?.length) return pagesJson({ error: "That suggestion has already been decided." }, 409);
    return pagesJson({ ok: true, status: decision });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin, memberId } = gate.viewer;
  const id = req.nextUrl.searchParams.get("id");
  // #329: a member clears their own declined suggestion from their sidebar, and nothing else.
  if (req.nextUrl.searchParams.get("dismiss") === "1") {
    if (!validId(id)) return pagesJson({ error: "That page can't be found." }, 400);
    try {
      const { data, error } = await admin
        .from("chat_pages")
        .delete()
        .eq("id", id)
        .eq("suggested_by", memberId)
        .eq("status", "declined")
        .select("id");
      if (error) return pagesJson({ error: UNAVAILABLE }, 503);
      if (!data?.length) return pagesJson({ error: "That page can't be found." }, 404);
      return pagesJson({ ok: true });
    } catch {
      return pagesJson({ error: UNAVAILABLE }, 503);
    }
  }
  if (!isAdmin) return pagesJson({ error: "Only admins can remove pages." }, 403);
  if (!validId(id)) return pagesJson({ error: "That page can't be found." }, 400);
  try {
    // The three starting pages stay; added pages (and their links) can be removed.
    const { data, error } = await admin
      .from("chat_pages")
      .delete()
      .eq("id", id)
      .eq("built_in", false)
      .select("id");
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    if (!data?.length) return pagesJson({ error: "That page can't be removed." }, 404);
    return pagesJson({ ok: true });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}
