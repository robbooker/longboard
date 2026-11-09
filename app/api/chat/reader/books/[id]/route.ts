import { NextRequest } from "next/server";
import { BOOK_COLUMNS, bookVisible, isEpubBook, readerContext, readerJson, type BookRow, type ReaderContext } from "@/lib/readerServer";
import {
  READER_BOOK_URL_SECONDS,
  READER_BUCKET,
  READER_UUID,
  looksLikeFormat,
  parseBookAuthor,
  parseBookTitle,
  parseReaderLocation,
  type ReaderOpenBook,
} from "@/lib/reader";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

async function findBook(db: ReaderContext["db"], id: string) {
  const { data, error } = await db.from("reader_books").select(BOOK_COLUMNS).eq("id", id).maybeSingle();
  return { book: (data ?? null) as BookRow | null, error };
}

/**
 * #385 GET: open a book. A short-lived signed link to the file (the reader downloads it once) and the
 * member's saved place. Hidden books and unfinished uploads are a 404 to members; anything that isn't
 * an EPUB (#406) is a 404 to everyone.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!READER_UUID.test(id)) return readerJson({ error: "not_found" }, 404);
  const gate = await readerContext(req);
  if (!gate.ok) return gate.response;
  const { db, auth, canManage } = gate.ctx;
  try {
    const { book, error } = await findBook(db, id);
    if (error) return readerJson({ error: "reader_unavailable" }, 503);
    if (!book || !bookVisible(book, canManage)) return readerJson({ error: "not_found" }, 404);
    const [signed, saved] = await Promise.all([
      db.storage.from(READER_BUCKET).createSignedUrl(book.storage_path, READER_BOOK_URL_SECONDS),
      db.from("reader_progress").select("location,percent,updated_at").eq("account_id", auth.user.id).eq("book_id", id).maybeSingle(),
    ]);
    if (signed.error || !signed.data?.signedUrl || saved.error) return readerJson({ error: "reader_unavailable" }, 503);
    const location = saved.data ? parseReaderLocation(book.format, saved.data.location) : null;
    const body: ReaderOpenBook = {
      book: { id: book.id, title: book.title, author: book.author, format: "epub" },
      url: signed.data.signedUrl,
      progress: location ? { location, percent: Number(saved.data!.percent) || 0, updatedAt: saved.data!.updated_at } : null,
    };
    return readerJson(body);
  } catch {
    return readerJson({ error: "reader_unavailable" }, 503);
  }
}

/**
 * Admins: {title?, author?, hidden?, ready: true?}. `ready` is sent once the browser finished
 * uploading: the file must be there and start like a real EPUB (a ZIP), or the book stays off
 * the shelf. A cover that never arrived is dropped rather than shown broken.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!READER_UUID.test(id)) return readerJson({ error: "not_found" }, 404);
  const gate = await readerContext(req, { write: true, manage: true });
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return readerJson({ error: "invalid_book" }, 400);
  const update: Record<string, unknown> = {};
  if ("title" in body) {
    const title = parseBookTitle(body.title);
    if (!title) return readerJson({ error: "invalid_title" }, 400);
    update.title = title;
  }
  if ("author" in body) {
    const author = parseBookAuthor(body.author);
    if (author === null) return readerJson({ error: "invalid_author" }, 400);
    update.author = author;
  }
  if ("hidden" in body) {
    if (typeof body.hidden !== "boolean") return readerJson({ error: "invalid_book" }, 400);
    update.hidden = body.hidden;
  }
  if ("ready" in body && body.ready !== true) return readerJson({ error: "invalid_book" }, 400);
  try {
    const { book, error } = await findBook(db, id);
    if (error) return readerJson({ error: "reader_unavailable" }, 503);
    if (!book) return readerJson({ error: "not_found" }, 404);
    if (body.ready === true && !book.ready) {
      const bucket = db.storage.from(READER_BUCKET);
      const head = await firstBytes(bucket, book.storage_path);
      if (!head) return readerJson({ error: "file_missing" }, 409);
      if (!isEpubBook(book) || !looksLikeFormat("epub", head)) {
        await bucket.remove([book.storage_path, ...(book.cover_path ? [book.cover_path] : [])]);
        await db.from("reader_books").delete().eq("id", id);
        return readerJson({ error: "not_this_format" }, 422);
      }
      if (book.cover_path && !(await firstBytes(bucket, book.cover_path))) update.cover_path = null;
      update.ready = true;
    }
    if (!Object.keys(update).length) return readerJson({ ok: true });
    const saved = await db.from("reader_books").update(update).eq("id", id);
    if (saved.error) return readerJson({ error: "reader_unavailable" }, 503);
    return readerJson({ ok: true });
  } catch {
    return readerJson({ error: "reader_unavailable" }, 503);
  }
}

/** Admins: deletes the book, its cover and everyone's place in it. */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!READER_UUID.test(id)) return readerJson({ error: "not_found" }, 404);
  const gate = await readerContext(req, { write: true, manage: true });
  if (!gate.ok) return gate.response;
  const { db } = gate.ctx;
  try {
    const { book, error } = await findBook(db, id);
    if (error) return readerJson({ error: "reader_unavailable" }, 503);
    if (!book) return readerJson({ error: "not_found" }, 404);
    const removed = await db.storage.from(READER_BUCKET).remove([book.storage_path, ...(book.cover_path ? [book.cover_path] : [])]);
    if (removed.error) return readerJson({ error: "reader_unavailable" }, 503);
    const deleted = await db.from("reader_books").delete().eq("id", id);
    if (deleted.error) return readerJson({ error: "reader_unavailable" }, 503);
    return readerJson({ ok: true });
  } catch {
    return readerJson({ error: "reader_unavailable" }, 503);
  }
}

/** The first bytes of a stored file through a one-minute signed link, or null when it isn't there. */
async function firstBytes(
  bucket: { createSignedUrl: (path: string, seconds: number) => Promise<{ data: { signedUrl: string } | null; error: unknown }> },
  path: string,
): Promise<Uint8Array | null> {
  const signed = await bucket.createSignedUrl(path, 60);
  if (signed.error || !signed.data?.signedUrl) return null;
  const response = await fetch(signed.data.signedUrl, { headers: { Range: "bytes=0-7" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer()).slice(0, 8);
}
