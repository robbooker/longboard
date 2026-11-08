import { NextRequest } from "next/server";
import { readerContext, readerJson } from "@/lib/readerServer";
import { READER_UUID } from "@/lib/reader";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** #385 Admins: {ids: [...]} puts the shelf in this order (first id first). Unknown ids are ignored. */
export async function POST(req: NextRequest) {
  const gate = await readerContext(req, { write: true, manage: true });
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string" || !READER_UUID.test(id)))
    return readerJson({ error: "invalid_order" }, 400);
  try {
    const results = await Promise.all(ids.map((id, index) => gate.ctx.db.from("reader_books").update({ sort: index + 1 }).eq("id", id)));
    if (results.some((result) => result.error)) return readerJson({ error: "reader_unavailable" }, 503);
    return readerJson({ ok: true });
  } catch {
    return readerJson({ error: "reader_unavailable" }, 503);
  }
}
