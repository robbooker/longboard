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
  removeViewer: vi.fn(),
  removeMembers: vi.fn(),
  removePerson: vi.fn(),
  memberIdOf: vi.fn(),
  profileUpdate: vi.fn(),
  tagDelete: vi.fn(),
  entitlementRevoke: vi.fn(),
}));
// #522: the same routes (and the role, tag, unlink and entitlement ones) also end the person's live video.
vi.mock("@/lib/chatStageRemove", () => ({
  removeStageViewerAfterResponse: m.removeViewer,
  removeStageMembersAfterResponse: m.removeMembers,
  removeStagePersonAfterResponse: m.removePerson,
  stageMemberIdOf: m.memberIdOf,
}));
vi.mock("@/lib/chatSessionCache", async (original) => ({
  ...(await original<typeof import("@/lib/chatSessionCache")>()),
  forgetChatSession: m.forgetSession,
  forgetChatUser: m.forgetUser,
  forgetChatMember: m.forgetMember,
  forgetAllChatSessions: m.forgetAll,
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.chatAuth }));
vi.mock("@/lib/auth", () => ({ requireAdmin: m.admin, getCurrentUser: m.admin }));
vi.mock("@/lib/chatAdmin", () => ({
  requestOriginAllowed: () => true,
  createChatAdminClient: () => ({
    rpc: m.rpc,
    from: (table: string) =>
      table === "member_entitlements"
        ? { update: () => ({ eq: () => ({ is: () => ({ select: m.entitlementRevoke }) }) }) }
        : { update: () => ({ eq: m.update }) },
  }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { admin: { updateUserById: m.ban, deleteUser: m.deleteUser } },
    from: (table: string) =>
      table === "profiles"
        ? { delete: () => ({ eq: async () => ({ error: null }) }), update: () => ({ eq: () => ({ select: () => ({ single: m.profileUpdate }) }) }) }
        : { delete: () => ({ eq: () => ({ eq: m.tagDelete }) }) },
  }),
}));
import { POST as logout } from "@/app/api/chat/login/logout/route";
import { POST as suspend } from "@/app/api/admin/users/[id]/suspension/route";
import { DELETE as removeUser } from "@/app/api/admin/users/[id]/route";
import { POST as member } from "@/app/api/chat/member/route";
import { POST as role } from "@/app/api/admin/users/[id]/role/route";
import { DELETE as removeTag } from "@/app/api/admin/users/[id]/tags/[tag]/route";
import { POST as unlink } from "@/app/api/chat/login/unlink/route";
import { PATCH as entitlements } from "@/app/api/admin/members/entitlements/route";
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
  m.memberIdOf.mockResolvedValue("member-target");
  m.profileUpdate.mockResolvedValue({ data: { id: target, email: "t@example.test", role: "user" }, error: null });
  m.tagDelete.mockResolvedValue({ error: null });
  m.entitlementRevoke.mockResolvedValue({ data: [{ id: "e1", person_id: "person-1" }], error: null });
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
  // #522: and they are removed from any live video.
  expect(m.removeViewer).toHaveBeenCalledExactlyOnceWith(target);
});
it("#522: lifting a suspension, and a suspension that failed, remove nobody from live video", async () => {
  await suspend(post(`/api/admin/users/${target}/suspension`, { suspended: false }), { params: Promise.resolve({ id: target }) });
  m.ban.mockResolvedValue({ data: null, error: { message: "down" } });
  const failed = await suspend(post(`/api/admin/users/${target}/suspension`, { suspended: true }), { params: Promise.resolve({ id: target }) });
  expect(failed.status).toBe(500);
  expect(m.removeViewer).not.toHaveBeenCalled();
});
it("#522: an admin made a member again, a removed tag and an unlinked membership each end that person's live video; a promotion does not", async () => {
  const asRole = (next: string) => role(post(`/api/admin/users/${target}/role`, { role: next }), { params: Promise.resolve({ id: target }) });
  expect((await asRole("admin")).status).toBe(200);
  expect(m.removeViewer).not.toHaveBeenCalled();
  expect((await asRole("user")).status).toBe(200);
  expect(m.removeViewer).toHaveBeenCalledExactlyOnceWith(target);
  m.removeViewer.mockClear();
  const untagged = await removeTag(new NextRequest(`https://longboard.test/api/admin/users/${target}/tags/boardroom-cohort-1`, { method: "DELETE" }), {
    params: Promise.resolve({ id: target, tag: "boardroom-cohort-1" }),
  });
  expect(untagged.status).toBe(200);
  expect(m.removeViewer).toHaveBeenCalledExactlyOnceWith(target);
  m.removeViewer.mockClear();
  m.rpc.mockResolvedValue({ error: null });
  expect((await unlink(post("/api/chat/login/unlink"))).status).toBe(200);
  expect(m.removeViewer).toHaveBeenCalledExactlyOnceWith(account);
});
it("#522: revoking an entitlement ends the live video of whoever held it; a revoke that found nothing does not", async () => {
  const revoke = () =>
    entitlements(new NextRequest("https://longboard.test/api/admin/members/entitlements", { method: "PATCH", body: JSON.stringify({ action: "revoke", id: "00000000-0000-4000-8000-0000000000e1" }) }));
  expect((await revoke()).status).toBe(200);
  expect(m.removePerson).toHaveBeenCalledExactlyOnceWith("person-1");
  m.removePerson.mockClear();
  m.entitlementRevoke.mockResolvedValue({ data: [], error: null });
  expect((await revoke()).status).toBe(404);
  expect(m.removePerson).not.toHaveBeenCalled();
});
it("deleting a user clears their cached sign-ins", async () => {
  await removeUser(new NextRequest(`https://longboard.test/api/admin/users/${target}`, { method: "DELETE" }), {
    params: Promise.resolve({ id: target }),
  });
  expect(m.forgetUser).toHaveBeenCalledWith(target);
  // #522: who they were in chat is read BEFORE the account goes, and that member is removed from live video after.
  expect(m.memberIdOf).toHaveBeenCalledExactlyOnceWith(target);
  expect(m.memberIdOf.mock.invocationCallOrder[0]).toBeLessThan(m.deleteUser.mock.invocationCallOrder[0]);
  expect(m.removeMembers).toHaveBeenCalledExactlyOnceWith(["member-target"]);
});
it("a rename clears the cached member row, and a refused one doesn't", async () => {
  expect((await member(post("/api/chat/member", { action: "rename", displayName: "Alice Baker" }))).status).toBe(200);
  expect(m.forgetUser).toHaveBeenCalledWith(account);
  m.forgetUser.mockClear();
  m.rpc.mockResolvedValue({ error: { message: "member_required" } });
  await member(post("/api/chat/member", { action: "rename", displayName: "Alice Baker" }));
  expect(m.forgetUser).not.toHaveBeenCalled();
});
