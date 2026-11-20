import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
import { GET } from "@/app/api/chat/trading-desk/route";
import { CHAT_OWNER_ENV, chatOwnerAccountId, isChatOwner } from "@/lib/chatOwner";
import { chatAppsFor } from "@/lib/chatApps.server";

// #468 The Trading Desk is Rob's alone: the configured owner account's own browser sign-in.
const ROB = "77a2d10f-0000-4000-8000-0000000000aa";
const JAMMIE = "6ad10d99-0000-4000-8000-0000000000bb";
const admin = { longboard: true, boardroom: true, shortscout: false, admin: true };
const member = { longboard: true, boardroom: true, shortscout: false, admin: false };
const rob = { ok: true as const, user: { id: ROB, email: "rob@example.test", role: "admin" as const }, access: admin, serverSession: false };
const env = { [CHAT_OWNER_ENV]: ROB };

describe("#468 owner rule", () => {
  it("reads the owner account id, and fails closed when it is missing or malformed", () => {
    expect(chatOwnerAccountId(env)).toBe(ROB);
    expect(chatOwnerAccountId({ [CHAT_OWNER_ENV]: `  ${ROB.toUpperCase()} ` })).toBe(ROB);
    expect(chatOwnerAccountId({})).toBeNull();
    expect(chatOwnerAccountId({ [CHAT_OWNER_ENV]: "" })).toBeNull();
    expect(chatOwnerAccountId({ [CHAT_OWNER_ENV]: "rob" })).toBeNull();
    expect(chatOwnerAccountId({ [CHAT_OWNER_ENV]: `${ROB},${JAMMIE}` })).toBeNull();
    expect(isChatOwner(rob, {})).toBe(false);
  });

  it("is the owner's own signed-in browser only", () => {
    expect(isChatOwner(rob, env)).toBe(true);
    expect(isChatOwner({ ...rob, user: { id: ROB.toUpperCase() } }, env)).toBe(true);
  });

  it("refuses other admins (including chat control owners), members, bots and tokens", () => {
    expect(isChatOwner({ ...rob, user: { id: JAMMIE } }, env)).toBe(false);
    expect(isChatOwner({ ...rob, access: member }, env)).toBe(false);
    expect(isChatOwner({ ...rob, access: { ...admin, botRooms: ["social"] } }, env)).toBe(false);
    expect(isChatOwner({ ...rob, apiToken: true }, env)).toBe(false);
    expect(isChatOwner({ ...rob, agent: { id: "agent-1" } }, env)).toBe(false);
  });
});

describe("#468 Trading Desk in Apps and its route", () => {
  beforeEach(() => vi.stubEnv(CHAT_OWNER_ENV, ROB));
  afterEach(() => {
    vi.unstubAllEnvs();
    auth.mockReset();
  });

  it("lists the Trading Desk in Apps for the owner only", async () => {
    expect(await chatAppsFor(rob)).toEqual(["reader", "trading-desk"]);
    expect(await chatAppsFor({ ...rob, user: { id: JAMMIE } })).toEqual(["reader"]);
    expect(await chatAppsFor({ user: { id: "acct-member" }, access: member })).toEqual(["reader"]);
    expect(await chatAppsFor({ ...rob, apiToken: true })).toEqual(["reader"]);
    expect(await chatAppsFor({ ...rob, access: { ...admin, botRooms: ["social"] } })).toEqual([]);
    vi.stubEnv(CHAT_OWNER_ENV, "");
    expect(await chatAppsFor(rob)).toEqual(["reader"]);
  });

  it("serves the desk to the owner, read-only and not cached", async () => {
    auth.mockResolvedValue(rob);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.desk.sample).toBe(true);
    expect(body.desk.positions.length).toBeGreaterThan(0);
    expect(typeof body.serverNow).toBe("string");
  });

  it("answers everyone else with the same 404 as an unknown address", async () => {
    for (const who of [
      { ok: false, status: 401, error: "unauthenticated" },
      { ...rob, user: { ...rob.user, id: JAMMIE } },
      { ok: true, user: { id: "acct-member", email: "", role: "user" }, access: member, serverSession: false },
      { ...rob, apiToken: true },
      { ...rob, agent: { id: "agent-1" } },
      { ...rob, access: { ...admin, botRooms: ["social"] } },
    ]) {
      auth.mockResolvedValue(who);
      const response = await GET();
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });
});
