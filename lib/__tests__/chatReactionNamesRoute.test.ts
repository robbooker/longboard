import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), message: vi.fn(), reactions: vi.fn(), people: vi.fn(), selects: vi.fn(), filters: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({ from: mocks.from }) }));
import { GET } from "@/app/api/chat/reactions/route";
const id = "10000000-0000-4000-8000-000000000001";
const req = (room = "main", messageId = id) => new NextRequest(`https://example.test/api/chat/reactions?room=${room}&messageId=${messageId}`);
beforeEach(() => {
 vi.clearAllMocks();
 mocks.auth.mockResolvedValue({ ok: true, user: { id }, access: { longboard: true, shortscout: false, admin: false } });
 mocks.message.mockResolvedValue({ data: { id }, error: null });
 mocks.reactions.mockResolvedValue({ data: [{ guest_id: "one" }], error: null });
 mocks.people.mockResolvedValue({ data: [{ id: "one", display_name: "Jammie" }], error: null });
 mocks.from.mockImplementation(table => {
  const query = { select: (fields: string) => { mocks.selects(table, fields); return query; }, eq: (key: string, value: unknown) => { mocks.filters(table, key, value); return query; }, order: () => query, maybeSingle: mocks.message, limit: mocks.reactions, in: mocks.people };
  return query;
 });
});
it("requires authentication and room access before any data lookup", async () => {
 mocks.auth.mockResolvedValueOnce({ ok: false, status: 401, error: "unauthorized" });
 expect((await GET(req())).status).toBe(401);
 expect((await GET(req("shortscout"))).status).toBe(403);
 expect(mocks.from).not.toHaveBeenCalled();
});
it("rejects invalid input and messages outside the requested room", async () => {
 expect((await GET(req("main", "bad"))).status).toBe(400);
 mocks.message.mockResolvedValue({ data: null, error: null });
 expect((await GET(req())).status).toBe(404);
 expect(mocks.filters).toHaveBeenCalledWith("longboard_chat_messages", "room_slug", "main");
 expect(mocks.reactions).not.toHaveBeenCalled();
});
it("returns display names only for active reactions", async () => {
 const response = await GET(req());
 expect(await response.json()).toEqual({ names: ["Jammie"], hasMore: false });
 expect(mocks.filters).toHaveBeenCalledWith("longboard_chat_reactions", "active", true);
 expect(mocks.selects).toHaveBeenCalledWith("longboard_chat_guests", "id,display_name");
 expect(response.headers.get("Cache-Control")).toContain("no-store");
});
it("bounds names to ten and signals additional reactions", async () => {
 mocks.reactions.mockResolvedValue({ data: Array.from({length: 11}, (_, i) => ({ guest_id: String(i) })), error: null });
 const result = await (await GET(req())).json();
 expect(result.names).toHaveLength(10);expect(result.hasMore).toBe(true);
 expect(mocks.reactions).toHaveBeenCalledWith(11);
});
it("handles zero reactions without a name query and fails closed on database errors", async () => {
 mocks.reactions.mockResolvedValueOnce({ data: [], error: null });
 expect(await (await GET(req())).json()).toEqual({ names: [], hasMore: false });
 expect(mocks.people).not.toHaveBeenCalled();
 mocks.reactions.mockResolvedValueOnce({ error: { message: "failure" } });
 expect((await GET(req())).status).toBe(503);
});
