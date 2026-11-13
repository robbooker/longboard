import { beforeEach, describe, expect, it, vi } from "vitest";
// #455 Agents: mention alerts. Name matching, the route's checks and the cursor. The database side
// (recording at post time, the room filter, own posts, deleted messages) is in
// scripts/tests/chat-agent-mentions-database.mjs.
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
import { chatAgentRouteAllowed } from "@/lib/chatAgents";
import {
  agentMentioned,
  filterAgentMentions,
  mentionPollAllowed,
  MENTION_POLLS_PER_MINUTE,
  parseMentionQuery,
  readAgentMentions,
  resetMentionPolls,
} from "@/lib/chatAgentMentions";
import type { NextRequest } from "next/server";

describe("name matching", () => {
  it("is case-insensitive and word-bounded", () => {
    expect(agentMentioned("hey @Luke can you look", "Luke")).toBe(true);
    expect(agentMentioned("hey @luke", "Luke")).toBe(true);
    expect(agentMentioned("@LUKE, now", "Luke")).toBe(true);
    expect(agentMentioned("@Luke's idea", "Luke")).toBe(true);
    expect(agentMentioned("it's @Lukewarm", "Luke")).toBe(false);
    expect(agentMentioned("@Luke_2", "Luke")).toBe(false);
    expect(agentMentioned("@Luke2", "Luke")).toBe(false);
    expect(agentMentioned("Luke, no at sign", "Luke")).toBe(false);
  });
  it("needs the @ at a word start", () => {
    expect(agentMentioned("mail me@Luke", "Luke")).toBe(false);
    expect(agentMentioned("@@Luke", "Luke")).toBe(false);
    expect(agentMentioned("(@Luke)", "Luke")).toBe(true);
    expect(agentMentioned("x @Lukewarm then @Luke", "Luke")).toBe(true);
  });
  it("handles names with spaces", () => {
    expect(agentMentioned("ping @Desk Helper please", "Desk Helper")).toBe(true);
    expect(agentMentioned("ping @desk helper.", "Desk Helper")).toBe(true);
    expect(agentMentioned("ping @Desk Helpers", "Desk Helper")).toBe(false);
    expect(agentMentioned("ping @Desk", "Desk Helper")).toBe(false);
  });
  it("a longer member name at the same @ is the member's tag", () => {
    expect(agentMentioned("@Luke Smith hi", "Luke", ["Luke Smith"])).toBe(false);
    expect(agentMentioned("@Luke hi", "Luke", ["Luke Smith"])).toBe(true);
    expect(agentMentioned("@Luke Smith and @Luke", "Luke", ["Luke Smith"])).toBe(true);
  });
});

describe("query", () => {
  const q = (s: string) => parseMentionQuery(new URLSearchParams(s));
  it("takes a cursor and a limit", () => {
    expect(q("")).toEqual({ after: null, limit: 50 });
    expect(q("after=120&limit=10")).toEqual({ after: 120, limit: 10 });
    expect(q("after=0")).toEqual({ after: 0, limit: 50 });
  });
  it("refuses bad ones", () => {
    expect(q("after=-1")).toEqual({ error: "invalid_cursor" });
    expect(q("after=abc")).toEqual({ error: "invalid_cursor" });
    expect(q("limit=0")).toEqual({ error: "invalid_limit" });
    expect(q("limit=101")).toEqual({ error: "invalid_limit" });
  });
});

const agent = {
  id: "00000000-0000-4000-8000-0000000000a1",
  name: "Luke",
  ownerId: "00000000-0000-4000-8000-000000000002",
  readRooms: ["agents", "developers", "main"],
  postRooms: ["developers"],
  dm: false,
  react: true,
  thread: true,
  perMinute: 6,
  perDay: 300,
  maxTurns: 6,
};
const row = (over: Record<string, unknown> = {}) => ({
  seq: 7,
  id: "00000000-0000-4000-8000-0000000000m1",
  room: "developers",
  author: "Rob",
  authorAgentId: null,
  body: "@Luke can you check this?",
  replyTo: null,
  createdAt: "2026-11-13T15:00:00Z",
  ...over,
});

describe("filter", () => {
  it("keeps only readable rooms", () => {
    const rows = [row(), row({ id: "b", room: "social" }), row({ id: "c", room: "admins" })];
    expect(filterAgentMentions(rows, agent, ["developers"]).map((r) => r.id)).toEqual([row().id]);
  });
  it("leaves out the agent's own posts but keeps other agents'", () => {
    const rows = [row({ id: "own", authorAgentId: agent.id }), row({ id: "other", authorAgentId: "x", author: "Echo" })];
    const out = filterAgentMentions(rows, agent, ["developers"]);
    expect(out.map((r) => r.id)).toEqual(["other"]);
    expect(out[0]).toMatchObject({ author: "Echo", authorIsAgent: true });
  });
  it("drops a mention under an old name", () => {
    expect(filterAgentMentions([row({ body: "@OldLuke hi" })], agent, ["developers"])).toEqual([]);
  });
  it("returns the public shape", () => {
    expect(filterAgentMentions([row({ replyTo: "p1" })], agent, ["developers"])).toEqual([
      {
        seq: 7,
        id: row().id,
        room: "developers",
        author: "Rob",
        authorIsAgent: false,
        body: "@Luke can you check this?",
        replyTo: "p1",
        createdAt: "2026-11-13T15:00:00Z",
      },
    ]);
  });
});

describe("poll limit", () => {
  beforeEach(() => resetMentionPolls());
  it("allows 30 a minute per agent, then says when to retry", () => {
    const now = Date.parse("2026-11-13T15:00:00Z");
    for (let i = 0; i < MENTION_POLLS_PER_MINUTE; i++) expect(mentionPollAllowed("a", now + i * 100).ok).toBe(true);
    const refused = mentionPollAllowed("a", now + 5000);
    expect(refused).toEqual({ ok: false, retryAfter: 55 });
    expect(mentionPollAllowed("b", now + 5000).ok).toBe(true);
    expect(mentionPollAllowed("a", now + 60_001).ok).toBe(true);
  });
});

describe("route", () => {
  const token = `lbc_${"b".repeat(43)}`;
  const path = "/api/chat/agents/mentions";
  const at = (search = "") => ({ nextUrl: { pathname: path, searchParams: new URLSearchParams(search) } }) as unknown as NextRequest;
  const owner = {
    mode: "ok",
    user: { id: agent.ownerId, email: "dev@example.test", role: "user" },
    boardroom: false,
    shortscout: { mode: "absent" },
  };
  let page: { data: unknown; error: unknown };
  const call = async (search = "") => {
    const req = at(search);
    const res = await readAgentMentions(req.nextUrl.searchParams, await requireChatUser(req));
    return { status: res.status, body: await res.json() };
  };
  const asAgent = (context: unknown) =>
    m.rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "chat_api_request_context"
          ? { data: { mode: "unauthenticated" }, error: null }
          : name === "chat_agent_request_context"
            ? { data: context, error: null }
            : page,
      ),
    );
  beforeEach(() => {
    vi.clearAllMocks();
    resetMentionPolls();
    m.authorization = `Bearer ${token}`;
    page = { data: { mentions: [row()], cursor: 7, more: false }, error: null };
    asAgent({ ...owner, agent });
  });
  it("is on the agent route list", () => expect(chatAgentRouteAllowed(path)).toBe(true));
  it("returns the agent's mentions with the next cursor", async () => {
    const res = await call("after=3&limit=20");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mentions: [expect.objectContaining({ id: row().id, room: "developers" })], cursor: "7", more: false });
    const read = m.rpc.mock.calls.find((c) => c[0] === "chat_agent_mentions_since");
    // Rooms: the owner's rooms narrowed by the agent's (no Boardroom, so not main).
    expect(read?.[1]).toEqual({ p_agent: agent.id, p_rooms: ["developers"], p_after: 3, p_limit: 20 });
  });
  it("keeps the cursor when nothing is new", async () => {
    page = { data: { mentions: [], cursor: 12, more: false }, error: null };
    expect((await call("after=12")).body).toEqual({ mentions: [], cursor: "12", more: false });
  });
  it("passes on more pages", async () => {
    page = { data: { mentions: [row()], cursor: 40, more: true }, error: null };
    expect((await call("limit=1")).body).toMatchObject({ cursor: "40", more: true });
  });
  it("never returns rooms the agent may not read, or its own posts, even if the database did", async () => {
    page = {
      data: { mentions: [row({ id: "s", room: "social" }), row({ id: "own", authorAgentId: agent.id }), row()], cursor: 9, more: false },
      error: null,
    };
    expect((await call()).body.mentions.map((r: { id: string }) => r.id)).toEqual([row().id]);
  });
  it("a paused agent gets the same error as its other calls", async () => {
    asAgent({ mode: "agent_paused", agent: { id: agent.id, name: agent.name, pausedBy: "owner" } });
    expect(await call()).toEqual({ status: 403, body: { error: "agent_paused" } });
  });
  it("refuses personal tokens with a clear error", async () => {
    m.rpc.mockImplementation(() => Promise.resolve({ data: { ...owner, member: null }, error: null }));
    const res = await call();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("agent_token_required");
    expect(res.body.message).toMatch(/agent token/);
    expect(m.rpc.mock.calls.some((c) => c[0] === "chat_agent_mentions_since")).toBe(false);
  });
  it("refuses a bad cursor", async () => {
    expect(await call("after=x")).toEqual({ status: 400, body: { error: "invalid_cursor" } });
  });
  it("rate-limits polling", async () => {
    for (let i = 0; i < MENTION_POLLS_PER_MINUTE; i++) expect((await call()).status).toBe(200);
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("mentions_rate_limited");
  });
  it("says so before the migration", async () => {
    page = { data: null, error: { code: "PGRST202", message: "missing" } };
    expect((await call()).body.error).toBe("mentions_unavailable");
  });
});
