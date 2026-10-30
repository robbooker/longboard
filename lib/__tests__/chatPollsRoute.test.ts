import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), origin: vi.fn(), publish: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: m.auth }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({ rpc: m.rpc }),
  requestOriginAllowed: m.origin,
}));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: m.publish }));
vi.mock("@/lib/chatPush", () => ({ processChatPushJobs: vi.fn() }));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: vi.fn(),
}));
import { POST } from "@/app/api/chat/polls/route";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const req = (data: Record<string, unknown>) =>
  new NextRequest("https://longboard.test/api/chat/polls", {
    method: "POST",
    body: JSON.stringify({ room: "main", ...data }),
  });
const member = { longboard: true, boardroom: true, shortscout: false, admin: false };
const voterId = id(99);
const rawPoll = (over: Record<string, unknown> = {}) => ({
  message_id: id(1),
  question: "Which setup?",
  anonymous: true,
  multi: false,
  closed_at: null,
  created_by_me: false,
  voters: 2,
  my_votes: [],
  options: [
    { id: id(10), label: "Long", votes: 2, people: [{ id: voterId, name: "Secret Voter" }] },
    { id: id(11), label: "Short", votes: 0, people: [] },
  ],
  ...over,
});
let reads: unknown[];
beforeEach(() => {
  vi.clearAllMocks();
  m.origin.mockReturnValue(true);
  m.auth.mockResolvedValue({ ok: true, user: { id: "trusted", role: "user" }, access: member });
  reads = [rawPoll()];
  m.rpc.mockImplementation(async (fn: string) => {
    if (fn === "read_chat_polls") return { data: reads, error: null };
    if (fn === "create_chat_poll")
      return { data: { status: "sent", message: { id: id(1), body: "📊 Poll: Which setup?", memberships: [] } }, error: null };
    return { data: {}, error: null };
  });
});

it("rejects cross-origin before auth and requires sign-in", async () => {
  m.origin.mockReturnValue(false);
  expect((await POST(req({ action: "read", messageIds: [id(1)] }))).status).toBe(403);
  expect(m.auth).not.toHaveBeenCalled();
  m.origin.mockReturnValue(true);
  m.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
  expect((await POST(req({ action: "read", messageIds: [id(1)] }))).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("denies rooms the reader can't open, for every action", async () => {
  for (const action of ["read", "create", "vote", "close"]) {
    const r = await POST(req({ action, room: "shortscout", messageIds: [id(1)], messageId: id(1), optionIds: [] }));
    expect(r.status).toBe(403);
  }
  expect(m.rpc).not.toHaveBeenCalled();
});

it("only people who can post may create a poll", async () => {
  const r = await POST(req({ action: "create", room: "lb-announcements", question: "Q", options: ["A", "B"] }));
  expect(r.status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
  m.auth.mockResolvedValue({ ok: true, user: { id: "trusted" }, access: { ...member, admin: true } });
  expect(
    (await POST(req({ action: "create", room: "lb-announcements", question: "Q", options: ["A", "B"] }))).status,
  ).toBe(200);
});

it("refuses bad polls and polls in rooms without replies", async () => {
  expect((await POST(req({ action: "create", question: "Q", options: ["A"] }))).status).toBe(400);
  expect((await POST(req({ action: "create", question: "Q", options: ["A", "B"], replyTo: "bad" }))).status).toBe(400);
  m.auth.mockResolvedValue({ ok: true, user: { id: "trusted" }, access: { ...member, admin: true } });
  expect(
    (await POST(req({ action: "create", room: "whats-new", question: "Q", options: ["A", "B"], replyTo: id(5) })))
      .status,
  ).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});

it("creates through the database with the signed-in user, in a thread too, and sends it live", async () => {
  const r = await POST(
    req({ action: "create", user: "forged", question: " Q ", options: ["A", "B"], anonymous: false, multi: true, replyTo: id(5) }),
  );
  expect(r.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    "create_chat_poll",
    expect.objectContaining({
      p_user: "trusted",
      p_room: "main",
      p_question: "Q",
      p_options: ["A", "B"],
      p_anonymous: false,
      p_multi: true,
      p_reply: id(5),
    }),
  );
  expect(m.publish).toHaveBeenCalledWith("main", expect.objectContaining({ kind: "message", eventType: "INSERT" }));
  const published = m.publish.mock.calls[0][1];
  expect(published.row).not.toHaveProperty("memberships");
});

it.each([
  ["paused", 423],
  ["member_required", 409],
  ["rate_limited", 429],
  ["reply_not_found", 404],
])("maps a %s send", async (status, code) => {
  m.rpc.mockResolvedValue({ data: { status }, error: null });
  expect((await POST(req({ action: "create", question: "Q", options: ["A", "B"] }))).status).toBe(code);
  expect(m.publish).not.toHaveBeenCalled();
});

it("non-voters on an open poll get no counts and no names", async () => {
  const r = await POST(req({ action: "read", messageIds: [id(1)] }));
  const text = await r.text();
  expect(r.status).toBe(200);
  expect(text).not.toMatch(/"votes"|"percent"|"total"/);
  expect(text).not.toContain(voterId);
  expect(text).not.toContain("Secret Voter");
});

it("anonymous polls never return who voted: not to voters, not to the creator, not when closed", async () => {
  reads = [rawPoll({ my_votes: [id(10)], created_by_me: true, closed_at: "2026-10-30T00:00:00Z" })];
  const text = await (await POST(req({ action: "read", messageIds: [id(1)] }))).text();
  expect(JSON.parse(text).polls[0].options[0].votes).toBe(2);
  expect(text).not.toContain(voterId);
  expect(text).not.toContain("Secret Voter");
  for (const action of ["vote", "close"]) {
    const t = await (await POST(req({ action, messageId: id(1), optionIds: [id(10)] }))).text();
    expect(t).not.toContain(voterId);
  }
});

it("visible-votes polls name voters once the reader has voted", async () => {
  reads = [rawPoll({ anonymous: false, my_votes: [id(11)] })];
  const body = await (await POST(req({ action: "read", messageIds: [id(1)] }))).json();
  expect(body.polls[0].options[0].people).toEqual([{ id: voterId, name: "Secret Voter" }]);
  expect(body.polls[0].options[0].percent).toBe(100);
});

it("votes as the signed-in user, sends a polls signal and answers with the reader's view", async () => {
  reads = [rawPoll({ my_votes: [id(10)] })];
  const r = await POST(req({ action: "vote", messageId: id(1), optionIds: [id(10), id(10)], user: "forged" }));
  expect(r.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("vote_chat_poll", {
    p_user: "trusted",
    p_room: "main",
    p_message: id(1),
    p_options: [id(10)],
  });
  expect(m.publish).toHaveBeenCalledWith("main", { kind: "changed", topics: ["polls"], messageId: id(1) });
  expect((await r.json()).poll.myVotes).toEqual([id(10)]);
});

it("an empty vote takes it back; votes are allowed in rooms the reader can only read", async () => {
  expect((await POST(req({ action: "vote", messageId: id(1), optionIds: [] }))).status).toBe(200);
  expect((await POST(req({ action: "vote", room: "lb-announcements", messageId: id(1), optionIds: [] }))).status).toBe(
    200,
  );
});

it.each([
  [{ optionIds: "x" }],
  [{ optionIds: ["bad"] }],
  [{ optionIds: Array.from({ length: 11 }, (_, i) => id(i)) }],
  [{ messageId: "bad", optionIds: [] }],
])("rejects malformed votes %j", async (extra) => {
  expect((await POST(req({ action: "vote", messageId: id(1), ...extra }))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});

it.each([
  ["single_choice", 400],
  ["poll_closed", 409],
  ["poll_not_found", 404],
  ["invalid_option", 400],
  ["chat_paused", 423],
  ["member_required", 409],
  ["some database detail", 503],
])("maps a vote refused with %s", async (message, status) => {
  m.rpc.mockResolvedValue({ data: null, error: { message } });
  const r = await POST(req({ action: "vote", messageId: id(1), optionIds: [id(10), id(11)] }));
  expect(r.status).toBe(status);
  expect(await r.text()).not.toContain("some database detail");
  expect(m.publish).not.toHaveBeenCalled();
});

it("only the creator closes (the database decides who that is)", async () => {
  m.rpc.mockResolvedValue({ data: null, error: { message: "poll_forbidden" } });
  expect((await POST(req({ action: "close", messageId: id(1) }))).status).toBe(403);
  expect(m.rpc).toHaveBeenCalledWith("close_chat_poll", { p_user: "trusted", p_room: "main", p_message: id(1) });
});

it("bounds batched reads", async () => {
  expect((await POST(req({ action: "read", messageIds: [] }))).status).toBe(400);
  expect((await POST(req({ action: "read", messageIds: Array(101).fill(id(1)) }))).status).toBe(400);
});
