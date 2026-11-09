import { NextResponse, type NextRequest } from "next/server";
import { requireChatUser, type ChatAuthResult } from "@/lib/chatAuth";
import { createChatAdminClient, requestOriginAllowed } from "@/lib/chatAdmin";
import { canManageReader, canUseReader } from "@/lib/readerAccess";
import type { ReaderFormat } from "@/lib/reader";

// #385 Reader: the sign-in and access check every Reader route starts with. The account always comes
// from the verified sign-in, never from the request. All reads and writes go through the service
// role; the tables have RLS on with no policies and the bucket is private.

export const readerJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

type Db = NonNullable<ReturnType<typeof createChatAdminClient>>;
export type ReaderContext = { auth: Extract<ChatAuthResult, { ok: true }>; db: Db; canManage: boolean };
export type BookRow = {
  id: string;
  title: string;
  author: string;
  format: ReaderFormat;
  storage_path: string;
  cover_path: string | null;
  sort: number;
  hidden: boolean;
  ready: boolean;
  created_at: string;
};
export const BOOK_COLUMNS = "id,title,author,format,storage_path,cover_path,sort,hidden,ready,created_at";

/** Signed in, allowed into the Reader (and an admin, when `manage`), with the database reachable. */
export async function readerContext(
  req: NextRequest,
  options: { write?: boolean; manage?: boolean } = {},
): Promise<{ ok: true; ctx: ReaderContext } | { ok: false; response: NextResponse }> {
  if (options.write && !requestOriginAllowed(req)) return { ok: false, response: readerJson({ error: "origin_not_allowed" }, 403) };
  const auth = await requireChatUser(req);
  if (!auth.ok) return { ok: false, response: readerJson({ error: auth.error }, auth.status) };
  if (!(await canUseReader(auth.user.id, auth.access)))
    return { ok: false, response: readerJson({ error: "reader_access_required" }, 403) };
  const canManage = canManageReader(auth.access);
  if (options.manage && !canManage) return { ok: false, response: readerJson({ error: "admin_required" }, 403) };
  const db = createChatAdminClient();
  if (!db) return { ok: false, response: readerJson({ error: "reader_unavailable" }, 503) };
  return { ok: true, ctx: { auth, db, canManage } };
}

/** A book a member may open: finished uploading and not hidden. Admins can also open hidden ones. */
export function bookVisible(book: Pick<BookRow, "hidden" | "ready">, canManage: boolean) {
  return book.ready && (canManage || !book.hidden);
}
