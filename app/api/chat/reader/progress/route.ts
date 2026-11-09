import { NextRequest } from "next/server";
import { bookVisible, readerContext, readerJson } from "@/lib/readerServer";
import { parseProgressInput, parseReaderLocation } from "@/lib/reader";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * #385 Saves where a member is in a book, so it opens at the same place on every device:
 * {bookId, location, percent}. One row per member and book; the newest save wins. The reader sends
 * it a moment after each page turn (and, with keepalive, when the tab is hidden), never on every page.
 */
export async function PUT(req: NextRequest) {
  const gate = await readerContext(req, { write: true });
  if (!gate.ok) return gate.response;
  const { db, auth, canManage } = gate.ctx;
  const input = parseProgressInput(await req.json().catch(() => null));
  if (!input) return readerJson({ error: "invalid_progress" }, 400);
  try {
    const { data: book, error } = await db.from("reader_books").select("format,hidden,ready").eq("id", input.bookId).maybeSingle();
    if (error) return readerJson({ error: "reader_unavailable" }, 503);
    if (!book || !bookVisible(book, canManage)) return readerJson({ error: "not_found" }, 404);
    const location = parseReaderLocation(book.format, input.location);
    if (!location) return readerJson({ error: "invalid_progress" }, 400);
    const updatedAt = new Date().toISOString();
    const saved = await db
      .from("reader_progress")
      .upsert({ account_id: auth.user.id, book_id: input.bookId, location, percent: input.percent, updated_at: updatedAt });
    if (saved.error) return readerJson({ error: "reader_unavailable" }, 503);
    return readerJson({ saved: true, updatedAt });
  } catch {
    return readerJson({ error: "reader_unavailable" }, 503);
  }
}
