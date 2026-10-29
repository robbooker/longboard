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

type Query = {
  table: string;
  op: "select" | "insert" | "update" | "delete";
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
const writes = () => queries.filter((query) => query.op !== "select");
const eqs = (query: Query | undefined) => Object.fromEntries((query?.filters ?? []).filter((f) => f[0] === "eq").map((f) => [f[1], f[2]]));

beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  respond = () => ({ data: null });
  mock.auth.mockResolvedValue(access());
  mock.admin.mockReturnValue({ from: builder });
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
  it("only admins add pages; embeds must be https and not the chat itself", async () => {
    expect((await pagesRoute.POST(req("/api/chat/pages", "POST", { name: "X", kind: "links" }))).status).toBe(403);
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
    expect(eqs(queries[1])).toEqual({ slug: "trader-links", kind: "links" });
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
