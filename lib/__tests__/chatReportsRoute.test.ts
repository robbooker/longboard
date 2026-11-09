import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// #354: the chat's report review works from the chat's own sign-in, on either host.
const m = vi.hoisted(() => ({ auth: vi.fn(), owner: vi.fn(), adminRequired: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.auth }));
vi.mock("@/lib/auth", () => ({ requireAdmin: m.adminRequired }));
vi.mock("@/lib/chatAdmin", () => ({ requireChatOwner: m.owner }));
import { GET } from "@/app/api/chat/reports/route";

const id = "00000000-0000-4000-8000-000000000001";
const req = () => new NextRequest("https://chat.robbooker.com/api/chat/reports");
const signedIn = (role: "user" | "admin", serverSession: boolean) =>
  m.auth.mockResolvedValue({ ok: true, serverSession, user: { id, email: "", role }, access: { admin: role === "admin" } });
const reports = [{ id: "r1", reason: "spam", created_at: "2026-11-01T00:00:00Z" }];

beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: () => query, order: () => query, limit: async () => ({ data: reports, error: null }) };
  m.owner.mockImplementation(async (_req: unknown, verified: { user: { id: string } }) => ({
    ok: true,
    user: verified.user,
    admin: { from: () => query },
  }));
});

it.each([true, false])("an admin signed in by chat session (%s) or Longboard sees reports", async (serverSession) => {
  signedIn("admin", serverSession);
  const response = await GET(req());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reports });
  expect(m.owner).toHaveBeenCalledWith(expect.anything(), { ok: true, user: { id, email: "", role: "admin" } });
  // It never falls back to the Longboard-only cookie check.
  expect(m.adminRequired).not.toHaveBeenCalled();
});

it("a regular member gets no reports on either sign-in path", async () => {
  for (const serverSession of [true, false]) {
    signedIn("user", serverSession);
    const response = await GET(req());
    expect(response.status).toBe(403);
  }
  expect(m.owner).not.toHaveBeenCalled();
});

it("a signed-out request is refused", async () => {
  m.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
  expect((await GET(req())).status).toBe(401);
  expect(m.owner).not.toHaveBeenCalled();
});

it("an admin who is not a chat owner still gets the owner refusal", async () => {
  signedIn("admin", true);
  m.owner.mockResolvedValue({ ok: false, status: 403, error: "chat_owner_only" });
  const response = await GET(req());
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "chat_owner_only" });
});
