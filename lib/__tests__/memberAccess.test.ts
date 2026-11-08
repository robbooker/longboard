import { beforeEach, describe, expect, it, vi } from "vitest";
// #384: the one access check, and how it reaches the Gainers room, the Gainers Table and the News
// Feed. A small model of the request-context functions and the entitlement reads.
const m = vi.hoisted(() => ({
  claims: vi.fn(),
  cookie: vi.fn(),
  rpc: vi.fn(),
  contexts: {} as Record<string, unknown>,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: m.claims } }) }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({
    rpc: (...args: unknown[]) => {
      const result = m.rpc(...args);
      return Object.assign(result, { abortSignal: () => result });
    },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: m.cookie }), headers: async () => ({ get: () => null }) }));
vi.mock("@/lib/chatNewsPolygon", () => ({ NEWS_TICKERS: 15, readNewsSources: async () => ({ okReads: 1, gainerArticles: [], marketArticles: [], partial: false }) }));
import { allowedChatRooms, canAccessChatRoom, canWriteChatRoom, type ChatEntitlements } from "@/lib/chatAccess";
import { requireChatUser } from "@/lib/chatAuth";
import { accessHasEntitlement, hasEntitlement, memberEntitlements, memberKeys, normalizeEmail } from "@/lib/memberAccess";
import { GET as gainersTable } from "@/app/api/chat/gainers/table/route";
import { GET as newsFeed } from "@/app/api/chat/news/feed/route";
import { NextRequest } from "next/server";

const club = "00000000-0000-4000-8000-0000000000c1";
const lb = "00000000-0000-4000-8000-000000000001";
const ok = (data: unknown) => Promise.resolve({ data, error: null });
beforeEach(() => {
  vi.clearAllMocks();
  m.claims.mockResolvedValue({ data: null, error: { message: "signed out" } });
  m.cookie.mockReturnValue({ value: "c".repeat(43) });
  m.contexts = {
    session: { mode: "ok", account: club, longboard: false, role: null, boardroom: false, shortscout: { mode: "absent" }, member: ["club-room", "gainers", "reader"] },
  };
  m.rpc.mockImplementation((fn: string, args: Record<string, string>) => {
    if (fn === "chat_session_request_context") return ok(m.contexts.session);
    if (fn === "chat_longboard_request_context") return ok(m.contexts.longboard);
    if (fn === "chat_gainers_table") return ok([]);
    if (fn === "member_account_entitlements") return ok(args.p_account === club ? ["gainers", "reader", "bogus key!"] : []);
    if (fn === "member_email_entitlements") return ok(args.p_email === "buyer@example.test" ? ["gainers"] : []);
    return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
  });
});
const base: ChatEntitlements = { longboard: false, shortscout: false, shortscoutMember: false, admin: false };

describe("rooms", () => {
  it("a 'gainers' entitlement opens Gainers and nothing else; it stays read-only", () => {
    const access = { ...base, member: ["gainers", "reader", "club-room"] };
    expect(allowedChatRooms(access)).toEqual(["gainers"]);
    expect(canWriteChatRoom(access, "gainers")).toBe(false);
    expect(allowedChatRooms({ ...base, member: ["reader"] })).toEqual([]);
    expect(allowedChatRooms(base)).toEqual([]);
  });
  it("existing members keep exactly the rooms they had, with or without entitlements", () => {
    for (const access of [
      { ...base, longboard: true },
      { ...base, longboard: true, boardroom: true },
      { ...base, shortscout: true, shortscoutMember: true },
      { ...base, shortscoutMember: true },
      { ...base, longboard: true, admin: true },
    ]) {
      const before = allowedChatRooms(access);
      expect(allowedChatRooms({ ...access, member: ["gainers", "reader"] })).toEqual(before);
      expect(before).toContain("gainers");
    }
  });
  it("a bot never gets rooms from entitlements", () => {
    expect(allowedChatRooms({ ...base, botRooms: ["developers"], member: ["gainers"] })).toEqual(["developers"]);
    expect(accessHasEntitlement({ botRooms: ["developers"], member: ["gainers"] }, "gainers")).toBe(false);
  });
});

describe("sign-in", () => {
  it("a club sign-in session gets only its entitlements: no Longboard, ShortScout or admin", async () => {
    const auth = await requireChatUser();
    expect(auth).toEqual({
      ok: true,
      user: { id: club, email: "", role: "user" },
      access: { boardroom: false, longboard: false, shortscout: false, shortscoutMember: false, admin: false, member: ["club-room", "gainers", "reader"] },
      serverSession: true,
    });
    if (!auth.ok) throw new Error("expected ok");
    expect(allowedChatRooms(auth.access)).toEqual(["gainers"]);
    expect(accessHasEntitlement(auth.access, "reader")).toBe(true);
    expect(accessHasEntitlement(auth.access, "admin")).toBe(false);
  });
  it("without an active entitlement a club session is signed out, as before", async () => {
    (m.contexts.session as { member: string[] }).member = [];
    expect(await requireChatUser()).toMatchObject({ ok: false, status: 401 });
  });
  it("a session that claims a Longboard link or a ShortScout binding doesn't take the club path", async () => {
    m.contexts.session = { ...(m.contexts.session as object), longboard: true, role: "admin" };
    expect(await requireChatUser()).toMatchObject({ ok: false, status: 401 });
    m.contexts.session = { ...(m.contexts.session as object), longboard: false, shortscout: { mode: "invalid" } };
    expect(await requireChatUser()).toMatchObject({ ok: false, status: 401 });
  });
  it("a Longboard member who bought keeps their access and gains the keys", async () => {
    m.claims.mockResolvedValue({ data: { claims: { sub: lb, session_id: "s" } }, error: null });
    m.contexts.longboard = { mode: "ok", user: { id: lb, email: "lb@example.test", role: "user" }, boardroom: true, shortscout: { mode: "absent" }, member: ["reader"] };
    const auth = await requireChatUser();
    expect(auth).toMatchObject({ ok: true, access: { longboard: true, boardroom: true, member: ["reader"] } });
    // No keys: the access object is exactly as it was before #384.
    m.contexts.longboard = { ...(m.contexts.longboard as object), member: [] };
    const plain = await requireChatUser();
    expect(plain.ok && "member" in plain.access).toBe(false);
  });
});

describe("Gainers Table and News Feed", () => {
  const get = (path: string) => new NextRequest(`https://chat.robbooker.com${path}`);
  it("open for a club member, closed without the entitlement", async () => {
    expect((await gainersTable(get("/api/chat/gainers/table"))).status).toBe(200);
    expect((await newsFeed(get("/api/chat/news/feed"))).status).toBe(200);
    (m.contexts.session as { member: string[] }).member = ["reader"];
    expect((await gainersTable(get("/api/chat/gainers/table"))).status).toBe(403);
    expect((await newsFeed(get("/api/chat/news/feed"))).status).toBe(403);
  });
});

describe("memberAccess API", () => {
  it("reads keys by account id or email and drops anything malformed", async () => {
    expect([...(await memberEntitlements(club))]).toEqual(["gainers", "reader"]);
    expect(await hasEntitlement(club, "reader")).toBe(true);
    expect(await hasEntitlement(club, "club-room")).toBe(false);
    expect(await hasEntitlement(" Buyer@Example.test", "gainers")).toBe(true);
    expect(m.rpc).toHaveBeenCalledWith("member_email_entitlements", { p_email: "buyer@example.test" });
    expect((await memberEntitlements("not-an-id")).size).toBe(0);
    m.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "down" } }));
    expect(await hasEntitlement(club, "gainers")).toBe(false);
  });
  it("normalizes emails and keys", () => {
    expect(normalizeEmail("  A.B@Example.COM ")).toBe("a.b@example.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(memberKeys(["reader", "gainers", "reader", 4, "Bad"])).toEqual(["gainers", "reader"]);
    expect(memberKeys(null)).toEqual([]);
  });
});
