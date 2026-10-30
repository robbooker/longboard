import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #321 Pages: who can read, add, edit, pin and remove; private links never leave their owner.
const mock = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), origin: vi.fn(), member: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin, requestOriginAllowed: mock.origin }));
vi.mock("@/lib/chatMembers", () => ({ findChatMember: mock.member }));

import * as pagesRoute from "@/app/api/chat/pages/route";
import * as linksRoute from "@/app/api/chat/pages/links/route";
import * as myLinksRoute from "@/app/api/chat/pages/my-links/route";
import * as shareRoute from "@/app/api/chat/pages/my-links/share/route";
import * as likesRoute from "@/app/api/chat/pages/links/likes/route";

type Query = {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert" | "rpc";
  filters: Array<[string, string, unknown]>;
  payload?: unknown;
};
type Result = { data?: unknown; error?: unknown };
let queries: Query[];
let respond: (query: Query) => Result;

function builder(table: string) {
  const query: Query = { table, op: "select", filters: [] };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = () => self();
  chain.insert = (payload: unknown) => ((query.op = "insert"), (query.payload = payload), self());
  chain.update = (payload: unknown) => ((query.op = "update"), (query.payload = payload), self());
  chain.delete = () => ((query.op = "delete"), self());
  chain.upsert = (payload: unknown, options: unknown) => ((query.op = "upsert"), (query.payload = { payload, options }), self());
  chain.eq = (column: string, value: unknown) => (query.filters.push(["eq", column, value]), self());
  chain.in = (column: string, value: unknown) => (query.filters.push(["in", column, value]), self());
  chain.order = self;
  chain.limit = self;
  chain.single = self;
  chain.maybeSingle = self;
  chain.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => {
    queries.push(query);
    try {
      const result = respond(query);
      return Promise.resolve({ data: null, error: null, ...result }).then(resolve, reject);
    } catch (error) {
      return Promise.reject(error).then(resolve, reject);
    }
  };
  return chain;
}
// admin.rpc(name, args) is recorded like a query on the function's name.
function rpc(name: string, args: unknown) {
  const query: Query = { table: name, op: "rpc", filters: [], payload: args };
  queries.push(query);
  try {
    return Promise.resolve({ data: null, error: null, ...respond(query) });
  } catch (error) {
    return Promise.reject(error);
  }
}

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PAGE = "33333333-3333-4333-8333-333333333333";
const LINK = "44444444-4444-4444-8444-444444444444";
const TRADER_PAGE = "55555555-5555-4555-8555-555555555555";

const access = (extra: Record<string, unknown> = {}) => ({
  ok: true,
  user: { id: "user-1", email: "", role: "user" },
  access: { longboard: true, shortscout: false, admin: false, ...extra },
  serverSession: false,
});
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`https://chat.robbooker.com${url}`, {
    method,
    headers: { host: "chat.robbooker.com", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const writes = () => queries.filter((query) => query.op !== "select" && query.op !== "rpc");
const eqs = (query: Query | undefined) => Object.fromEntries((query?.filters ?? []).filter((f) => f[0] === "eq").map((f) => [f[1], f[2]]));

beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  respond = () => ({ data: null });
  mock.auth.mockResolvedValue(access());
  mock.admin.mockReturnValue({ from: builder, rpc });
  mock.origin.mockReturnValue(true);
  mock.member.mockResolvedValue({ id: ME, display_name: "Me" });
});

describe("who may use Pages", () => {
  it("requires sign-in", async () => {
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await pagesRoute.GET(req("/api/chat/pages"))).status).toBe(401);
    expect((await myLinksRoute.GET(req("/api/chat/pages/my-links"))).status).toBe(401);
    expect(queries).toEqual([]);
  });
  it("refuses accounts with no chat tier and people without a chat name", async () => {
    mock.auth.mockResolvedValue(access({ longboard: false }));
    expect((await pagesRoute.GET(req("/api/chat/pages"))).status).toBe(403);
    mock.auth.mockResolvedValue(access());
    mock.member.mockResolvedValue(null);
    const response = await linksRoute.GET(req(`/api/chat/pages/links?page=${PAGE}`));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Choose your chat name first." });
  });
  it("lets a ShortScout-only member in, like Social", async () => {
    mock.auth.mockResolvedValue(access({ longboard: false, shortscoutMember: true }));
    respond = () => ({ data: [] });
    expect((await pagesRoute.GET(req("/api/chat/pages"))).status).toBe(200);
  });
  it("origin-checks every write before auth", async () => {
    mock.origin.mockReturnValue(false);
    expect((await pagesRoute.POST(req("/api/chat/pages", "POST", {}))).status).toBe(403);
    expect((await pagesRoute.PATCH(req("/api/chat/pages", "PATCH", {}))).status).toBe(403);
    expect((await linksRoute.POST(req("/api/chat/pages/links", "POST", {}))).status).toBe(403);
    expect((await myLinksRoute.DELETE(req(`/api/chat/pages/my-links?id=${LINK}`, "DELETE"))).status).toBe(403);
    expect(mock.auth).not.toHaveBeenCalled();
  });
});

describe("/api/chat/pages", () => {
  it("lists pages with only the embed address on embed pages", async () => {
    respond = () => ({
      data: [
        { id: PAGE, slug: "market-dashboard", name: "Market Dashboard", kind: "embed", embed_url: "https://dashboard.robbooker.com", built_in: true },
        { id: TRADER_PAGE, slug: "trader-links", name: "Trader Links", kind: "links", embed_url: "https://stray", built_in: true },
      ],
    });
    const body = await (await pagesRoute.GET(req("/api/chat/pages"))).json();
    expect(body.canManage).toBe(false);
    expect(body.pages[0]).toEqual({ id: PAGE, slug: "market-dashboard", name: "Market Dashboard", kind: "embed", embedUrl: "https://dashboard.robbooker.com", builtIn: true });
    expect(body.pages[1].embedUrl).toBeNull();
  });
  it("embeds must be https and not the chat itself", async () => {
    mock.auth.mockResolvedValue(access({ admin: true }));
    const http = await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "X", kind: "embed", embedUrl: "http://a.com" }));
    expect(http.status).toBe(400);
    expect((await http.json()).error).toMatch(/https:\/\//);
    expect((await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "X", kind: "embed", embedUrl: "https://chat.robbooker.com/chat" }))).status).toBe(400);
    expect(writes()).toEqual([]);
    respond = (query) => ({ data: { id: PAGE, slug: "x-abc", ...(query.payload as object), built_in: false } });
    const ok = await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "Calendar", kind: "embed", embedUrl: "https://cal.example.com" }));
    expect(ok.status).toBe(201);
    expect(writes()[0].payload).toMatchObject({ name: "Calendar", kind: "embed", embed_url: "https://cal.example.com/", created_by: ME });
    // #329: no approval step: no status is sent, so the row takes the 'approved' default.
    expect(writes()[0].payload).not.toHaveProperty("status");
    expect(writes()[0].payload).not.toHaveProperty("suggested_by");
    expect((await ok.json()).page.name).toBe("Calendar");
  });
  it("admins remove only pages that are not built in", async () => {
    mock.auth.mockResolvedValue(access({ admin: true }));
    respond = () => ({ data: [{ id: PAGE }] });
    expect((await pagesRoute.DELETE(req(`/api/chat/pages?id=${PAGE}`, "DELETE"))).status).toBe(200);
    expect(eqs(writes()[0])).toEqual({ id: PAGE, built_in: false });
  });
});

describe("/api/chat/pages/links (shared)", () => {
  const sharedPage = (query: Query) => (query.table === "chat_pages" ? { data: { id: PAGE, kind: "links" } } : undefined);
  it("lists links with the adder's name and who may edit, pinned first", async () => {
    respond = (query) =>
      sharedPage(query) ??
      (query.table === "longboard_chat_members"
        ? { data: [{ id: ME, display_name: "Me" }, { id: OTHER, display_name: "Pat" }] }
        : {
            data: [
              { id: "a", title: "Mine", url: "https://a.com/", note: null, pinned: false, added_by: ME, created_at: "2026-10-02" },
              { id: "b", title: "Theirs", url: "https://b.com/", note: "n", pinned: true, added_by: OTHER, created_at: "2026-10-01" },
            ],
          });
    const body = await (await linksRoute.GET(req(`/api/chat/pages/links?page=${PAGE}`))).json();
    expect(body.canPin).toBe(false);
    expect(body.links.map((link: { id: string; canEdit: boolean; addedByName: string }) => [link.id, link.canEdit, link.addedByName])).toEqual([
      ["b", false, "Pat"],
      ["a", true, "Me"],
    ]);
  });
  it("refuses a page that is not a shared list (e.g. My Links)", async () => {
    respond = (query) => (query.table === "chat_pages" ? { data: { id: PAGE, kind: "my-links" } } : { data: [] });
    expect((await linksRoute.GET(req(`/api/chat/pages/links?page=${PAGE}`))).status).toBe(404);
    expect((await linksRoute.POST(req("/api/chat/pages/links", "POST", { pageId: PAGE, title: "x", url: "https://a.com" }))).status).toBe(404);
    expect(writes()).toEqual([]);
  });
  it("any member adds a link, recorded as added by them", async () => {
    respond = (query) =>
      sharedPage(query) ??
      (query.op === "insert"
        ? { data: { id: LINK, ...(query.payload as object), created_at: "2026-10-29" } }
        : { data: [{ id: ME, display_name: "Me" }] });
    const response = await linksRoute.POST(
      req("/api/chat/pages/links", "POST", { pageId: PAGE, title: "Finviz", url: "https://finviz.com", note: "screener", added_by: OTHER, pinned: true }),
    );
    expect(response.status).toBe(201);
    expect(writes()[0].payload).toEqual({ page_id: PAGE, title: "Finviz", url: "https://finviz.com/", note: "screener", added_by: ME });
  });
  it("refuses non-https links with a clear message", async () => {
    const response = await linksRoute.POST(req("/api/chat/pages/links", "POST", { pageId: PAGE, title: "x", url: "http://a.com" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Only secure web addresses can be saved. Start the address with https://");
    expect(queries).toEqual([]);
  });
  it("someone else's link cannot be edited or removed by a member", async () => {
    respond = () => ({ data: { id: LINK, added_by: OTHER } });
    expect((await linksRoute.PATCH(req("/api/chat/pages/links", "PATCH", { id: LINK, title: "x", url: "https://a.com" }))).status).toBe(403);
    expect((await linksRoute.DELETE(req(`/api/chat/pages/links?id=${LINK}`, "DELETE"))).status).toBe(403);
    expect(writes()).toEqual([]);
  });
  it("the adder edits and removes their own link", async () => {
    respond = (query) =>
      query.op === "select" && query.table === "chat_page_links"
        ? { data: { id: LINK, added_by: ME } }
        : query.table === "longboard_chat_members"
          ? { data: [] }
          : { data: { id: LINK, title: "New", url: "https://a.com/", note: null, pinned: false, added_by: ME, created_at: "x" } };
    expect((await linksRoute.PATCH(req("/api/chat/pages/links", "PATCH", { id: LINK, title: "New", url: "https://a.com" }))).status).toBe(200);
    expect((await linksRoute.DELETE(req(`/api/chat/pages/links?id=${LINK}`, "DELETE"))).status).toBe(200);
    expect(writes().map((query) => [query.op, eqs(query).id])).toEqual([
      ["update", LINK],
      ["delete", LINK],
    ]);
  });
  it("an admin edits, removes and pins anyone's link; members cannot pin", async () => {
    expect((await linksRoute.PATCH(req("/api/chat/pages/links", "PATCH", { id: LINK, pinned: true }))).status).toBe(403);
    expect(queries).toEqual([]);
    mock.auth.mockResolvedValue(access({ admin: true }));
    respond = (query) =>
      query.op === "select" && query.table === "chat_page_links"
        ? { data: { id: LINK, added_by: OTHER } }
        : query.table === "longboard_chat_members"
          ? { data: [] }
          : { data: { id: LINK, title: "T", url: "https://a.com/", note: null, pinned: true, added_by: OTHER, created_at: "x" } };
    const pinned = await linksRoute.PATCH(req("/api/chat/pages/links", "PATCH", { id: LINK, pinned: true }));
    expect(pinned.status).toBe(200);
    expect(writes()[0].payload).toMatchObject({ pinned: true });
    expect((await linksRoute.DELETE(req(`/api/chat/pages/links?id=${LINK}`, "DELETE"))).status).toBe(200);
  });
  it("hides server failures", async () => {
    respond = () => {
      throw new Error("secret db detail");
    };
    const response = await linksRoute.GET(req(`/api/chat/pages/links?page=${PAGE}`));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("/api/chat/pages/my-links (private)", () => {
  it("every read and write is limited to the verified member, whatever the caller sends", async () => {
    respond = (query) => ({ data: query.op === "select" ? [] : query.op === "delete" ? [{ id: LINK }] : { id: LINK, title: "x", url: "https://a.com/", note: null, created_at: "x" } });
    await myLinksRoute.GET(req(`/api/chat/pages/my-links?member=${OTHER}`));
    await myLinksRoute.POST(req("/api/chat/pages/my-links", "POST", { title: "x", url: "https://a.com", member_id: OTHER }));
    await myLinksRoute.PATCH(req("/api/chat/pages/my-links", "PATCH", { id: LINK, title: "x", url: "https://a.com", member_id: OTHER }));
    await myLinksRoute.DELETE(req(`/api/chat/pages/my-links?id=${LINK}`, "DELETE"));
    const own = queries.filter((query) => query.table === "chat_private_links");
    expect(own).toHaveLength(4);
    expect(eqs(own[0]).member_id).toBe(ME);
    expect((own[1].payload as { member_id: string }).member_id).toBe(ME);
    expect(eqs(own[2])).toEqual({ id: LINK, member_id: ME });
    expect(eqs(own[3])).toEqual({ id: LINK, member_id: ME });
    expect(queries.some((query) => query.table === "longboard_chat_members")).toBe(false);
  });
  it("admins get no view of other people's private links", async () => {
    mock.auth.mockResolvedValue(access({ admin: true }));
    respond = () => ({ data: [] });
    await myLinksRoute.GET(req("/api/chat/pages/my-links"));
    expect(eqs(queries[0]).member_id).toBe(ME);
  });
  it("another member's link is simply not found", async () => {
    respond = () => ({ data: null });
    expect((await myLinksRoute.PATCH(req("/api/chat/pages/my-links", "PATCH", { id: LINK, title: "x", url: "https://a.com" }))).status).toBe(404);
    respond = () => ({ data: [] });
    expect((await myLinksRoute.DELETE(req(`/api/chat/pages/my-links?id=${LINK}`, "DELETE"))).status).toBe(404);
  });
  it("shared-list responses never include private links, and private ones carry no adder", async () => {
    respond = () => ({ data: [{ id: LINK, title: "x", url: "https://a.com/", note: null, created_at: "x" }] });
    const body = await (await myLinksRoute.GET(req("/api/chat/pages/my-links"))).json();
    expect(body.links[0]).toMatchObject({ id: LINK, addedBy: null, addedByName: null, pinned: false, canEdit: true });
  });
  it("refuses non-https", async () => {
    expect((await myLinksRoute.POST(req("/api/chat/pages/my-links", "POST", { title: "x", url: "http://a.com" }))).status).toBe(400);
    expect(queries).toEqual([]);
  });
});

describe("Share", () => {
  it("copies the member's own private link to Trader Links as added by them", async () => {
    respond = (query) =>
      query.table === "chat_private_links"
        ? { data: { title: "Finviz", url: "https://finviz.com/", note: null } }
        : query.table === "chat_pages"
          ? { data: { id: TRADER_PAGE } }
          : query.op === "select"
            ? { data: [] }
            : { data: null };
    const response = await shareRoute.POST(req("/api/chat/pages/my-links/share", "POST", { id: LINK }));
    expect(response.status).toBe(201);
    expect(eqs(queries[0])).toEqual({ id: LINK, member_id: ME });
    expect(eqs(queries[1])).toEqual({ slug: "trader-links", kind: "links", status: "approved" });
    expect(writes()).toEqual([
      { table: "chat_page_links", op: "insert", filters: [], payload: { page_id: TRADER_PAGE, title: "Finviz", url: "https://finviz.com/", note: null, added_by: ME } },
    ]);
  });
  it("cannot share someone else's link, and does not add a link twice", async () => {
    respond = () => ({ data: null });
    expect((await shareRoute.POST(req("/api/chat/pages/my-links/share", "POST", { id: LINK }))).status).toBe(404);
    respond = (query) =>
      query.table === "chat_private_links"
        ? { data: { title: "Finviz", url: "https://finviz.com/", note: null } }
        : query.table === "chat_pages"
          ? { data: { id: TRADER_PAGE } }
          : { data: [{ id: "existing" }] };
    expect((await shareRoute.POST(req("/api/chat/pages/my-links/share", "POST", { id: LINK }))).status).toBe(409);
    expect(writes()).toEqual([]);
  });
});

describe("likes (#323)", () => {
  const SUMMARY = "chat_page_link_like_summary";
  const LIST_ROWS = [
    { id: "a", title: "Mine", url: "https://a.com/", note: null, pinned: false, added_by: ME, created_at: "2026-10-03" },
    { id: "b", title: "Popular", url: "https://b.com/", note: null, pinned: false, added_by: OTHER, created_at: "2026-10-01" },
    { id: "c", title: "Pinned", url: "https://c.com/", note: null, pinned: true, added_by: OTHER, created_at: "2026-09-01" },
    { id: "d", title: "Newest", url: "https://d.com/", note: null, pinned: false, added_by: OTHER, created_at: "2026-10-04" },
  ];
  /** A link on a page of this kind, added by this member. */
  const linkOn = (kind: string, addedBy: string, summary: unknown[] = [{ link_id: LINK, like_count: 4, liked_by_me: true }]) =>
    (query: Query) =>
      query.table === "chat_page_links"
        ? { data: query.op === "select" ? { id: LINK, page_id: PAGE, added_by: addedBy } : null }
        : query.table === "chat_pages"
          ? { data: { id: PAGE, kind } }
          : query.op === "rpc"
            ? { data: summary }
            : { data: null };

  it("the list carries counts and liked-by-me, ranked by likes under the pinned link", async () => {
    respond = (query) =>
      query.table === "chat_pages"
        ? { data: { id: PAGE, kind: "links" } }
        : query.op === "rpc"
          ? { data: [{ link_id: "b", like_count: 5, liked_by_me: true }, { link_id: "a", like_count: "2", liked_by_me: false }] }
          : query.table === "longboard_chat_members"
            ? { data: [] }
            : { data: LIST_ROWS };
    const body = await (await linksRoute.GET(req(`/api/chat/pages/links?page=${PAGE}`))).json();
    expect(body.likes).toBe(true);
    expect(body.links.map((link: { id: string; likeCount: number; likedByMe: boolean; addedByMe: boolean }) => [link.id, link.likeCount, link.likedByMe, link.addedByMe])).toEqual([
      ["c", 0, false, false],
      ["b", 5, true, false],
      ["a", 2, false, true],
      ["d", 0, false, false],
    ]);
    // One grouped read for the whole page, for the verified member only.
    const reads = queries.filter((query) => query.op === "rpc");
    expect(reads).toEqual([{ table: SUMMARY, op: "rpc", filters: [], payload: { p_page: PAGE, p_member: ME, p_link: null } }]);
  });
  it("the list still loads (without likes) if likes can't be read", async () => {
    respond = (query) =>
      query.table === "chat_pages"
        ? { data: { id: PAGE, kind: "links" } }
        : query.op === "rpc"
          ? { error: { message: "function does not exist" } }
          : query.table === "longboard_chat_members"
            ? { data: [] }
            : { data: LIST_ROWS };
    const response = await linksRoute.GET(req(`/api/chat/pages/links?page=${PAGE}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.likes).toBe(false);
    expect(body.links.every((link: { likeCount: number }) => link.likeCount === 0)).toBe(true);
  });
  it("a member likes someone else's link once, as themselves, and gets the server's count", async () => {
    respond = linkOn("links", OTHER);
    const response = await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK, member_id: OTHER }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: LINK, likeCount: 4, likedByMe: true });
    expect(writes()).toEqual([
      {
        table: "chat_page_link_likes",
        op: "upsert",
        filters: [],
        payload: { payload: { link_id: LINK, member_id: ME }, options: { onConflict: "link_id,member_id", ignoreDuplicates: true } },
      },
    ]);
    expect(queries.find((query) => query.op === "rpc")?.payload).toEqual({ p_page: PAGE, p_member: ME, p_link: LINK });
  });
  it("tapping again takes the like back, only the member's own", async () => {
    respond = linkOn("links", OTHER, []);
    const response = await likesRoute.DELETE(req(`/api/chat/pages/links/likes?id=${LINK}&member=${OTHER}`, "DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: LINK, likeCount: 0, likedByMe: false });
    const [removed] = writes();
    expect([removed.table, removed.op, eqs(removed)]).toEqual(["chat_page_link_likes", "delete", { link_id: LINK, member_id: ME }]);
  });
  it("nobody can like their own link, admins included", async () => {
    respond = linkOn("links", ME);
    const response = await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("You can't like your own link.");
    mock.auth.mockResolvedValue(access({ admin: true }));
    expect((await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }))).status).toBe(403);
    expect(writes()).toEqual([]);
  });
  it("links that aren't on a shared list, or don't exist, can't be liked", async () => {
    respond = linkOn("my-links", OTHER);
    expect((await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }))).status).toBe(404);
    respond = linkOn("embed", OTHER);
    expect((await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }))).status).toBe(404);
    respond = () => ({ data: null });
    expect((await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }))).status).toBe(404);
    expect((await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: "not-a-uuid" }))).status).toBe(404);
    expect(writes()).toEqual([]);
  });
  it("needs a signed-in chat member, and checks the origin first", async () => {
    mock.origin.mockReturnValue(false);
    expect((await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }))).status).toBe(403);
    expect(mock.auth).not.toHaveBeenCalled();
    mock.origin.mockReturnValue(true);
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }))).status).toBe(401);
    mock.auth.mockResolvedValue(access());
    mock.member.mockResolvedValue(null);
    expect((await likesRoute.DELETE(req(`/api/chat/pages/links/likes?id=${LINK}`, "DELETE"))).status).toBe(403);
    expect(queries).toEqual([]);
  });
  it("hides server failures", async () => {
    respond = (query) => (query.op === "upsert" ? { error: { message: "secret db detail" } } : linkOn("links", OTHER)(query));
    const response = await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("page suggestions (#329)", () => {
  const SUGGESTION = "66666666-6666-4666-8666-666666666666";
  const pending = { id: SUGGESTION, slug: "secret-abc", name: "Secret idea", kind: "embed", embed_url: "https://secret.example.com/", built_in: false, status: "pending", suggested_by: OTHER, created_at: "2026-10-30" };
  /**
   * A small stand-in for chat_pages holding one row: a read gets the row only if it passes the
   * query's status and id filters, so a route that forgets the filter leaks and fails the test.
   */
  const table = (row: Record<string, unknown>, rest: (query: Query) => Result = () => ({ data: [] })) => (query: Query) => {
    if (query.table !== "chat_pages") return rest(query);
    const matches = query.filters.every(([op, column, value]) => (op === "in" ? (value as unknown[]).includes(row[column]) : row[column] === value));
    return { data: matches ? [row] : [] };
  };
  const single = (row: Record<string, unknown>) => (query: Query) => {
    const result = table(row)(query);
    return query.table === "chat_pages" ? { data: (result.data as unknown[])[0] ?? null } : result;
  };
  const ids = (list: Array<{ id: string }>) => list.map((item) => item.id);

  it("a member's new page waits for approval, recorded as theirs whatever the caller sends", async () => {
    respond = (query) => ({ data: { id: SUGGESTION, created_at: "2026-10-30", ...(query.payload as object) } });
    const response = await pagesRoute.POST(
      req("/api/chat/pages", "POST", { name: "Calendar", kind: "embed", embedUrl: "https://cal.example.com", status: "approved", suggested_by: OTHER, built_in: true }),
    );
    expect(response.status).toBe(201);
    const [insert] = writes();
    expect(insert.payload).toMatchObject({ name: "Calendar", kind: "embed", embed_url: "https://cal.example.com/", status: "pending", suggested_by: ME, created_by: ME });
    expect(insert.payload).not.toHaveProperty("built_in");
    const body = await response.json();
    expect(body.page).toBeUndefined();
    expect(body.suggestion).toMatchObject({ id: SUGGESTION, name: "Calendar", status: "pending", suggestedByName: null });
  });
  it("a member's suggestion goes through the same checks as an admin's page", async () => {
    expect((await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "X", kind: "embed", embedUrl: "http://a.com" }))).status).toBe(400);
    expect((await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "X", kind: "embed", embedUrl: "https://chat.robbooker.com/chat" }))).status).toBe(400);
    expect((await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "", kind: "links" }))).status).toBe(400);
    expect(writes()).toEqual([]);
  });
  it("guests and people with no chat name can't suggest", async () => {
    mock.auth.mockResolvedValue(access({ longboard: false }));
    expect((await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "X", kind: "links" }))).status).toBe(403);
    mock.auth.mockResolvedValue(access());
    mock.member.mockResolvedValue(null);
    expect((await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "X", kind: "links" }))).status).toBe(403);
    expect(queries).toEqual([]);
  });
  it("the waiting limit comes back as a plain message", async () => {
    respond = () => ({ error: { message: "chat_page_suggestion_limit" } });
    const response = await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "Fourth", kind: "links" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("You already have 3 pages waiting for approval. Please wait for an admin to look at them.");
  });
  it("a pending page reaches no other member's sidebar, and no waiting list", async () => {
    respond = table(pending);
    const body = await (await pagesRoute.GET(req("/api/chat/pages"))).json();
    expect(body.pages).toEqual([]);
    expect(body.suggestions).toEqual([]);
    expect(body.waiting).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Secret idea");
    expect(queries.filter((query) => query.table === "chat_pages")).toHaveLength(2);
  });
  it("the suggester sees theirs marked, not in the sidebar's pages", async () => {
    respond = table({ ...pending, suggested_by: ME });
    const body = await (await pagesRoute.GET(req("/api/chat/pages"))).json();
    expect(body.pages).toEqual([]);
    expect(body.suggestions).toEqual([{ id: SUGGESTION, name: "Secret idea", kind: "embed", embedUrl: "https://secret.example.com/", status: "pending", suggestedByName: null, createdAt: "2026-10-30" }]);
    respond = table({ ...pending, suggested_by: ME, status: "declined" });
    const declined = await (await pagesRoute.GET(req("/api/chat/pages"))).json();
    expect(declined.pages).toEqual([]);
    expect(declined.suggestions[0].status).toBe("declined");
  });
  it("an approved suggestion is an ordinary page for everyone, no longer marked", async () => {
    respond = table({ ...pending, status: "approved" });
    const body = await (await pagesRoute.GET(req("/api/chat/pages"))).json();
    expect(ids(body.pages)).toEqual([SUGGESTION]);
    expect(body.suggestions).toEqual([]);
  });
  it("a declined page reaches no one but its suggester", async () => {
    respond = table({ ...pending, status: "declined" });
    const member = await (await pagesRoute.GET(req("/api/chat/pages"))).json();
    expect([member.pages, member.suggestions, member.waiting]).toEqual([[], [], []]);
    mock.auth.mockResolvedValue(access({ admin: true }));
    const admin = await (await pagesRoute.GET(req("/api/chat/pages"))).json();
    expect([admin.pages, admin.suggestions, admin.waiting]).toEqual([[], [], []]);
  });
  it("admins get the waiting list with who suggested each; members never do", async () => {
    mock.auth.mockResolvedValue(access({ admin: true }));
    respond = table(pending, () => ({ data: [{ id: OTHER, display_name: "Pat" }] }));
    const body = await (await pagesRoute.GET(req("/api/chat/pages"))).json();
    expect(body.pages).toEqual([]);
    expect(ids(body.waiting)).toEqual([SUGGESTION]);
    expect(body.waiting[0].suggestedByName).toBe("Pat");
    expect(queries.find((query) => query.table === "longboard_chat_members")?.filters).toEqual([["in", "id", [OTHER]]]);
  });
  it("a pending page can't be read or added to through the links, likes or share routes, by anyone", async () => {
    for (const person of [access(), access({ admin: true })]) {
      mock.auth.mockResolvedValue(person);
      // Whoever it is, the suggester included: a list only opens once it is approved.
      for (const suggested_by of [OTHER, ME]) {
        respond = single({ ...pending, kind: "links", embed_url: null, suggested_by });
        expect((await linksRoute.GET(req(`/api/chat/pages/links?page=${SUGGESTION}`))).status).toBe(404);
        expect((await linksRoute.POST(req("/api/chat/pages/links", "POST", { pageId: SUGGESTION, title: "x", url: "https://a.com" }))).status).toBe(404);
        const onPage = single({ ...pending, kind: "links", embed_url: null, suggested_by });
        respond = (query) => (query.table === "chat_page_links" ? { data: { id: LINK, page_id: SUGGESTION, added_by: OTHER } } : onPage(query));
        expect((await likesRoute.POST(req("/api/chat/pages/links/likes", "POST", { id: LINK }))).status).toBe(404);
      }
    }
    expect(writes()).toEqual([]);
    expect(queries.filter((query) => query.op === "rpc")).toEqual([]);
    expect(queries.filter((query) => query.table === "chat_page_links")).toHaveLength(4);
  });
  it("Trader Links still takes a member's link at once, with no approval", async () => {
    respond = (query) =>
      query.table === "chat_pages"
        ? single({ id: TRADER_PAGE, kind: "links", status: "approved" })(query)
        : query.op === "insert"
          ? { data: { id: LINK, ...(query.payload as object), created_at: "2026-10-30" } }
          : { data: [{ id: ME, display_name: "Me" }] };
    const response = await linksRoute.POST(req("/api/chat/pages/links", "POST", { pageId: TRADER_PAGE, title: "Finviz", url: "https://finviz.com" }));
    expect(response.status).toBe(201);
    expect(writes()[0].payload).toEqual({ page_id: TRADER_PAGE, title: "Finviz", url: "https://finviz.com/", note: null, added_by: ME });
    expect(JSON.stringify(writes()[0].payload)).not.toContain("status");
  });
  it("members can't approve or decline: the server refuses before touching anything", async () => {
    for (const decision of ["approve", "decline"]) {
      const response = await pagesRoute.PATCH(req("/api/chat/pages", "PATCH", { id: SUGGESTION, decision }));
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("Only admins can approve or decline pages.");
    }
    expect(queries).toEqual([]);
  });
  it("the suggester can't approve their own page either", async () => {
    respond = single({ ...pending, suggested_by: ME });
    expect((await pagesRoute.PATCH(req("/api/chat/pages", "PATCH", { id: SUGGESTION, decision: "approve", status: "approved" }))).status).toBe(403);
    expect(writes()).toEqual([]);
  });
  it.each([
    ["approve", "approved"],
    ["decline", "declined"],
  ])("an admin can %s a page still waiting, recorded as theirs", async (decision, status) => {
    mock.auth.mockResolvedValue(access({ admin: true }));
    respond = () => ({ data: [{ id: SUGGESTION }] });
    const response = await pagesRoute.PATCH(req("/api/chat/pages", "PATCH", { id: SUGGESTION, decision, decided_by: OTHER }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status });
    const [update] = writes();
    expect(update.payload).toMatchObject({ status, decided_by: ME });
    expect(typeof (update.payload as { decided_at: unknown }).decided_at).toBe("string");
    expect(eqs(update)).toEqual({ id: SUGGESTION, status: "pending" });
  });
  it("a page can only be decided once, and only with a real decision", async () => {
    mock.auth.mockResolvedValue(access({ admin: true }));
    respond = () => ({ data: [] });
    expect((await pagesRoute.PATCH(req("/api/chat/pages", "PATCH", { id: SUGGESTION, decision: "decline" }))).status).toBe(409);
    expect((await pagesRoute.PATCH(req("/api/chat/pages", "PATCH", { id: SUGGESTION, decision: "pending" }))).status).toBe(400);
    expect((await pagesRoute.PATCH(req("/api/chat/pages", "PATCH", { id: "nope", decision: "approve" }))).status).toBe(400);
  });
  it("a member dismisses only their own declined suggestion, and still can't remove pages", async () => {
    respond = () => ({ data: [{ id: SUGGESTION }] });
    expect((await pagesRoute.DELETE(req(`/api/chat/pages?id=${SUGGESTION}&dismiss=1`, "DELETE"))).status).toBe(200);
    expect(eqs(writes()[0])).toEqual({ id: SUGGESTION, suggested_by: ME, status: "declined" });
    queries = [];
    respond = () => ({ data: [] });
    expect((await pagesRoute.DELETE(req(`/api/chat/pages?id=${SUGGESTION}&dismiss=1`, "DELETE"))).status).toBe(404);
    queries = [];
    expect((await pagesRoute.DELETE(req(`/api/chat/pages?id=${SUGGESTION}`, "DELETE"))).status).toBe(403);
    expect(queries).toEqual([]);
  });
  it("hides server failures", async () => {
    respond = () => ({ error: { message: "secret db detail" } });
    for (const response of [
      await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "X", kind: "links" })),
      await pagesRoute.GET(req("/api/chat/pages")),
    ]) {
      expect(response.status).toBe(503);
      expect(JSON.stringify(await response.json())).not.toContain("secret");
    }
  });
});
