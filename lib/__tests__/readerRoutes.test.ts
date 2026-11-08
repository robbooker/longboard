import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createReaderFakeDb } from "./readerFakeDb";
const { auth, admin } = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", async (real) => ({ ...(await real<typeof import("@/lib/chatAdmin")>()), createChatAdminClient: admin }));
import { GET as listBooks, POST as createBook } from "@/app/api/chat/reader/books/route";
import { GET as openBook, PATCH as patchBook, DELETE as deleteBook } from "@/app/api/chat/reader/books/[id]/route";
import { PUT as saveProgress } from "@/app/api/chat/reader/progress/route";
import { POST as saveOrder } from "@/app/api/chat/reader/order/route";
import { canManageReader, canUseReader } from "@/lib/readerAccess";

const EPUB = "11111111-1111-4111-8111-111111111111";
const PDF = "22222222-2222-4222-8222-222222222222";
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const book = (id: string, format: "epub" | "pdf", extra: Record<string, unknown> = {}) => ({
  id,
  title: `Book ${id.slice(0, 1)}`,
  author: "Author",
  format,
  storage_path: `books/${id}.${format}`,
  cover_path: format === "epub" ? `covers/${id}.png` : null,
  sort: Number(id.slice(0, 1)),
  hidden: false,
  ready: true,
  created_at: "2026-11-08T00:00:00Z",
  ...extra,
});
const member = { ok: true, user: { id: "acct-member", role: "user" }, access: { longboard: false, shortscout: true, admin: false } };
const lbMember = { ok: true, user: { id: "acct-lb", role: "user" }, access: { longboard: true, shortscout: false, admin: false } };
const adminUser = { ok: true, user: { id: "acct-admin", role: "admin" }, access: { longboard: true, shortscout: false, admin: true } };
const noGainers = { ok: true, user: { id: "acct-x", role: "user" }, access: { longboard: false, shortscout: false, admin: false, botRooms: ["social"] } };
const outsider = { ok: true, user: { id: "acct-y", role: "user" }, access: { longboard: false, shortscout: false, shortscoutMember: false, admin: false } };
const req = (path: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`https://chat.test${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "content-type": "application/json" } } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
let fake: ReturnType<typeof createReaderFakeDb>;

describe("#385 Reader access", () => {
  it("lets in admins and members with Gainers, nobody else", async () => {
    expect(await canUseReader("a", member.access)).toBe(true);
    expect(await canUseReader("a", lbMember.access)).toBe(true);
    expect(await canUseReader("a", adminUser.access)).toBe(true);
    expect(await canUseReader("a", { longboard: false, shortscout: false, admin: true })).toBe(true);
    expect(await canUseReader("a", outsider.access)).toBe(false);
    expect(await canUseReader("a", noGainers.access)).toBe(false);
    expect(await canUseReader("a", { ...noGainers.access, botRooms: ["gainers"] })).toBe(false);
    expect(canManageReader(adminUser.access)).toBe(true);
    expect(canManageReader(member.access)).toBe(false);
  });
});

describe("#385 Reader routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fake = createReaderFakeDb({
      reader_books: [book(PDF, "pdf"), book(EPUB, "epub"), book(HIDDEN, "pdf", { hidden: true })],
      reader_progress: [{ account_id: "acct-member", book_id: EPUB, location: "epubcfi(/6/4!/4/2/1:0)", percent: 0.42, updated_at: "2026-11-08T01:00:00Z" }],
    });
    admin.mockReturnValue(fake.db);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses signed-out people and members without access before touching anything", async () => {
    auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await listBooks(req("/api/chat/reader/books"))).status).toBe(401);
    for (const who of [noGainers, outsider]) {
      auth.mockResolvedValue(who);
      expect((await listBooks(req("/api/chat/reader/books"))).status).toBe(403);
      expect((await openBook(req(`/api/chat/reader/books/${EPUB}`), params(EPUB))).status).toBe(403);
      expect((await saveProgress(req("/api/chat/reader/progress", { method: "PUT", body: { bookId: EPUB, location: "3", percent: 0.1 } }))).status).toBe(403);
    }
    expect(fake.calls).toEqual([]);
  });

  it("shows members the visible books in order with their progress and private cover links", async () => {
    auth.mockResolvedValue(member);
    const body = await (await listBooks(req("/api/chat/reader/books"))).json();
    expect(body.canManage).toBe(false);
    expect(body.books.map((b: { id: string }) => b.id)).toEqual([EPUB, PDF]);
    expect(body.books[0]).toEqual({ id: EPUB, title: "Book 1", author: "Author", format: "epub", coverUrl: fake.signed(`covers/${EPUB}.png`), percent: 0.42 });
    expect(body.books[1].percent).toBe(0);
    expect(body.books[1].coverUrl).toBeNull();
  });

  it("shows admins hidden books too, marked", async () => {
    auth.mockResolvedValue(adminUser);
    const body = await (await listBooks(req("/api/chat/reader/books"))).json();
    expect(body.canManage).toBe(true);
    expect(body.books.map((b: { id: string; hidden: boolean }) => [b.id, b.hidden])).toEqual([[EPUB, false], [PDF, false], [HIDDEN, true]]);
  });

  it("opens a book with a short-lived signed link and the saved place; hidden books are a 404 to members", async () => {
    auth.mockResolvedValue(member);
    const opened = await (await openBook(req(`/api/chat/reader/books/${EPUB}`), params(EPUB))).json();
    expect(opened).toEqual({
      book: { id: EPUB, title: "Book 1", author: "Author", format: "epub" },
      url: fake.signed(`books/${EPUB}.epub`),
      progress: { location: "epubcfi(/6/4!/4/2/1:0)", percent: 0.42, updatedAt: "2026-11-08T01:00:00Z" },
    });
    expect((await (await openBook(req(`/api/chat/reader/books/${PDF}`), params(PDF))).json()).progress).toBeNull();
    expect((await openBook(req(`/api/chat/reader/books/${HIDDEN}`), params(HIDDEN))).status).toBe(404);
    expect((await openBook(req("/api/chat/reader/books/nope"), params("nope"))).status).toBe(404);
  });

  it("saves and restores each member's own place per book; the newest save wins", async () => {
    auth.mockResolvedValue(member);
    const put = (body: unknown) => saveProgress(req("/api/chat/reader/progress", { method: "PUT", body }));
    expect((await put({ bookId: PDF, location: "7", percent: 0.6 })).status).toBe(200);
    expect((await put({ bookId: PDF, location: "9", percent: 0.8 })).status).toBe(200);
    expect(fake.tables.reader_progress.filter((p) => p.book_id === PDF)).toEqual([expect.objectContaining({ account_id: "acct-member", location: "9", percent: 0.8 })]);
    expect((await (await openBook(req(`/api/chat/reader/books/${PDF}`), params(PDF))).json()).progress).toMatchObject({ location: "9", percent: 0.8 });
    // Another member has their own place.
    auth.mockResolvedValue(lbMember);
    expect((await (await openBook(req(`/api/chat/reader/books/${PDF}`), params(PDF))).json()).progress).toBeNull();
    // A place in the wrong format, out-of-range percent, hidden book or unknown book is refused.
    expect((await put({ bookId: PDF, location: "epubcfi(/6/4!)", percent: 0.1 })).status).toBe(400);
    expect((await put({ bookId: EPUB, location: "12", percent: 0.1 })).status).toBe(400);
    expect((await put({ bookId: PDF, location: "3", percent: 2 })).status).toBe(400);
    expect((await put({ bookId: HIDDEN, location: "3", percent: 0.1 })).status).toBe(404);
    expect((await put({ bookId: "44444444-4444-4444-8444-444444444444", location: "3", percent: 0.1 })).status).toBe(404);
  });

  it("refuses progress saves from another site", async () => {
    auth.mockResolvedValue(member);
    const response = await saveProgress(
      new NextRequest("https://chat.test/api/chat/reader/progress", { method: "PUT", body: "{}", headers: { origin: "https://evil.test", host: "chat.test" } }),
    );
    expect(response.status).toBe(403);
  });

  it("lets only admins add, check, reorder, hide and delete books", async () => {
    auth.mockResolvedValue(member);
    expect((await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "X", format: "pdf", byteSize: 10 } }))).status).toBe(403);
    expect((await patchBook(req(`/api/chat/reader/books/${PDF}`, { method: "PATCH", body: { hidden: true } }), params(PDF))).status).toBe(403);
    expect((await deleteBook(req(`/api/chat/reader/books/${PDF}`, { method: "DELETE" }), params(PDF))).status).toBe(403);
    expect((await saveOrder(req("/api/chat/reader/order", { method: "POST", body: { ids: [PDF, EPUB] } }))).status).toBe(403);

    auth.mockResolvedValue(adminUser);
    expect((await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "Big", format: "pdf", byteSize: 60 * 1024 * 1024 } }))).status).toBe(413);
    const created = await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "Bible", author: "Rob", format: "pdf", byteSize: 10, cover: { mime: "image/jpeg", byteSize: 5 } } }));
    expect(created.status).toBe(201);
    const { id, bookUploadUrl, coverUploadUrl } = await created.json();
    expect(bookUploadUrl).toContain(`books/${id}.pdf`);
    expect(coverUploadUrl).toContain(`covers/${id}.jpg`);
    const row = fake.tables.reader_books.find((b) => b.id === id)!;
    expect(row).toMatchObject({ ready: false, sort: 4, created_by: "acct-admin" });
    // Not on members' shelves until the file has been checked.
    auth.mockResolvedValue(member);
    expect((await (await listBooks(req("/api/chat/reader/books"))).json()).books.map((b: { id: string }) => b.id)).not.toContain(id);
    auth.mockResolvedValue(adminUser);
    // The file arrives (the cover didn't): the first bytes are checked and the missing cover dropped.
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes(`books/${id}`) ? new Response("%PDF-1.7") : new Response("", { status: 404 })));
    expect((await patchBook(req(`/api/chat/reader/books/${id}`, { method: "PATCH", body: { ready: true } }), params(id))).status).toBe(200);
    expect(fake.tables.reader_books.find((b) => b.id === id)).toMatchObject({ ready: true, cover_path: null });
    // A "PDF" that is really something else is removed.
    const fakePdf = await (await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "Fake", format: "pdf", byteSize: 10 } }))).json();
    vi.stubGlobal("fetch", async () => new Response("<html>"));
    expect((await patchBook(req(`/api/chat/reader/books/${fakePdf.id}`, { method: "PATCH", body: { ready: true } }), params(fakePdf.id))).status).toBe(422);
    expect(fake.tables.reader_books.some((b) => b.id === fakePdf.id)).toBe(false);
    // Reorder, hide, delete.
    expect((await saveOrder(req("/api/chat/reader/order", { method: "POST", body: { ids: [id, PDF, EPUB] } }))).status).toBe(200);
    expect(fake.tables.reader_books.find((b) => b.id === id)!.sort).toBe(1);
    expect((await patchBook(req(`/api/chat/reader/books/${PDF}`, { method: "PATCH", body: { hidden: true, title: "  New  title " } }), params(PDF))).status).toBe(200);
    expect(fake.tables.reader_books.find((b) => b.id === PDF)).toMatchObject({ hidden: true, title: "New title" });
    expect((await patchBook(req(`/api/chat/reader/books/${PDF}`, { method: "PATCH", body: { hidden: "yes" } }), params(PDF))).status).toBe(400);
    expect((await deleteBook(req(`/api/chat/reader/books/${EPUB}`, { method: "DELETE" }), params(EPUB))).status).toBe(200);
    expect(fake.tables.reader_books.some((b) => b.id === EPUB)).toBe(false);
    expect(fake.tables.reader_progress.some((p) => p.book_id === EPUB)).toBe(false);
  });
});
