import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_SESSION_CACHE_TTL_MS,
  chatSignInSessionKey,
  createSessionCache,
  forgetAllChatSessions,
  forgetChatMember,
  forgetChatSession,
  forgetChatUser,
  longboardSessionKey,
} from "../chatSessionCache";
import { createRequestContextReader } from "../chatRequestContext";
import { createMemberCache } from "../chatMembers";

// #489: the 30-second chat sign-in cache. vitest.setup.ts turns the shared caches off; every cache
// here is made with enabled: () => true and its own clock.
let clock = 1_000_000;
const now = () => clock;
const on = () => true;
beforeEach(() => {
  clock = 1_000_000;
});

type Admin = Parameters<ReturnType<typeof createRequestContextReader>["longboard"]>[0];
const admin = (rpc: (...args: unknown[]) => Promise<unknown>) =>
  ({
    rpc: (...args: unknown[]) => {
      const result = rpc(...args);
      return Object.assign(result, { abortSignal: () => result });
    },
  }) as unknown as Admin;
const ready = { mode: "ready", decision: "allow", level: "mastermind", binding: { subject: "ss", bridged: false } };
const lbOk = (id = "u") => ({ data: { mode: "ok", user: { id, email: `${id}@example.test`, role: "user" }, boardroom: true, shortscout: ready } });
const ssOk = (account = "a") => ({ data: { mode: "ok", account, longboard: false, role: null, boardroom: false, shortscout: ready } });
const reader = () => createRequestContextReader({ cache: createSessionCache({ now, enabled: on }) });

describe("the cache itself", () => {
  it("keeps a value for the TTL, then forgets it", () => {
    const cache = createSessionCache<{ n: number }>({ now, enabled: on });
    cache.set("k", { n: 1 }, [], cache.epoch());
    expect(cache.get("k")).toEqual({ n: 1 });
    clock += CHAT_SESSION_CACHE_TTL_MS - 1;
    expect(cache.get("k")).toEqual({ n: 1 });
    clock += 1;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size).toBe(0);
  });
  it("hands out copies, so one request can't change what the next one sees", () => {
    const cache = createSessionCache<{ user: { role: string } }>({ now, enabled: on });
    cache.set("k", { user: { role: "user" } }, [], cache.epoch());
    cache.get("k")!.user.role = "admin";
    expect(cache.get("k")).toEqual({ user: { role: "user" } });
  });
  it("is capped in size, dropping the oldest first", () => {
    const cache = createSessionCache<number>({ now, enabled: on, maxEntries: 3 });
    for (const n of [1, 2, 3, 4]) cache.set(`k${n}`, n, [], cache.epoch());
    expect(cache.size).toBe(3);
    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("k4")).toBe(4);
  });
  it("never stores a read that started before an invalidation", () => {
    const cache = createSessionCache<number>({ now, enabled: on });
    const started = cache.epoch();
    cache.invalidateTag("user:u");
    cache.set("k", 1, ["user:u"], started);
    expect(cache.get("k")).toBeUndefined();
  });
  it("stores and serves nothing while turned off", () => {
    const cache = createSessionCache<number>({ now, enabled: () => false });
    cache.set("k", 1, [], cache.epoch());
    expect(cache.get("k")).toBeUndefined();
  });
  it("keys are SHA-256 hashes, never the raw token or session", () => {
    const token = "s".repeat(43);
    for (const key of [chatSignInSessionKey(token), longboardSessionKey("user-id", "session-id")]) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain("session-id");
      expect(key).not.toContain(token.slice(0, 8));
    }
    expect(longboardSessionKey("u", "s1")).not.toBe(longboardSessionKey("u", "s2"));
    // The parts are separated, so "ab"+"c" and "a"+"bc" are different sign-ins.
    expect(longboardSessionKey("ab", "c")).not.toBe(longboardSessionKey("a", "bc"));
  });
});

describe("the sign-in context check", () => {
  it("a second request within 30 seconds uses the kept answer; after that it asks again", async () => {
    const rpc = vi.fn().mockResolvedValue(lbOk());
    const read = reader();
    expect(await read.longboard(admin(rpc), "u", "s")).toMatchObject({ mode: "ok", user: { id: "u" } });
    expect(await read.longboard(admin(rpc), "u", "s")).toMatchObject({ mode: "ok", user: { id: "u" } });
    expect(rpc).toHaveBeenCalledTimes(1);
    clock += CHAT_SESSION_CACHE_TTL_MS;
    await read.longboard(admin(rpc), "u", "s");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("the same for a chat sign-in session", async () => {
    const rpc = vi.fn().mockResolvedValue(ssOk());
    const read = reader();
    await read.session(admin(rpc), "hash");
    expect(await read.session(admin(rpc), "hash")).toMatchObject({ mode: "ok", account: "a" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("different sessions never share an answer", async () => {
    const rpc = vi.fn().mockImplementation(async (_fn: string, args: Record<string, string>) =>
      args.p_user ? lbOk(args.p_user) : ssOk(args.p_token_hash),
    );
    const read = reader();
    await read.longboard(admin(rpc), "u", "s1");
    await read.longboard(admin(rpc), "u", "s2");
    expect(await read.longboard(admin(rpc), "v", "s1")).toMatchObject({ user: { id: "v" } });
    expect(await read.session(admin(rpc), "h1")).toMatchObject({ account: "h1" });
    expect(await read.session(admin(rpc), "h2")).toMatchObject({ account: "h2" });
    expect(rpc).toHaveBeenCalledTimes(5);
  });
  it("never keeps a refusal or a failure, so someone who just signed in gets in at once", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { mode: "unauthenticated" } })
      .mockResolvedValueOnce({ data: { mode: "no_profile" } })
      .mockResolvedValueOnce({ error: { message: "down" } })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ data: { ...lbOk().data, shortscout: { mode: "invalid" } } })
      .mockResolvedValueOnce({ data: { ...lbOk().data, shortscout: { mode: "unavailable" } } })
      .mockResolvedValue(lbOk());
    const read = reader();
    for (const mode of ["unauthenticated", "no_profile", "unavailable", "unavailable", "ok", "ok"])
      expect(await read.longboard(admin(rpc), "u", "s")).toMatchObject({ mode });
    expect(await read.longboard(admin(rpc), "u", "s")).toMatchObject({ mode: "ok", shortscout: { identity: { membership_level: "mastermind" } } });
    await read.longboard(admin(rpc), "u", "s");
    expect(rpc).toHaveBeenCalledTimes(7);
  });
  it("never keeps a chat sign-in that would be turned away (no paid ShortScout, no club keys)", async () => {
    const unpaid = { ...ssOk().data, shortscout: { ...ready, level: "free" } };
    const rpc = vi.fn().mockResolvedValueOnce({ data: unpaid }).mockResolvedValueOnce({ data: unpaid }).mockResolvedValue(ssOk());
    const read = reader();
    await read.session(admin(rpc), "hash");
    await read.session(admin(rpc), "hash");
    await read.session(admin(rpc), "hash");
    await read.session(admin(rpc), "hash");
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it("keeps a club sign-in whose purchases let it in", async () => {
    const club = { mode: "ok", account: "c", longboard: false, role: null, boardroom: false, shortscout: { mode: "absent" }, member: ["club-room"] };
    const rpc = vi.fn().mockResolvedValue({ data: club });
    const read = reader();
    await read.session(admin(rpc), "hash");
    await read.session(admin(rpc), "hash");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("sign-out clears that chat session only", async () => {
    const rpc = vi.fn().mockImplementation(async (_fn: string, args: Record<string, string>) => ssOk(args.p_token_hash));
    const read = reader();
    await read.session(admin(rpc), "mine");
    await read.session(admin(rpc), "theirs");
    forgetChatSession("mine");
    await read.session(admin(rpc), "mine");
    await read.session(admin(rpc), "theirs");
    expect(rpc.mock.calls.map(([, args]) => args.p_token_hash)).toEqual(["mine", "theirs", "mine"]);
  });
  it("a ban or removal clears every sign-in of that person, on both paths", async () => {
    const rpc = vi.fn().mockImplementation(async (_fn: string, args: Record<string, string>) =>
      args.p_user ? lbOk(args.p_user) : ssOk("U-1"),
    );
    const read = reader();
    await read.longboard(admin(rpc), "U-1", "s1");
    await read.longboard(admin(rpc), "U-1", "s2");
    await read.longboard(admin(rpc), "other", "s3");
    await read.session(admin(rpc), "hash");
    forgetChatUser("u-1");
    await read.longboard(admin(rpc), "U-1", "s1");
    await read.longboard(admin(rpc), "U-1", "s2");
    await read.longboard(admin(rpc), "other", "s3");
    await read.session(admin(rpc), "hash");
    expect(rpc).toHaveBeenCalledTimes(7);
  });
  it("an invalidation while a read is in flight is not undone by that read", async () => {
    let release!: (value: unknown) => void;
    const rpc = vi.fn().mockReturnValueOnce(new Promise((r) => (release = r))).mockResolvedValue({ data: { mode: "unauthenticated" } });
    const read = reader();
    const before = read.longboard(admin(rpc), "u", "s");
    forgetChatUser("u");
    // A request after the ban doesn't join the read that started before it.
    expect(await read.longboard(admin(rpc), "u", "s")).toEqual({ mode: "unauthenticated" });
    release(lbOk());
    expect(await before).toMatchObject({ mode: "ok" });
    expect(await read.longboard(admin(rpc), "u", "s")).toEqual({ mode: "unauthenticated" });
    expect(rpc).toHaveBeenCalledTimes(3);
  });
  it("an entitlement change by email clears everything", async () => {
    const rpc = vi.fn().mockResolvedValue(lbOk());
    const read = reader();
    await read.longboard(admin(rpc), "u", "s");
    forgetAllChatSessions();
    await read.longboard(admin(rpc), "u", "s");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("the member row", () => {
  const memberId = "20000000-0000-4000-8000-000000000001";
  const db = (rows: Record<string, unknown>) => {
    const calls: string[] = [];
    const client = {
      from: () => {
        let user = "";
        const q = {
          select: () => q,
          eq: (_column: string, value: string) => ((user = value), q),
          maybeSingle: async () => (calls.push(user), { data: rows[user] ?? null, error: null }),
        };
        return q;
      },
    };
    return { client: client as never, calls };
  };
  const row = (name: string) => ({ id: memberId, display_name: name, accepts_requests: true, name_revision: 1 });
  const members = () => createMemberCache(createSessionCache({ now, enabled: on }));

  it("is kept per sign-in for 30 seconds and says when it came from the cache", async () => {
    const { client, calls } = db({ u: row("Ada") });
    const find = members();
    expect(await find(client, "u", "key-1")).toEqual({ member: row("Ada"), cached: false });
    expect(await find(client, "u", "key-1")).toEqual({ member: row("Ada"), cached: true });
    clock += CHAT_SESSION_CACHE_TTL_MS;
    expect(await find(client, "u", "key-1")).toEqual({ member: row("Ada"), cached: false });
    expect(calls).toEqual(["u", "u"]);
  });
  it("is never shared between sign-ins or people, and never kept without a sign-in key", async () => {
    const { client, calls } = db({ u: row("Ada"), v: row("Bea") });
    const find = members();
    await find(client, "u", "key-1");
    expect((await find(client, "u", "key-2")).cached).toBe(false);
    expect(await find(client, "v", "key-1")).toMatchObject({ member: { display_name: "Bea" }, cached: false });
    await find(client, "u", undefined);
    await find(client, "u", undefined);
    expect(calls).toHaveLength(5);
  });
  it("never keeps 'no member yet', so a name picked a moment ago shows at once", async () => {
    const rows: Record<string, unknown> = {};
    const { client } = db(rows);
    const find = members();
    expect((await find(client, "u", "key")).member).toBeNull();
    rows.u = row("Ada");
    expect(await find(client, "u", "key")).toEqual({ member: row("Ada"), cached: false });
  });
  it("a profile change clears it: by account (rename, own picture) or by member (an admin's removal)", async () => {
    const rows: Record<string, unknown> = { u: row("Ada") };
    const { client } = db(rows);
    const find = members();
    await find(client, "u", "key");
    rows.u = row("Ada Lovelace");
    forgetChatUser("u");
    expect(await find(client, "u", "key")).toEqual({ member: row("Ada Lovelace"), cached: false });
    rows.u = row("Ada L");
    forgetChatMember(memberId.toUpperCase());
    expect(await find(client, "u", "key")).toEqual({ member: row("Ada L"), cached: false });
  });
  it("a chat sign-out clears that sign-in's row", async () => {
    const { client, calls } = db({ u: row("Ada") });
    const find = members();
    const key = chatSignInSessionKey("tokenhash");
    await find(client, "u", key);
    forgetChatSession("tokenhash");
    await find(client, "u", key);
    expect(calls).toEqual(["u", "u"]);
  });
});
