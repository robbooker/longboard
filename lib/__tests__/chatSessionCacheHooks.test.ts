import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
// #489: the routes that end a sign-in or change a profile clear the 30-second cache.
const m = vi.hoisted(() => ({
  forgetSession: vi.fn(),
  forgetUser: vi.fn(),
  forgetMember: vi.fn(),
  forgetAll: vi.fn(),
  chatAuth: vi.fn(),
  admin: vi.fn(),
  rpc: vi.fn(),
  update: vi.fn(),
  ban: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock("@/lib/chatSessionCache", async (original) => ({
  ...(await original<typeof import("@/lib/chatSessionCache")>()),
  forgetChatSession: m.forgetSession,
  forgetChatUser: m.forgetUser,
  forgetChatMember: m.forgetMember,
  forgetAllChatSessions: m.forgetAll,
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.chatAuth }));
vi.mock("@/lib/auth", () => ({ requireAdmin: m.admin }));
vi.mock("@/lib/chatAdmin", () => ({
  requestOriginAllowed: () => true,
  createChatAdminClient: () => ({
    rpc: m.rpc,
    from: () => ({ update: () => ({ eq: m.update }) }),
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { admin: { updateUserById: m.ban, deleteUser: m.deleteUser } },
    from: () => ({ delete: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}));
import { POST as logout } from "@/app/api/chat/login/logout/route";
import { POST as suspend } from "@/app/api/admin/users/[id]/suspension/route";
import { DELETE as removeUser } from "@/app/api/admin/users/[id]/route";
import { POST as member } from "@/app/api/chat/member/route";
import { chatSecretHash } from "@/lib/chatLoginProof";
import { CHAT_SESSION_COOKIE } from "@/lib/chatLoginConfig";

const account = "00000000-0000-4000-8000-000000000001";
const target = "00000000-0000-4000-8000-000000000009";
const post = (url: string, body?: unknown, cookie?: string) =>
  new NextRequest(`https://longboard.test${url}`, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: cookie ? { cookie } : {},
  });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  m.admin.mockResolvedValue({ ok: true, user: { id: account, role: "admin" } });
  m.chatAuth.mockResolvedValue({ ok: true, user: { id: account } });
  m.update.mockResolvedValue({ error: null });
  m.ban.mockResolvedValue({ data: { user: { banned_until: "2126-01-01" } }, error: null });
  m.deleteUser.mockResolvedValue({ error: null });
  m.rpc.mockResolvedValue({ data: { id: target, display_name: "Alice Baker", accepts_requests: true }, error: null });
});

it("chat sign-out clears that session by its hash, after revoking it", async () => {
  const token = "t".repeat(43);
  expect((await logout(post("/api/chat/login/logout", undefined, `${CHAT_SESSION_COOKIE}=${token}`))).status).toBe(200);
  expect(m.forgetSession).toHaveBeenCalledWith(chatSecretHash(token));
  expect(m.forgetSession.mock.calls.flat()).not.toContain(token);
});
it("a failed sign-out revoke leaves the cache alone (the session is still live)", async () => {
  m.update.mockResolvedValue({ error: { message: "down" } });
  await logout(post("/api/chat/login/logout", undefined, `${CHAT_SESSION_COOKIE}=${"t".repeat(43)}`));
  expect(m.forgetSession).not.toHaveBeenCalled();
});
it("a suspension (ban) clears the person's cached sign-ins", async () => {
  const response = await suspend(post(`/api/admin/users/${target}/suspension`, { suspended: true }), {
    params: Promise.resolve({ id: target }),
  });
  expect(response.status).toBe(200);
  expect(m.forgetUser).toHaveBeenCalledWith(target);
});
it("deleting a user clears their cached sign-ins", async () => {
  await removeUser(new NextRequest(`https://longboard.test/api/admin/users/${target}`, { method: "DELETE" }), {
    params: Promise.resolve({ id: target }),
  });
  expect(m.forgetUser).toHaveBeenCalledWith(target);
});
it("a rename clears the cached member row, and a refused one doesn't", async () => {
  expect((await member(post("/api/chat/member", { action: "rename", displayName: "Alice Baker" }))).status).toBe(200);
  expect(m.forgetUser).toHaveBeenCalledWith(account);
  m.forgetUser.mockClear();
  m.rpc.mockResolvedValue({ error: { message: "member_required" } });
  await member(post("/api/chat/member", { action: "rename", displayName: "Alice Baker" }));
  expect(m.forgetUser).not.toHaveBeenCalled();
});
