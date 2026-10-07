import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/chatAdmin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chatAdmin")>()),
  createChatAdminClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("@/lib/chatMembershipProjection", () => ({ withMessageMemberships: async (_db: unknown, rows: unknown[]) => rows }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: mock.publish }));
import { POST } from "@/app/api/chat/message/route";
const id = "00000000-0000-4000-8000-000000000099";
const request = (body: Record<string, unknown>) =>
  new NextRequest("https://www.longboardai.com/api/chat/message", {
    method: "POST",
    headers: { origin: "https://www.longboardai.com", host: "www.longboardai.com", "Content-Type": "application/json" },
    body: JSON.stringify({ room: "main", messageId: id, ...body }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ ok: true, user: { id: "acct", role: "user" }, access: { longboard: true, boardroom: true, shortscout: false, admin: false } });
});

it("publishes the edited row so other windows update without a reload", async () => {
  mock.rpc.mockResolvedValue({ data: { id, body: "Updated", revision: 2 }, error: null });
  await POST(request({ action: "edit", body: "Updated", expectedBody: "Original" }));
  expect(mock.publish).toHaveBeenCalledWith("main", { kind: "message", eventType: "UPDATE", row: { id, body: "Updated", revision: 2 } });
});

it("publishes a delete's tombstone row, or a reload signal when none comes back", async () => {
  mock.rpc.mockResolvedValue({ data: { deletedId: id, message: { id, deleted_at: "now", removed: true } }, error: null });
  await POST(request({ action: "delete" }));
  expect(mock.publish).toHaveBeenLastCalledWith("main", { kind: "message", eventType: "UPDATE", row: { id, deleted_at: "now", removed: true } });
  mock.rpc.mockResolvedValue({ data: { deletedId: id, message: null }, error: null });
  await POST(request({ action: "delete" }));
  expect(mock.publish).toHaveBeenLastCalledWith("main", { kind: "changed", topics: ["history", "room"] });
});
