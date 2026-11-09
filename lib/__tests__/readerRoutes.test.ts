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
import { chatAppsFor } from "@/lib/chatApps.server";

const EPUB = "11111111-1111-4111-8111-111111111111";
// #406: a PDF row from before EPUB-only (the database no longer allows one); it must never show.
const PDF = "22222222-2222-4222-8222-222222222222";
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const SECOND = "44444444-4444-4444-8444-444444444444";
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
const bot = { ok: true, user: { id: "acct-x", role: "user" }, access: { longboard: false, shortscout: false, admin: false, botRooms: ["social"] } };
const outsider = { ok: true, user: { id: "acct-y", role: "user" }, access: { longboard: false, shortscout: false, shortscoutMember: false, admin: false } };
const req = (path: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`https://chat.test${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { "content-type": "application/json" } } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
let fake: ReturnType<typeof createReaderFakeDb>;

describe("#385/#406 Reader access", () => {
  it("#406: lets in every signed-in member, never bot accounts; only admins manage books", async () => {
    expect(await canUseReader("a", { longboard: false, shortscout: false, admin: false, member: ["reader"] })).toBe(true);
    expect(await canUseReader("a", { longboard: false, shortscout: false, admin: false, member: ["club-room"] })).toBe(true);
    expect(await canUseReader("a", member.access)).toBe(true);
    expect(await canUseReader("a", lbMember.access)).toBe(true);
    expect(await canUseReader("a", adminUser.access)).toBe(true);
    expect(await canUseReader("a", outsider.access)).toBe(true);
    expect(await canUseReader("a", bot.access)).toBe(false);
    expect(await canUseReader("a", { ...bot.access, member: ["reader"] })).toBe(false);
    expect(await canUseReader("a", { ...bot.access, admin: true })).toBe(false);
    expect(canManageReader(adminUser.access)).toBe(true);
    expect(canManageReader(member.access)).toBe(false);
    expect(canManageReader({ ...bot.access, admin: true })).toBe(false);
  });

  it("#406: shows the Apps section (with the Reader) to every member, including one with only the reader entitlement, never to bots", async () => {
    expect(await chatAppsFor("a", adminUser.access)).toEqual(["reader"]);
    expect(await chatAppsFor("a", member.access)).toEqual(["reader"]);
    expect(await chatAppsFor("a", { longboard: false, shortscout: false, admin: false, member: ["reader"] })).toEqual(["reader"]);
    expect(await chatAppsFor("a", { longboard: false, shortscout: false, admin: false, member: ["club-room"] })).toEqual(["reader"]);
    expect(await chatAppsFor("a", outsider.access)).toEqual(["reader"]);
    expect(await chatAppsFor("a", bot.access)).toEqual([]);
  });
});

describe("#385 Reader routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    fake = createReaderFakeDb({
      reader_books: [book(PDF, "pdf"), book(EPUB, "epub"), book(HIDDEN, "epub", { hidden: true }), book(SECOND, "epub")],
      reader_progress: [{ account_id: "acct-member", book_id: EPUB, location: "epubcfi(/6/4!/4/2/1:0)", percent: 0.42, updated_at: "2026-11-08T01:00:00Z" }],
    });
    admin.mockReturnValue(fake.db);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("refuses signed-out people and bot accounts before touching anything", async () => {
    auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await listBooks(req("/api/chat/reader/books"))).status).toBe(401);
    for (const who of [bot]) {
      auth.mockResolvedValue(who);
      expect((await listBooks(req("/api/chat/reader/books"))).status).toBe(403);
      expect((await openBook(req(`/api/chat/reader/books/${EPUB}`), params(EPUB))).status).toBe(403);
      expect((await saveProgress(req("/api/chat/reader/progress", { method: "PUT", body: { bookId: EPUB, location: "3", percent: 0.1 } }))).status).toBe(403);
    }
    expect(fake.calls).toEqual([]);
  });

  it("#384/#406: opens the shelf for a member with only the reader entitlement, and for any other member", async () => {
    for (const access of [{ longboard: false, shortscout: false, admin: false, member: ["reader"] }, outsider.access]) {
      auth.mockResolvedValue({ ok: true, user: { id: "acct-club", role: "user" }, access });
      const body = await (await listBooks(req("/api/chat/reader/books"))).json();
      expect(body.books.map((b: { id: string }) => b.id)).toEqual([EPUB, SECOND]);
    }
  });

  it("shows members the visible EPUBs in order with their progress and private cover links, never a PDF", async () => {
    auth.mockResolvedValue(member);
    const body = await (await listBooks(req("/api/chat/reader/books"))).json();
    expect(body.canManage).toBe(false);
    expect(body.books.map((b: { id: string }) => b.id)).toEqual([EPUB, SECOND]);
    expect(body.books[0]).toEqual({ id: EPUB, title: "Book 1", author: "Author", format: "epub", coverUrl: fake.signed(`covers/${EPUB}.png`), percent: 0.42 });
    expect(body.books[1].percent).toBe(0);
  });

  it("shows admins hidden books too, marked, but no PDF", async () => {
    auth.mockResolvedValue(adminUser);
    const body = await (await listBooks(req("/api/chat/reader/books"))).json();
    expect(body.canManage).toBe(true);
    expect(body.books.map((b: { id: string; hidden: boolean }) => [b.id, b.hidden])).toEqual([[EPUB, false], [HIDDEN, true], [SECOND, false]]);
  });

  it("opens a book with a short-lived signed link and the saved place; hidden books are a 404 to members", async () => {
    auth.mockResolvedValue(member);
    const opened = await (await openBook(req(`/api/chat/reader/books/${EPUB}`), params(EPUB))).json();
    expect(opened).toEqual({
      book: { id: EPUB, title: "Book 1", author: "Author", format: "epub" },
      url: fake.signed(`books/${EPUB}.epub`),
      progress: { location: "epubcfi(/6/4!/4/2/1:0)", percent: 0.42, updatedAt: "2026-11-08T01:00:00Z" },
    });
    expect((await (await openBook(req(`/api/chat/reader/books/${SECOND}`), params(SECOND))).json()).progress).toBeNull();
    expect((await openBook(req(`/api/chat/reader/books/${HIDDEN}`), params(HIDDEN))).status).toBe(404);
    // #406: a PDF never opens, for members or admins.
    expect((await openBook(req(`/api/chat/reader/books/${PDF}`), params(PDF))).status).toBe(404);
    auth.mockResolvedValue(adminUser);
    expect((await openBook(req(`/api/chat/reader/books/${PDF}`), params(PDF))).status).toBe(404);
    expect((await openBook(req(`/api/chat/reader/books/${HIDDEN}`), params(HIDDEN))).status).toBe(200);
    expect((await openBook(req("/api/chat/reader/books/nope"), params("nope"))).status).toBe(404);
  });

  it("saves and restores each member's own place per book; the newest save wins", async () => {
    auth.mockResolvedValue(member);
    const put = (body: unknown) => saveProgress(req("/api/chat/reader/progress", { method: "PUT", body }));
    expect((await put({ bookId: SECOND, location: "epubcfi(/6/4!/4/2/1:0)", percent: 0.6 })).status).toBe(200);
    expect((await put({ bookId: SECOND, location: "epubcfi(/6/8!/4/2/1:0)", percent: 0.8 })).status).toBe(200);
    expect(fake.tables.reader_progress.filter((p) => p.book_id === SECOND)).toEqual([expect.objectContaining({ account_id: "acct-member", location: "epubcfi(/6/8!/4/2/1:0)", percent: 0.8 })]);
    expect((await (await openBook(req(`/api/chat/reader/books/${SECOND}`), params(SECOND))).json()).progress).toMatchObject({ location: "epubcfi(/6/8!/4/2/1:0)", percent: 0.8 });
    // Another member has their own place.
    auth.mockResolvedValue(lbMember);
    expect((await (await openBook(req(`/api/chat/reader/books/${SECOND}`), params(SECOND))).json()).progress).toBeNull();
    // A page number (the old PDF place), out-of-range percent, hidden book, PDF row or unknown book is refused.
    expect((await put({ bookId: EPUB, location: "12", percent: 0.1 })).status).toBe(400);
    expect((await put({ bookId: EPUB, location: "epubcfi(/6/4!)", percent: 2 })).status).toBe(400);
    expect((await put({ bookId: HIDDEN, location: "epubcfi(/6/4!)", percent: 0.1 })).status).toBe(404);
    expect((await put({ bookId: PDF, location: "3", percent: 0.1 })).status).toBe(404);
    expect((await put({ bookId: "55555555-5555-4555-8555-555555555555", location: "epubcfi(/6/4!)", percent: 0.1 })).status).toBe(404);
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
    expect((await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "X", format: "epub", byteSize: 10 } }))).status).toBe(403);
    expect((await patchBook(req(`/api/chat/reader/books/${SECOND}`, { method: "PATCH", body: { hidden: true } }), params(SECOND))).status).toBe(403);
    expect((await deleteBook(req(`/api/chat/reader/books/${SECOND}`, { method: "DELETE" }), params(SECOND))).status).toBe(403);
    expect((await saveOrder(req("/api/chat/reader/order", { method: "POST", body: { ids: [SECOND, EPUB] } }))).status).toBe(403);

    auth.mockResolvedValue(adminUser);
    expect((await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "Big", format: "epub", byteSize: 60 * 1024 * 1024 } }))).status).toBe(413);
    const created = await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "Bible", author: "Rob", format: "epub", byteSize: 10, cover: { mime: "image/jpeg", byteSize: 5 } } }));
    expect(created.status).toBe(201);
    const { id, bookUploadUrl, coverUploadUrl } = await created.json();
    expect(bookUploadUrl).toContain(`books/${id}.epub`);
    expect(coverUploadUrl).toContain(`covers/${id}.jpg`);
    const row = fake.tables.reader_books.find((b) => b.id === id)!;
    expect(row).toMatchObject({ format: "epub", ready: false, sort: 5, created_by: "acct-admin" });
    // Not on members' shelves until the file has been checked.
    auth.mockResolvedValue(member);
    expect((await (await listBooks(req("/api/chat/reader/books"))).json()).books.map((b: { id: string }) => b.id)).not.toContain(id);
    auth.mockResolvedValue(adminUser);
    // The file arrives (the cover didn't): the first bytes are checked and the missing cover dropped.
    vi.stubGlobal("fetch", async (url: string) => (String(url).includes(`books/${id}`) ? new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])) : new Response("", { status: 404 })));
    expect((await patchBook(req(`/api/chat/reader/books/${id}`, { method: "PATCH", body: { ready: true } }), params(id))).status).toBe(200);
    expect(fake.tables.reader_books.find((b) => b.id === id)).toMatchObject({ ready: true, cover_path: null });
    // An "EPUB" that is really a PDF renamed is removed.
    const fakeEpub = await (await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "Fake", format: "epub", byteSize: 10 } }))).json();
    vi.stubGlobal("fetch", async () => new Response("%PDF-1.7"));
    expect((await patchBook(req(`/api/chat/reader/books/${fakeEpub.id}`, { method: "PATCH", body: { ready: true } }), params(fakeEpub.id))).status).toBe(422);
    expect(fake.tables.reader_books.some((b) => b.id === fakeEpub.id)).toBe(false);
    // Reorder, hide, delete.
    expect((await saveOrder(req("/api/chat/reader/order", { method: "POST", body: { ids: [id, SECOND, EPUB] } }))).status).toBe(200);
    expect(fake.tables.reader_books.find((b) => b.id === id)!.sort).toBe(1);
    expect((await patchBook(req(`/api/chat/reader/books/${SECOND}`, { method: "PATCH", body: { hidden: true, title: "  New  title " } }), params(SECOND))).status).toBe(200);
    expect(fake.tables.reader_books.find((b) => b.id === SECOND)).toMatchObject({ hidden: true, title: "New title" });
    expect((await patchBook(req(`/api/chat/reader/books/${SECOND}`, { method: "PATCH", body: { hidden: "yes" } }), params(SECOND))).status).toBe(400);
    expect((await deleteBook(req(`/api/chat/reader/books/${EPUB}`, { method: "DELETE" }), params(EPUB))).status).toBe(200);
    expect(fake.tables.reader_books.some((b) => b.id === EPUB)).toBe(false);
    expect(fake.tables.reader_progress.some((p) => p.book_id === EPUB)).toBe(false);
  });

  it("#406: refuses a PDF upload with a clear message, before saving anything", async () => {
    auth.mockResolvedValue(adminUser);
    const before = fake.tables.reader_books.length;
    for (const format of ["pdf", "mobi"]) {
      const response = await createBook(req("/api/chat/reader/books", { method: "POST", body: { title: "Club Notes", format, byteSize: 10 } }));
      expect(response.status).toBe(415);
      expect(await response.json()).toEqual({ error: "epub_only", message: "Only EPUB books can be added to the Reader." });
    }
    expect(fake.tables.reader_books).toHaveLength(before);
    expect(fake.calls.filter((c) => c.startsWith("insert"))).toEqual([]);
    // A PDF row from before can't be made ready either: it is removed instead.
    vi.stubGlobal("fetch", async () => new Response("%PDF-1.7"));
    fake.tables.reader_books.push(book("66666666-6666-4666-8666-666666666666", "pdf", { ready: false }));
    expect((await patchBook(req("/api/chat/reader/books/66666666-6666-4666-8666-666666666666", { method: "PATCH", body: { ready: true } }), params("66666666-6666-4666-8666-666666666666"))).status).toBe(422);
  });
});
