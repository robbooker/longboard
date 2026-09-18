import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/chatAdmin", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/chatAdmin")>(),
  createChatAdminClient: () => ({ rpc: mock.rpc }),
}));
import { POST } from "@/app/api/chat/message/route";
const id = "00000000-0000-4000-8000-000000000099";
const request = (overrides = {}, origin = "https://www.longboardai.com") => new NextRequest("https://www.longboardai.com/api/chat/message", {
  method: "POST", headers: { origin, host: "www.longboardai.com", "Content-Type": "application/json" },
  body: JSON.stringify({ action: "edit", room: "main", messageId: id, body: "Updated", expectedBody: "Original", ...overrides }),
});
beforeEach(() => {
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ ok: true, user: { id: "trusted-account", role: "user" }, access: { longboard: true, boardroom: true, shortscout: false, admin: false } });
  mock.rpc.mockResolvedValue({ data: { id, body: "Updated" }, error: null });
});
describe("message action HTTP boundaries", () => {
  it("uses the authenticated actor and role, ignoring spoofed fields", async () => {
    expect((await POST(request({ p_actor: "victim", p_admin: true, admin: true }))).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("change_chat_message", expect.objectContaining({ p_actor: "trusted-account", p_admin: false, p_expected_body: "Original" }));
  });
  it("rejects foreign origins before authentication", async () => {
    expect((await POST(request({}, "https://evil.example"))).status).toBe(403);
    expect(mock.auth).not.toHaveBeenCalled();
  });
  it("requires login", async () => {
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    expect((await POST(request())).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("rejects rooms outside membership access", async () => {
    expect((await POST(request({ room: "shortscout" }))).status).toBe(403);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([{ body: " " }, { body: "a".repeat(601) }, { expectedBody: null }, { messageId: "bad-id" }, { action: "admin_delete" }])("rejects invalid input %j", async overrides => {
    expect((await POST(request(overrides))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([["message_changed", 409], ["message_forbidden", 403], ["message_not_found", 404], ["chat_paused", 423]])("reports %s correctly", async (message, status) => {
    mock.rpc.mockResolvedValue({ data: null, error: { message } });
    expect((await POST(request())).status).toBe(status);
  });
  it("does not expose internal database errors", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "internal connection details" } });
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "message_update_failed" });
  });
});
