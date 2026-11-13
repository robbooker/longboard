import { beforeEach, describe, expect, it, vi } from "vitest";
// #450 Agents in chat: the permission intersection, the token checks, the rate limits and the
// back-and-forth limit. The database applies the same rules (scripts/tests/chat-agents-database.mjs).
const m = vi.hoisted(() => ({ rpc: vi.fn(), authorization: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: vi.fn() } }) }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({
    rpc: (...args: unknown[]) => {
      const result = m.rpc(...args);
      return Object.assign(result, { abortSignal: () => result });
    },
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: (name: string) => (name === "authorization" ? m.authorization : null) }),
}));
import { requireChatUser } from "@/lib/chatAuth";
import { canAccessChatRoom, canUseDirectMessages } from "@/lib/chatAccess";
import { chatApiRouteAllowed } from "@/lib/chatApiToken";
import {
  agentPatchOutsideCeiling,
  agentRateLimit,
  agentSendError,
  agentTurnLimitReached,
  chatAgentRouteAllowed,
  CHAT_AGENT_ROUTES,
  effectiveAgentPermissions,
  type AgentCeiling,
  type AgentSettings,
} from "@/lib/chatAgents";
import type { NextRequest } from "next/server";

const ceiling: AgentCeiling = {
  readRooms: ["developers", "agents", "social"],
  postRooms: ["developers", "agents"],
  dm: false,
  react: true,
  thread: true,
  perMinute: 6,
  perDay: 300,
  maxTurns: 6,
};
const open: AgentSettings = {
  readRooms: null,
  postRooms: null,
  dm: false,
  react: true,
  thread: true,
  perMinute: null,
  perDay: null,
};

describe("permission intersection", () => {
  it("follows the ceiling when the owner set nothing", () => {
    expect(effectiveAgentPermissions(ceiling, open)).toEqual({
      readRooms: ["agents", "developers", "social"],
      postRooms: ["agents", "developers"],
      dm: false,
      react: true,
      thread: true,
      perMinute: 6,
      perDay: 300,
      maxTurns: 6,
    });
  });
  it("owner settings only narrow: rooms intersect, switches AND, limits take the lower", () => {
    const eff = effectiveAgentPermissions(ceiling, {
      readRooms: ["developers", "main"],
      postRooms: ["developers", "social"],
      dm: true,
      react: false,
      thread: true,
      perMinute: 20,
      perDay: 50,
    });
    expect(eff.readRooms).toEqual(["developers"]);
    expect(eff.postRooms).toEqual(["developers"]);
    expect(eff.dm).toBe(false);
    expect(eff.react).toBe(false);
    expect(eff.perMinute).toBe(6);
    expect(eff.perDay).toBe(50);
  });
  it("can post only where it can read", () => {
    expect(effectiveAgentPermissions(ceiling, { ...open, readRooms: ["social"] }).postRooms).toEqual([]);
  });
  it("a narrower ceiling narrows an agent at once", () => {
    const narrow = { ...ceiling, postRooms: [], react: false, thread: false, perMinute: 2 };
    const eff = effectiveAgentPermissions(narrow, { ...open, postRooms: ["developers"], perMinute: 5 });
    expect(eff).toMatchObject({ postRooms: [], react: false, thread: false, perMinute: 2 });
  });
  it("refuses settings wider than the ceiling", () => {
    expect(agentPatchOutsideCeiling(ceiling, { postRooms: ["social"] })).toBe("postRooms");
    expect(agentPatchOutsideCeiling(ceiling, { readRooms: ["main"] })).toBe("readRooms");
    expect(agentPatchOutsideCeiling(ceiling, { dm: true })).toBe("dm");
    expect(agentPatchOutsideCeiling(ceiling, { perMinute: 7 })).toBe("perMinute");
    expect(agentPatchOutsideCeiling(ceiling, { perDay: 301 })).toBe("perDay");
    expect(agentPatchOutsideCeiling(ceiling, { postRooms: ["developers"], perMinute: 1, react: false })).toBeNull();
  });
});

describe("rate limits", () => {
  const now = Date.parse("2026-11-12T15:00:00Z");
  const ago = (s: number) => now - s * 1000;
  it("allows up to the per-minute limit", () => {
    expect(agentRateLimit([ago(10), ago(20)], { perMinute: 3, perDay: 300 }, now)).toBeNull();
    expect(agentRateLimit([ago(10), ago(20), ago(59)], { perMinute: 3, perDay: 300 }, now)).toBe("minute");
    expect(agentRateLimit([ago(10), ago(20), ago(61)], { perMinute: 3, perDay: 300 }, now)).toBeNull();
  });
  it("then the per-day limit", () => {
    const day = [ago(100), ago(3600), ago(80_000)];
    expect(agentRateLimit(day, { perMinute: 6, perDay: 3 }, now)).toBe("day");
    expect(agentRateLimit([...day.slice(0, 2), ago(90_000)], { perMinute: 6, perDay: 3 }, now)).toBeNull();
  });
  it("says so in plain words", () => {
    expect(agentSendError("agent_rate_limited", { reason: "minute", limit: 6 })).toMatchObject({
      status: 429,
      message: "This agent can post 6 messages a minute. Wait a moment.",
    });
    expect(agentSendError("agent_rate_limited", { reason: "day", limit: 300 })?.message).toBe(
      "This agent has posted its 300 messages for today.",
    );
    expect(agentSendError("sent")).toBeNull();
  });
});

describe("back-and-forth limit", () => {
  const a = { agentId: "a" },
    b = { agentId: "b" },
    person = { agentId: null };
  it("refuses a 7th agent turn in a row between two agents", () => {
    expect(agentTurnLimitReached([b, a, b, a, b, a], "a", 6, true)).toBe(true);
    expect(agentTurnLimitReached([b, a, b, a, b, a], "a", 6, false)).toBe(true);
  });
  it("allows it with fewer turns, or once a person posted", () => {
    expect(agentTurnLimitReached([b, a, b, a, b], "a", 6, true)).toBe(false);
    expect(agentTurnLimitReached([b, a, person, a, b, a, b], "a", 6, true)).toBe(false);
  });
  it("one agent on its own is held only by its rate limits", () => {
    expect(agentTurnLimitReached([a, a, a, a, a, a, a], "a", 6, false)).toBe(false);
    expect(agentTurnLimitReached([a, a, a, a, a, a], "a", 6, true)).toBe(true);
  });
  it("uses the global setting", () => {
    expect(agentTurnLimitReached([b, a, b], "a", 3, true)).toBe(true);
    expect(agentTurnLimitReached([b, a, b, a, b, a], "a", 10, true)).toBe(false);
  });
});

describe("agent routes", () => {
  it("are a subset of the personal token routes", () => {
    for (const route of CHAT_AGENT_ROUTES) expect(chatApiRouteAllowed(route)).toBe(true);
  });
  it.each([
    "/api/chat/admin",
    "/api/chat/summary",
    "/api/chat/clarity",
    "/api/chat/login",
    "/api/chat/push",
    "/api/chat/api-tokens",
    "/api/chat/agents",
    "/api/chat/agents/admin",
    "/api/chat/inbox",
    "/api/chat/dm-members",
    "/api/chat/member",
    "/api/chat/message",
    "/api/chat/message-pins",
    "/api/chat/mentions",
    "/api/chat/attachments",
    "/api/chat/opening",
    "/api/chat/room-members",
  ])("refuse %s", (path) => expect(chatAgentRouteAllowed(path)).toBe(false));
  it.each(["/api/chat", "/api/chat/history", "/api/chat/thread/", "/api/chat/message-reactions"])("allow %s", (path) =>
    expect(chatAgentRouteAllowed(path)).toBe(true),
  );
});

describe("agent token sign-in", () => {
  const owner = "00000000-0000-4000-8000-000000000002";
  const token = `lbc_${"b".repeat(43)}`;
  const at = (path: string) => ({ nextUrl: { pathname: path } }) as unknown as NextRequest;
  const agent = {
    id: "00000000-0000-4000-8000-0000000000a1",
    name: "Desk Helper",
    ownerId: owner,
    readRooms: ["agents", "developers", "main"],
    postRooms: ["developers"],
    dm: false,
    react: true,
    thread: true,
    perMinute: 6,
    perDay: 300,
    maxTurns: 6,
  };
  const ok = {
    mode: "ok",
    user: { id: owner, email: "dev@example.test", role: "user" },
    boardroom: false,
    shortscout: { mode: "absent" },
    agent,
  };
  const agentContext = (data: unknown, error: unknown = null) =>
    m.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "chat_api_request_context"
          ? { data: { mode: "unauthenticated" }, error: null }
          : { data, error },
      ),
    );
  beforeEach(() => {
    vi.clearAllMocks();
    m.authorization = `Bearer ${token}`;
    agentContext(ok);
  });
  it("speaks for the owner as a plain member, only in the agent's readable rooms", async () => {
    const auth = await requireChatUser(at("/api/chat/history"));
    expect(auth).toMatchObject({ ok: true, apiToken: true, user: { id: owner, role: "user" }, agent: { id: agent.id } });
    if (!auth.ok) throw new Error();
    expect(m.rpc.mock.calls.map((call) => call[0])).toEqual(["chat_api_request_context", "chat_agent_request_context"]);
    // main is in the agent's list but not the owner's (no Boardroom tag): the owner's rooms bound it.
    expect(auth.access.botRooms).toEqual(["developers"]);
    expect(auth.access.admin).toBe(false);
    expect(canAccessChatRoom(auth.access, "developers")).toBe(true);
    expect(canAccessChatRoom(auth.access, "social")).toBe(false);
    expect(canUseDirectMessages(auth.access)).toBe(false);
  });
  it("never has admin, even for an admin's agent", async () => {
    agentContext({ ...ok, user: { ...ok.user, role: "admin" } });
    expect(await requireChatUser(at("/api/chat"))).toMatchObject({ ok: true, user: { role: "user" }, access: { admin: false } });
  });
  it("a paused agent's token fails at once", async () => {
    agentContext({ mode: "agent_paused", agent: { id: agent.id, name: agent.name, pausedBy: "admin" } });
    expect(await requireChatUser(at("/api/chat"))).toEqual({ ok: false, status: 403, error: "agent_paused" });
  });
  it("refuses routes outside the agent list, including ones open to personal tokens", async () => {
    for (const path of ["/api/chat/inbox", "/api/chat/member", "/api/chat/message", "/api/chat/attachments"])
      expect(await requireChatUser(at(path))).toEqual({ ok: false, status: 403, error: "not_available_with_agent_token" });
    expect(await requireChatUser(at("/api/chat/admin"))).toMatchObject({ ok: false, status: 403 });
  });
  it("an unknown token, or no agents migration yet, is an invalid token", async () => {
    agentContext({ mode: "unauthenticated" });
    expect(await requireChatUser(at("/api/chat"))).toEqual({ ok: false, status: 401, error: "invalid_token" });
    agentContext(null, { code: "PGRST202", message: "missing" });
    expect(await requireChatUser(at("/api/chat"))).toEqual({ ok: false, status: 401, error: "invalid_token" });
  });
  it("fails closed when the database is unavailable", async () => {
    agentContext(null, { message: "down" });
    expect(await requireChatUser(at("/api/chat"))).toMatchObject({ ok: false, status: 503 });
  });
});
