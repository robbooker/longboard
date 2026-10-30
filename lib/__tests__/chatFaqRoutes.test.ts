import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #332: anyone in chat reads the FAQ; only admins change it. A suggestion is posted server-side for
// the verified member, whatever the caller sends, and returns nothing from the Admins room.
const mock = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), origin: vi.fn(), member: vi.fn(), publish: vi.fn(), rpc: vi.fn(), ops: [] as string[], result: { data: null, error: null } as { data: unknown; error: unknown } }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin, requestOriginAllowed: mock.origin }));
vi.mock("@/lib/chatMembers", () => ({ findChatMember: mock.member }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: mock.publish }));

import * as faq from "@/app/api/chat/faq/route";
import * as suggestions from "@/app/api/chat/faq/suggestions/route";

const ME = "11111111-1111-4111-8111-111111111111";
const ITEM = "33333333-3333-4333-8333-333333333333";
const signedIn = (extra: Record<string, unknown> = {}) => ({ ok: true, user: { id: "user-1", email: "", role: "user" }, access: { longboard: true, shortscout: false, admin: false, ...extra }, serverSession: false });
const req = (url: string, method = "GET", body?: unknown) => new NextRequest(`https://chat.robbooker.com${url}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
function from(table: string) {
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "order", "limit", "single", "maybeSingle"]) chain[name] = () => chain;
  for (const name of ["insert", "update", "delete"]) chain[name] = () => (mock.ops.push(`${name}:${table}`), chain);
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(mock.result).then(resolve);
  return chain;
}
const good = { question: "Q?", answer: "A" };

beforeEach(() => {
  vi.clearAllMocks();
  mock.ops.length = 0;
  mock.result = { data: null, error: null };
  mock.auth.mockResolvedValue(signedIn());
  mock.origin.mockReturnValue(true);
  mock.member.mockResolvedValue({ id: ME, display_name: "Me" });
  mock.rpc.mockResolvedValue({ data: { posted: true }, error: null });
  mock.admin.mockReturnValue({ from, rpc: mock.rpc });
});

describe("reading the FAQ", () => {
  it("requires sign-in and a chat tier", async () => {
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await faq.GET(req("/api/chat/faq"))).status).toBe(401);
    mock.auth.mockResolvedValue(signedIn({ longboard: false }));
    expect((await faq.GET(req("/api/chat/faq"))).status).toBe(403);
  });
  it("gives a member the items, and says they can't manage them", async () => {
    mock.result = { data: [{ id: ITEM, ...good }], error: null };
    const body = await (await faq.GET(req("/api/chat/faq"))).json();
    expect(body).toEqual({ items: [{ id: ITEM, ...good }], canManage: false });
  });
  it("tells an admin they can manage them", async () => {
    mock.auth.mockResolvedValue(signedIn({ admin: true }));
    mock.result = { data: [], error: null };
    expect((await (await faq.GET(req("/api/chat/faq"))).json()).canManage).toBe(true);
  });
  it("says unavailable when the table is missing", async () => {
    mock.result = { data: null, error: { message: 'relation "chat_faq_items" does not exist' } };
    expect((await faq.GET(req("/api/chat/faq"))).status).toBe(503);
  });
});

describe("changing the FAQ", () => {
  it("refuses a member on every write and touches nothing", async () => {
    expect((await faq.POST(req("/api/chat/faq", "POST", good))).status).toBe(403);
    expect((await faq.PATCH(req("/api/chat/faq", "PATCH", { id: ITEM, ...good }))).status).toBe(403);
    expect((await faq.DELETE(req(`/api/chat/faq?id=${ITEM}`, "DELETE"))).status).toBe(403);
    expect(mock.ops).toEqual([]);
  });
  it("ignores a caller claiming to be an admin", async () => {
    expect((await faq.POST(req("/api/chat/faq", "POST", { ...good, admin: true, isAdmin: true, canManage: true }))).status).toBe(403);
    expect(mock.ops).toEqual([]);
  });
  it("refuses another site's request, even from an admin", async () => {
    mock.auth.mockResolvedValue(signedIn({ admin: true }));
    mock.origin.mockReturnValue(false);
    expect((await faq.POST(req("/api/chat/faq", "POST", good))).status).toBe(403);
    expect(mock.ops).toEqual([]);
  });
  it("lets an admin add, edit and delete", async () => {
    mock.auth.mockResolvedValue(signedIn({ admin: true }));
    mock.result = { data: { id: ITEM, ...good }, error: null };
    expect((await faq.POST(req("/api/chat/faq", "POST", good))).status).toBe(201);
    expect((await faq.PATCH(req("/api/chat/faq", "PATCH", { id: ITEM, ...good }))).status).toBe(200);
    expect((await faq.DELETE(req(`/api/chat/faq?id=${ITEM}`, "DELETE"))).status).toBe(200);
    expect(mock.ops).toEqual(["insert:chat_faq_items", "update:chat_faq_items", "delete:chat_faq_items"]);
  });
  it("checks an admin's input and ids", async () => {
    mock.auth.mockResolvedValue(signedIn({ admin: true }));
    expect((await faq.POST(req("/api/chat/faq", "POST", { question: "", answer: "a" }))).status).toBe(400);
    expect((await faq.PATCH(req("/api/chat/faq", "PATCH", { id: "nope", ...good }))).status).toBe(404);
    expect((await faq.DELETE(req("/api/chat/faq?id=nope", "DELETE"))).status).toBe(404);
    expect(mock.ops).toEqual([]);
  });
});

describe("suggesting a topic", () => {
  it("posts for the verified member, never a caller-sent one", async () => {
    const response = await suggestions.POST(req("/api/chat/faq/suggestions", "POST", { topic: " Margin \n calls ", member: "forged", p_member: "forged" }));
    expect(response.status).toBe(201);
    expect(mock.rpc).toHaveBeenCalledWith("post_chat_faq_suggestion", { p_member: ME, p_topic: "Margin calls" });
    expect(mock.publish).toHaveBeenCalledWith("admins", { kind: "changed", topics: ["history"] });
    expect(await response.json()).toEqual({ ok: true });
  });
  it("needs a topic, a chat member and this site", async () => {
    expect((await suggestions.POST(req("/api/chat/faq/suggestions", "POST", { topic: " " }))).status).toBe(400);
    mock.origin.mockReturnValue(false);
    expect((await suggestions.POST(req("/api/chat/faq/suggestions", "POST", { topic: "x" }))).status).toBe(403);
    mock.origin.mockReturnValue(true);
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await suggestions.POST(req("/api/chat/faq/suggestions", "POST", { topic: "x" }))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("refuses a bot account", async () => {
    mock.auth.mockResolvedValue(signedIn({ longboard: false, botRooms: ["developers", "admins"] }));
    expect((await suggestions.POST(req("/api/chat/faq/suggestions", "POST", { topic: "x" }))).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("explains the rate limit and doesn't announce a refused post", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "faq_suggestion_rate_limited" } });
    const response = await suggestions.POST(req("/api/chat/faq/suggestions", "POST", { topic: "x" }));
    expect(response.status).toBe(429);
    expect((await response.json()).error).toContain("try again later");
    expect(mock.publish).not.toHaveBeenCalled();
  });
  it("has no way to read suggestions back", () => {
    expect(Object.keys(suggestions)).not.toContain("GET");
  });
});
