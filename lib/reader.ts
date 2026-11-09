// #385 Reader: the shapes shared by the Reader routes and pages, and how everything sent to them is
// checked. Nothing here touches the database or the browser, so it is safe on both sides.

export const READER_BUCKET = "reader-books";
/** The biggest book file accepted (the bucket enforces the same limit). */
export const READER_MAX_BOOK_BYTES = 50 * 1024 * 1024;
export const READER_MAX_COVER_BYTES = 5 * 1024 * 1024;
/** How long a signed link to a book file lasts. The reader downloads the whole file at once. */
export const READER_BOOK_URL_SECONDS = 5 * 60;
/** Cover links last longer so the shelf can sit open; they're still private, per member. */
export const READER_COVER_URL_SECONDS = 60 * 60;

export type ReaderFormat = "epub" | "pdf";
export const READER_FORMATS: Record<ReaderFormat, { mime: string; ext: string; label: string }> = {
  epub: { mime: "application/epub+zip", ext: "epub", label: "EPUB" },
  pdf: { mime: "application/pdf", ext: "pdf", label: "PDF" },
};
export const READER_COVER_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** One book on the shelf, as the browser sees it. */
export type ReaderShelfBook = {
  id: string;
  title: string;
  author: string;
  format: ReaderFormat;
  coverUrl: string | null;
  /** 0 to 1, from the member's saved place; 0 when they haven't opened it. */
  percent: number;
  /** Admins only: hidden books and books whose upload never finished stay on their shelf. */
  hidden?: boolean;
  ready?: boolean;
};
export type ReaderShelf = { books: ReaderShelfBook[]; canManage: boolean };

/** Where a member is in a book: an EPUB CFI, or a PDF page number, plus how far through (0 to 1). */
export type ReaderProgress = { location: string; percent: number; updatedAt?: string };
export type ReaderOpenBook = {
  book: { id: string; title: string; author: string; format: ReaderFormat };
  /** A short-lived signed link to the file. */
  url: string;
  progress: ReaderProgress | null;
};

export const READER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isReaderFormat = (value: unknown): value is ReaderFormat => value === "epub" || value === "pdf";

const MAX_LOCATION = 600;
/** An EPUB place is a CFI like epubcfi(/6/4!/4/2/1:0); a PDF place is a page number from 1. */
export function parseReaderLocation(format: ReaderFormat, value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > MAX_LOCATION) return null;
  if (format === "pdf") return /^[1-9]\d{0,5}$/.test(value) ? value : null;
  return /^epubcfi\([^<>"'`\\\u0000-\u001f]+\)$/.test(value) ? value : null;
}

/** A progress save from the browser: {bookId, location, percent}, or null when anything is off. */
export function parseProgressInput(value: unknown): { bookId: string; location: string; percent: number } | null {
  if (!value || typeof value !== "object") return null;
  const { bookId, location, percent } = value as Record<string, unknown>;
  if (typeof bookId !== "string" || !READER_UUID.test(bookId)) return null;
  if (typeof location !== "string" || !location || location.length > MAX_LOCATION) return null;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 1) return null;
  return { bookId: bookId.toLowerCase(), location, percent };
}

const cleanText = (value: unknown, max: number, required: boolean): string | null => {
  if (typeof value !== "string") return required ? null : "";
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if ((required && !text) || text.length > max) return null;
  return text;
};
export const parseBookTitle = (value: unknown) => cleanText(value, 200, true);
export const parseBookAuthor = (value: unknown) => cleanText(value, 200, false);

export type NewBookInput = {
  title: string;
  author: string;
  format: ReaderFormat;
  byteSize: number;
  cover: { mime: string; byteSize: number } | null;
};
/** An admin's new book: title, author, format, file size and an optional cover image. */
export function parseNewBook(value: unknown): NewBookInput | { error: string } {
  if (!value || typeof value !== "object") return { error: "invalid_book" };
  const body = value as Record<string, unknown>;
  const title = parseBookTitle(body.title);
  const author = parseBookAuthor(body.author);
  if (!title) return { error: "invalid_title" };
  if (author === null) return { error: "invalid_author" };
  if (!isReaderFormat(body.format)) return { error: "invalid_format" };
  const size = body.byteSize;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1) return { error: "invalid_size" };
  if (size > READER_MAX_BOOK_BYTES) return { error: "too_large" };
  let cover: NewBookInput["cover"] = null;
  if (body.cover != null) {
    const c = body.cover as Record<string, unknown>;
    if (typeof c !== "object" || typeof c.mime !== "string" || !READER_COVER_TYPES[c.mime]) return { error: "invalid_cover" };
    if (typeof c.byteSize !== "number" || !Number.isInteger(c.byteSize) || c.byteSize < 1 || c.byteSize > READER_MAX_COVER_BYTES)
      return { error: "invalid_cover" };
    cover = { mime: c.mime, byteSize: c.byteSize };
  }
  return { title, author, format: body.format, byteSize: size, cover };
}

/** The first bytes a real file of each format starts with: a ZIP (EPUB) or %PDF-. */
export function looksLikeFormat(format: ReaderFormat, head: Uint8Array): boolean {
  if (format === "pdf") return head.length >= 5 && String.fromCharCode(...head.slice(0, 5)) === "%PDF-";
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

export const bookPath = (id: string, format: ReaderFormat) => `books/${id}.${READER_FORMATS[format].ext}`;
export const coverPath = (id: string, mime: string) => `covers/${id}.${READER_COVER_TYPES[mime]}`;

/** "x% · y min left in chapter": reading speed in words per minute. */
export const READING_WPM = 230;
export function minutesLeft(wordsInChapter: number, page: number, pages: number): number | null {
  if (!(wordsInChapter > 0) || !(pages > 0) || page < 1) return null;
  const left = Math.max(0, pages - page + 1) / pages;
  return Math.max(0, Math.round((wordsInChapter * left) / READING_WPM));
}
export function progressLabel(percent: number, minutes: number | null): string {
  const pct = `${Math.round(Math.min(1, Math.max(0, percent)) * 100)}%`;
  if (minutes === null) return pct;
  return `${pct} · ${minutes < 1 ? "less than a minute" : `${minutes} min`} left in chapter`;
}
