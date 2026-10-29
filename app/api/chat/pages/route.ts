import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { pageSlug, parsePageInput, type ChatPage, type ChatPageKind } from "@/lib/chatPages";
import { pagesJson, readBody, requirePagesMember, UNAVAILABLE, validId } from "@/lib/chatPagesServer";
export const dynamic = "force-dynamic";

// LB-PAGES (#321): the sidebar's pages. Any chat member reads them; admins add and remove them.

type PageRow = { id: string; slug: string; name: string; kind: ChatPageKind; embed_url: string | null; built_in: boolean };
const project = (row: PageRow): ChatPage => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  kind: row.kind,
  embedUrl: row.kind === "embed" ? row.embed_url : null,
  builtIn: row.built_in === true,
});

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
  const { admin, isAdmin } = gate.viewer;
  try {
    const { data, error } = await admin
      .from("chat_pages")
      .select("id, slug, name, kind, embed_url, built_in")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ pages: ((data ?? []) as PageRow[]).map(project), canManage: isAdmin });
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function POST(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin, memberId } = gate.viewer;
  if (!isAdmin) return pagesJson({ error: "Only admins can add pages." }, 403);
  const parsed = parsePageInput(await readBody(req), ownHosts(req));
  if (!parsed.ok) return pagesJson({ error: parsed.error }, 400);
  try {
    const { data, error } = await admin
      .from("chat_pages")
      .insert({
        slug: pageSlug(parsed.value.name, randomBytes(3).toString("hex")),
        name: parsed.value.name,
        kind: parsed.value.kind,
        embed_url: parsed.value.embedUrl,
        created_by: memberId,
      })
      .select("id, slug, name, kind, embed_url, built_in")
      .single();
    if (error || !data) return pagesJson({ error: UNAVAILABLE }, 503);
    return pagesJson({ page: project(data as PageRow) }, 201);
  } catch {
    return pagesJson({ error: UNAVAILABLE }, 503);
  }
}

export async function DELETE(req: NextRequest) {
  const gate = await requirePagesMember(req, true);
  if (!gate.ok) return gate.response;
  const { admin, isAdmin } = gate.viewer;
  if (!isAdmin) return pagesJson({ error: "Only admins can remove pages." }, 403);
  const id = req.nextUrl.searchParams.get("id");
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
