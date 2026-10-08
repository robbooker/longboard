import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), resolve: vi.fn(), transform: vi.fn(), calls: [] as unknown[][], rows: [] as unknown[] }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.auth }));
vi.mock("@/lib/clarity/pair", () => ({ resolveClarityConversation: m.resolve }));
vi.mock("@/lib/clarity/transform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clarity/transform")>()),
  transformDraft: m.transform,
}));
vi.mock("@/lib/chatAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chatAdmin")>()),
  createChatAdminClient: () => ({
    from: (table: string) => {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      for (const op of ["select", "eq", "order", "limit"])
        chain[op] = (...args: unknown[]) => (m.calls.push([table, op, ...args]), op === "limit" ? Promise.resolve({ data: m.rows, error: null }) : chain);
      return chain;
    },
  }),
}));
import { GET } from "@/app/api/chat/clarity/route";
import { POST as transform } from "@/app/api/chat/clarity/transform/route";

const CONVO = "44444444-4444-4444-8444-444444444444";
const target = { conversationId: CONVO, senderMemberId: "rob-member", sender: "Rob", recipient: "Liz" };
const post = (body: unknown, origin = "https://www.longboardai.com") =>
  new NextRequest("https://www.longboardai.com/api/chat/clarity/transform", {
    method: "POST",
    headers: { origin, host: "www.longboardai.com", "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.rows = [];
  m.auth.mockResolvedValue({ ok: true, user: { id: "acct", role: "user" }, access: {} });
  m.resolve.mockResolvedValue(target);
  m.transform.mockResolvedValue({ intent: "i", suggestedMessage: "s", whyChanged: "w", ambiguityDetected: false, ambiguityNote: null });
});

it("reviews a draft for the pair using the server-derived direction, without storing anything", async () => {
  const response = await transform(post({ conversationId: CONVO, draft: "fix it today", variant: 1, sender: "Liz" }));
  expect(response.status).toBe(200);
  expect((await response.json()).result.suggestedMessage).toBe("s");
  // A client-supplied sender is ignored; direction comes from the verified DM.
  expect(m.transform).toHaveBeenCalledWith({ sender: "Rob", recipient: "Liz", originalMessage: "fix it today", variant: 1 });
  expect(m.calls).toEqual([]);
});

it("hides the feature from every other account and conversation without calling the model", async () => {
  m.resolve.mockResolvedValue(null);
  expect((await transform(post({ conversationId: CONVO, draft: "hi" }))).status).toBe(404);
  const status = await GET(new NextRequest(`https://www.longboardai.com/api/chat/clarity?conversation=${CONVO}`));
  expect(status.status).toBe(404);
  expect(m.transform).not.toHaveBeenCalled();
});

it("rejects cross-origin, oversized, empty and invalid requests before review", async () => {
  expect((await transform(post({ conversationId: CONVO, draft: "hi" }, "https://evil.example"))).status).toBe(403);
  expect((await transform(post("x".repeat(13_000)))).status).toBe(413);
  expect((await transform(post({ conversationId: CONVO, draft: "  " }))).status).toBe(400);
  expect((await transform(post({ conversationId: CONVO, draft: "x".repeat(2001) }))).status).toBe(400);
  expect((await transform(post({ conversationId: CONVO, draft: "hi", variant: -1 }))).status).toBe(400);
  m.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
  expect((await transform(post({ conversationId: CONVO, draft: "hi" }))).status).toBe(401);
  expect(m.transform).not.toHaveBeenCalled();
});

it("returns a safe error when the review fails, never a partial suggestion", async () => {
  m.transform.mockRejectedValue(new Error("network down with secret details"));
  const response = await transform(post({ conversationId: CONVO, draft: "hi" }));
  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body.result).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("secret");
});

it("reads originals only for the signed-in sender", async () => {
  m.rows = [{ message_id: "m1", original_body: "raw" }];
  const response = await GET(new NextRequest(`https://www.longboardai.com/api/chat/clarity?conversation=${CONVO}`));
  expect(await response.json()).toMatchObject({ enabled: true, originals: m.rows });
  expect(m.calls).toContainEqual(["chat_clarity_drafts", "eq", "sender_member_id", "rob-member"]);
  expect(m.calls).toContainEqual(["chat_clarity_drafts", "eq", "conversation_id", CONVO]);
});
