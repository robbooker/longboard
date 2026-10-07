import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), save: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.auth }));
vi.mock("@/lib/clarity/drafts", () => ({ saveClarityDraft: m.save }));
vi.mock("@/lib/chatMembershipProjection", () => ({ withMessageMemberships: async (_db: unknown, rows: unknown[]) => rows }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({ rpc: m.rpc }),
  requestOriginAllowed: () => true,
}));
import { POST } from "@/app/api/chat/inbox/route";
const actor = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000002";
const clientId = "00000000-0000-4000-8000-000000000003";
const clarity = { original: "raw draft", suggested: "clear", intent: "i", whyChanged: "w", ambiguityNote: null, usedSuggestion: true };
const send = (extra = {}) =>
  POST(
    new NextRequest("https://longboard.test/api/chat/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "send", target, body: "clear", clientId, ...extra }),
    }),
  );
const message = { id: "m1", seq: 9, sender_id: "rob", client_id: clientId, body: "clear" };
beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ ok: true, access: {}, user: { id: actor, email: "", role: "user" } });
  m.rpc.mockResolvedValue({ data: { message }, error: null });
  m.save.mockResolvedValue(true);
});

it("stores review metadata after a successful send, and never returns it", async () => {
  const response = await send({ clarity });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(m.save).toHaveBeenCalledWith(expect.anything(), actor, target, message, clarity);
  // The DM write receives only the final text; review metadata never enters the message.
  expect(m.rpc).toHaveBeenCalledWith("send_chat_dm_ack", expect.objectContaining({ p_body: "clear" }));
  expect(JSON.stringify(m.rpc.mock.calls)).not.toContain("raw draft");
  expect(JSON.stringify(body)).not.toContain("raw draft");
});

it("stores nothing when the send fails or carries no review", async () => {
  m.rpc.mockResolvedValue({ data: null, error: { message: "dm_rate_limited" } });
  expect((await send({ clarity })).status).not.toBe(200);
  m.rpc.mockResolvedValue({ data: { message }, error: null });
  await send();
  expect(m.save).not.toHaveBeenCalled();
});

it("keeps the send successful even if saving the private record fails", async () => {
  m.save.mockRejectedValue(new Error("db down"));
  const response = await send({ clarity });
  expect(response.status).toBe(200);
  expect((await response.json()).message.id).toBe("m1");
});
