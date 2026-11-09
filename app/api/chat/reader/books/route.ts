import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { BOOK_COLUMNS, bookVisible, readerContext, readerJson, type BookRow } from "@/lib/readerServer";
import {
  READER_BUCKET,
  READER_COVER_URL_SECONDS,
  bookPath,
  coverPath,
  parseNewBook,
  type ReaderShelf,
  type ReaderShelfBook,
} from "@/lib/reader";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * #385 Reader shelf. GET: the books this member may open, in Rob's order, each with a private cover
 * link and how far through it they are. Admins also see hidden books and unfinished uploads, marked.
 * POST (admins): starts a new book. Saves its title, author and format (not yet on anyone's shelf)
 * and answers with signed upload links for the file and its cover; the browser uploads straight to
 * the private bucket (the bucket itself refuses anything over 50 MB or of another type), then
 * PATCHes {ready: true} on /api/chat/reader/books/<id>, which checks the file before it appears.
 */
export async function GET(req: NextRequest) {
  const gate = await readerContext(req);
  if (!gate.ok) return gate.response;
  const { db, auth, canManage } = gate.ctx;
  try {
    const books = await db.from("reader_books").select(BOOK_COLUMNS).order("sort").order("created_at");
    if (books.error) return readerJson({ error: "reader_unavailable" }, 503);
    const rows = ((books.data ?? []) as BookRow[]).filter((book) => canManage || bookVisible(book, false));
    const progress = rows.length
      ? await db
          .from("reader_progress")
          .select("book_id,percent")
          .eq("account_id", auth.user.id)
          .in(
            "book_id",
            rows.map((book) => book.id),
          )
      : { data: [], error: null };
    if (progress.error) return readerJson({ error: "reader_unavailable" }, 503);
    const percents = new Map(((progress.data ?? []) as { book_id: string; percent: number }[]).map((p) => [p.book_id, p.percent]));
    const covers = rows.filter((book) => book.cover_path).map((book) => book.cover_path!);
    const coverUrls = new Map<string, string>();
    if (covers.length) {
      const signed = await db.storage.from(READER_BUCKET).createSignedUrls(covers, READER_COVER_URL_SECONDS);
      for (const item of signed.data ?? []) if (item.path && item.signedUrl && !item.error) coverUrls.set(item.path, item.signedUrl);
    }
    const body: ReaderShelf = {
      canManage,
      books: rows.map((book): ReaderShelfBook => ({
        id: book.id,
        title: book.title,
        author: book.author,
        format: book.format,
        coverUrl: book.cover_path ? (coverUrls.get(book.cover_path) ?? null) : null,
        percent: Math.min(1, Math.max(0, Number(percents.get(book.id) ?? 0))),
        ...(canManage ? { hidden: book.hidden, ready: book.ready } : {}),
      })),
    };
    return readerJson(body);
  } catch {
    return readerJson({ error: "reader_unavailable" }, 503);
  }
}

export async function POST(req: NextRequest) {
  const gate = await readerContext(req, { write: true, manage: true });
  if (!gate.ok) return gate.response;
  const { db, auth } = gate.ctx;
  const input = parseNewBook(await req.json().catch(() => null));
  if ("error" in input) return readerJson({ error: input.error }, input.error === "too_large" ? 413 : 400);
  try {
    const id = randomUUID();
    const path = bookPath(id, input.format);
    const cover = input.cover ? coverPath(id, input.cover.mime) : null;
    // New books go at the end of the shelf.
    const last = await db.from("reader_books").select("sort").order("sort", { ascending: false }).limit(1);
    if (last.error) return readerJson({ error: "reader_unavailable" }, 503);
    const sort = ((last.data?.[0] as { sort?: number } | undefined)?.sort ?? 0) + 1;
    const inserted = await db.from("reader_books").insert({
      id,
      title: input.title,
      author: input.author,
      format: input.format,
      storage_path: path,
      cover_path: cover,
      byte_size: input.byteSize,
      sort,
      hidden: false,
      ready: false,
      created_by: auth.user.id,
    });
    if (inserted.error) return readerJson({ error: "reader_unavailable" }, 503);
    const bucket = db.storage.from(READER_BUCKET);
    const bookUpload = await bucket.createSignedUploadUrl(path, { upsert: false });
    const coverUpload = cover ? await bucket.createSignedUploadUrl(cover, { upsert: true }) : null;
    if (bookUpload.error || coverUpload?.error) {
      await db.from("reader_books").delete().eq("id", id);
      return readerJson({ error: "reader_unavailable" }, 503);
    }
    return readerJson({ id, bookUploadUrl: bookUpload.data.signedUrl, coverUploadUrl: coverUpload?.data?.signedUrl ?? null }, 201);
  } catch {
    return readerJson({ error: "reader_unavailable" }, 503);
  }
}
