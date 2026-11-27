// #535 Booker Stock Club: the chat opens to everyone in the room while a webinar is live there, and
// is read-only for members again when it ends. LiveKit, sign-in, the database and Ably are faked.
//  - the rule (lib/chatClubLive.ts): live; a short drop; ended; never set up;
//  - who it opens to: every member of the room through the browser; never a bot account, an API
//    token or an agent, in either state;
//  - the server's answer (lib/chatClubLiveServer.ts): LiveKit is asked at most once per few seconds
//    however many people post; the database only when nothing is playing; a LiveKit hiccup during
//    a webinar does not lock anyone out; nothing set up never opens;
//  - the routes: posting, replying, editing, deleting and attaching files follow it; reactions never
//    needed it; a stock-pick card is never a member's to change; an admin removes a member's post
//    but never a card; the status route tells the page; raising a hand works for a member.
const later = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: later }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  target: vi.fn(),
  latest: vi.fn(),
  notice: vi.fn(),
  close: vi.fn(),
  publish: vi.fn(),
  publishNow: vi.fn(),
  lk: { publishing: false, set: true, fail: false, calls: 0, hands: [] as string[] },
}));
const messagesTable = () => {
  const query = { select: () => query, eq: () => query, maybeSingle: () => mocks.target() };
  return query;
};
const db = { rpc: mocks.rpc, from: () => messagesTable() };
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => db }));
vi.mock("@/lib/chatAdmin", () => ({
  requestOriginAllowed: () => true,
  readPublicRoomState: async () => ({ isOpen: true }),
  createChatAdminClient: () => db,
}));
vi.mock("@/lib/chatPush", () => ({ processChatPushJobs: vi.fn() }));
vi.mock("@/lib/chatMembers", async (original) => ({
  ...(await original<typeof import("@/lib/chatMembers")>()),
  findChatMember: async () => ({ id: "member-bob", display_name: "Sample Member" }),
}));
vi.mock("@/lib/chatMembershipProjection", () => ({ withMessageMemberships: async (_db: unknown, rows: unknown[]) => rows }));
vi.mock("@/lib/chatStageRecordingServer", () => ({ stageRecordingAfterPost: vi.fn() }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: mocks.publish, publishRoomEvent: mocks.publishNow }));
vi.mock("@/lib/chatStageNotifyServer", () => ({ latestStageBroadcast: mocks.latest, stageNoticeAfterResponse: mocks.notice }));
vi.mock("@/lib/chatStageChange", () => ({ stageCloseAfterResponse: mocks.close }));
vi.mock("@/lib/chatStageLiveKit", async (original) => ({
  ...(await original<typeof import("@/lib/chatStageLiveKit")>()),
  stageVideoApi: () => ({
    ingresses: async () => {
      mocks.lk.calls += 1;
      if (mocks.lk.fail) throw new Error("down");
      return mocks.lk.set ? [{ id: "IN_1", url: "rtmps://fake.livekit.test/x", streamKey: "FAKE-STREAM-KEY-not-real", publishing: mocks.lk.publishing }] : [];
    },
    roomMetadata: async () => null,
  }),
  stageHandApi: () => ({
    participants: async () => [],
    setHand: async (_room: string, identity: string) => (mocks.lk.hands.push(identity), true),
  }),
}));

import { POST as chatPost } from "@/app/api/chat/route";
import { POST as messagePost } from "@/app/api/chat/message/route";
import { GET as statusGet } from "@/app/api/chat/stage/status/route";
import { POST as handPost } from "@/app/api/chat/stage/hand/route";
import { canChatInClubWebinar, type ChatEntitlements } from "@/lib/chatAccess";
import { attachmentAccess } from "@/lib/chatAttachments";
import { CLUB_ENDED_RECENT_MS, CLUB_READ_ONLY, CLUB_WEBINAR_ENDED, clubChat } from "@/lib/chatClubLive";
import { chatWriteNow, clubChatFor, clubChatNow, forgetClubChat } from "@/lib/chatClubLiveServer";
import { STAGE_DROP_GRACE_MS } from "@/lib/chatStageNotify";
import { STAGE_STATE_MEMORY_MS, forgetStageState } from "@/lib/chatStageVideo";

const member: ChatEntitlements = { longboard: true, boardroom: true, shortscout: false, admin: false };
const buyer: ChatEntitlements = { longboard: false, shortscout: false, admin: false, member: ["club-room"] };
const admin: ChatEntitlements = { ...member, admin: true };
const browser = {};
const asMember = (over: Record<string, unknown> = {}) => ({ ok: true, access: member, user: { id: "account-bob", role: "user" }, ...over });
const asAdmin = (over: Record<string, unknown> = {}) => ({ ok: true, access: admin, user: { id: "account-alice", role: "admin" }, ...over });
const POST_ID = "00000000-0000-4000-8000-000000000011";
const CARD_ID = "00000000-0000-4000-8000-000000000022";
const post = (path: string, body: Record<string, unknown>) =>
  new NextRequest(`https://longboard.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: "https://longboard.test", host: "longboard.test" },
    body: JSON.stringify(body),
  });
const send = (body: Record<string, unknown> = {}) => chatPost(post("/api/chat", { action: "send", room: "club", body: "Hello from the webinar!", ...body }));
const change = (body: Record<string, unknown>) => messagePost(post("/api/chat/message", { room: "club", messageId: POST_ID, ...body }));
const errorOf = async (response: Response) => [response.status, (await response.json()).error];

/** The club as LiveKit and the database have it. `ended`: ms ago the last broadcast was marked ended (null: still open). */
function club(state: "never" | "live" | "dropped" | "ended" | "idle", endedAgo = 60_000) {
  forgetStageState();
  forgetClubChat();
  mocks.lk.set = state !== "never";
  mocks.lk.publishing = state === "live";
  mocks.latest.mockResolvedValue(
    state === "never" || state === "idle" ? null : { id: "notice", endedAt: state === "ended" ? Date.now() - endedAgo : null },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
  vi.stubEnv("LIVEKIT_URL", "wss://fake.livekit.test");
  vi.stubEnv("LIVEKIT_API_KEY", "APIfakekey");
  vi.stubEnv("LIVEKIT_API_SECRET", "fake-secret-never-real-0123456789abcdef");
  vi.stubEnv("CHAT_STAGE_MODE", "");
  Object.assign(mocks.lk, { publishing: false, set: true, fail: false, calls: 0, hands: [] });
  mocks.auth.mockResolvedValue(asMember());
  mocks.target.mockResolvedValue({ data: { guest_id: "member-bob", bot_slug: null }, error: null });
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) =>
    name.startsWith("send_")
      ? { data: { status: "sent", message: { id: "new-id", body: args.p_body, reply_to_id: args.p_reply ?? null, memberships: [] } }, error: null }
      : name.startsWith("change_")
        ? { data: args.p_action === "delete" ? { deletedId: args.p_message, message: null } : { id: args.p_message, body: args.p_body }, error: null }
        : { data: null, error: null },
  );
  club("idle");
});

describe("the rule", () => {
  const now = 1_800_000_000_000;
  it("opens the moment LiveKit says live, whatever the notice says", () => {
    expect(clubChat("live", null, now)).toEqual({ open: true, ended: false });
    expect(clubChat("live", { endedAt: now - 5_000 }, now)).toEqual({ open: true, ended: false });
  });
  it("stays open through a drop: stopped, and not marked ended yet", () => {
    expect(clubChat("waiting", { endedAt: null }, now)).toEqual({ open: true, ended: false });
    // LiveKit could not be read at all (a hiccup): an open broadcast still keeps the chat open.
    expect(clubChat("off", { endedAt: null }, now)).toEqual({ open: true, ended: false });
  });
  it("locks once the broadcast is marked ended, and says so for ten minutes", () => {
    expect(clubChat("waiting", { endedAt: now - 1 }, now)).toEqual({ open: false, ended: true });
    expect(clubChat("waiting", { endedAt: now - CLUB_ENDED_RECENT_MS + 1 }, now)).toEqual({ open: false, ended: true });
    expect(clubChat("waiting", { endedAt: now - CLUB_ENDED_RECENT_MS }, now)).toEqual({ open: false, ended: false });
  });
  it("is read-only with no broadcast on record, or none that could be read", () => {
    expect(clubChat("waiting", null, now)).toEqual({ open: false, ended: false });
    expect(clubChat("off", null, now)).toEqual({ open: false, ended: false });
  });
  it("uses the notice's own grace, so the lock is 20 seconds after a stop", () => {
    // The notice is marked ended STAGE_DROP_GRACE_MS after the broadcast stops (lib/chatStageNotify.ts).
    expect(STAGE_DROP_GRACE_MS).toBe(20_000);
  });
});

describe("who the webinar opens the chat to", () => {
  it("everyone who can open the room, through the browser", () => {
    expect(canChatInClubWebinar(member, browser)).toBe(true);
    expect(canChatInClubWebinar(buyer, browser)).toBe(true);
    expect(canChatInClubWebinar({ longboard: false, shortscout: false, shortscoutMember: true, admin: false }, browser)).toBe(true);
  });
  it("nobody who cannot open the room", () => {
    expect(canChatInClubWebinar({ longboard: false, shortscout: false, admin: false }, browser)).toBe(false);
  });
  it("never a bot account, an API token or an agent, and fails closed without a sign-in source", () => {
    expect(canChatInClubWebinar({ ...member, botRooms: ["club"] }, browser)).toBe(false);
    expect(canChatInClubWebinar(member, { apiToken: true })).toBe(false);
    expect(canChatInClubWebinar(admin, { apiToken: true })).toBe(false);
    expect(canChatInClubWebinar(member, { agent: { id: "a" } })).toBe(false);
    expect(canChatInClubWebinar(member)).toBe(false);
  });
});

describe("the server's answer", () => {
  it("a member: refused at rest, allowed while live", async () => {
    expect(await chatWriteNow(member, "club", browser)).toEqual({ allowed: false, webinar: false, ended: false });
    club("live");
    expect(await chatWriteNow(member, "club", browser)).toEqual({ allowed: true, webinar: true, ended: false });
    expect(await chatWriteNow(buyer, "club", browser)).toEqual({ allowed: true, webinar: true, ended: false });
  });
  it("an admin is never asked about: always allowed, as an ordinary write", async () => {
    expect(await chatWriteNow(admin, "club", browser)).toEqual({ allowed: true, webinar: false, ended: false });
    club("live");
    expect(await chatWriteNow(admin, "club", browser)).toEqual({ allowed: true, webinar: false, ended: false });
    expect(mocks.lk.calls).toBe(0);
    expect(mocks.latest).not.toHaveBeenCalled();
  });
  it("bots, API tokens and agents: refused in both states, and nothing is asked for them", async () => {
    for (const state of ["idle", "live"] as const) {
      club(state);
      expect((await chatWriteNow({ ...member, botRooms: ["club"] }, "club", browser)).allowed).toBe(false);
      expect((await chatWriteNow(member, "club", { apiToken: true })).allowed).toBe(false);
      expect((await chatWriteNow(admin, "club", { apiToken: true })).allowed).toBe(false);
      expect((await chatWriteNow(member, "club", { agent: { id: "a" } })).allowed).toBe(false);
      expect((await chatWriteNow(member, "club")).allowed).toBe(false);
    }
    expect(mocks.lk.calls).toBe(0);
  });
  it("other rooms are as they were, live or not", async () => {
    club("live");
    expect((await chatWriteNow(member, "main", browser)).allowed).toBe(true);
    expect((await chatWriteNow(member, "gainers", browser)).allowed).toBe(false);
    expect((await chatWriteNow(member, "lb-announcements", browser)).allowed).toBe(false);
    expect((await chatWriteNow(member, "main", browser)).webinar).toBe(false);
    expect(mocks.lk.calls).toBe(0);
  });
  it("asks LiveKit once for a burst of posts, and the database not at all while live", async () => {
    club("live");
    for (let i = 0; i < 50; i++) expect((await chatWriteNow(member, "club", browser)).allowed).toBe(true);
    expect(mocks.lk.calls).toBe(1);
    expect(mocks.latest).not.toHaveBeenCalled();
  });
  it("a short drop keeps the chat open; the notice being marked ended locks it", async () => {
    club("dropped");
    expect(await clubChatNow()).toEqual({ open: true, ended: false });
    // An open broadcast is never remembered: the next answer reads it again.
    mocks.latest.mockResolvedValue({ id: "notice", endedAt: Date.now() - 500 });
    expect(await clubChatNow()).toEqual({ open: false, ended: true });
    expect(await chatWriteNow(member, "club", browser)).toEqual({ allowed: false, webinar: false, ended: true });
  });
  it("back live after ending: open again at once", async () => {
    club("ended", 30_000);
    expect((await clubChatNow()).open).toBe(false);
    mocks.lk.publishing = true;
    forgetStageState("club"); // what LiveKit's webhook does on the server that receives it
    expect((await clubChatNow()).open).toBe(true);
  });
  it("on a server that has not heard of the start, opens within the few seconds its memory lasts", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    club("ended", 3_600_000);
    expect((await clubChatNow()).open).toBe(false);
    mocks.lk.publishing = true;
    expect((await clubChatNow()).open).toBe(false); // remembered "nothing playing"
    vi.setSystemTime(1_800_000_000_000 + STAGE_STATE_MEMORY_MS);
    expect((await clubChatNow()).open).toBe(true);
    expect(mocks.lk.calls).toBe(2);
  });
  it("a LiveKit hiccup during a webinar does not lock the chat; one with no broadcast on record does not open it", async () => {
    club("dropped");
    mocks.lk.fail = true;
    expect((await clubChatNow()).open).toBe(true);
    club("idle");
    mocks.lk.fail = true;
    expect((await clubChatNow()).open).toBe(false);
    club("ended");
    mocks.lk.fail = true;
    expect((await clubChatNow()).open).toBe(false);
  });
  it("a broadcast record that cannot be read never opens the chat", async () => {
    club("dropped");
    mocks.latest.mockRejectedValue(new Error("down"));
    expect(await clubChatNow()).toEqual({ open: false, ended: false });
  });
  it("with live video not set up, or switched off, the chat never opens and nothing is asked", async () => {
    club("live");
    vi.stubEnv("CHAT_STAGE_MODE", "off");
    expect(await clubChatNow()).toEqual({ open: false, ended: false });
    vi.stubEnv("CHAT_STAGE_MODE", "");
    vi.stubEnv("LIVEKIT_API_SECRET", "");
    expect((await chatWriteNow(member, "club", browser)).allowed).toBe(false);
    expect(mocks.lk.calls).toBe(0);
  });
  it("remembers 'no webinar' for a few seconds for a post, half a minute for an ordinary room open", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    club("ended", 3_600_000);
    await clubChatFor("waiting");
    await clubChatFor("waiting");
    expect(mocks.latest).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_800_000_000_000 + STAGE_STATE_MEMORY_MS + 1);
    await clubChatFor("waiting", { longMemory: true });
    expect(mocks.latest).toHaveBeenCalledTimes(1);
    await clubChatFor("waiting");
    expect(mocks.latest).toHaveBeenCalledTimes(2);
    // Seeing the club live forgets it.
    await clubChatFor("live");
    await clubChatFor("waiting", { longMemory: true });
    expect(mocks.latest).toHaveBeenCalledTimes(3);
  });
  it("a stop nobody reported is followed up when someone tries to post", async () => {
    club("live");
    await clubChatNow();
    mocks.notice.mockClear();
    mocks.lk.publishing = false;
    forgetStageState("club");
    // (forgetStageState keeps the once-a-minute bookkeeping; the state changing is what makes the look due.)
    await clubChatNow();
    expect(mocks.notice).toHaveBeenCalledWith("club", expect.anything(), null, { tellRoom: true });
  });
});

describe("posting and replying", () => {
  it("a member is refused when no webinar is live, before the database", async () => {
    expect(await errorOf(await send())).toEqual([403, CLUB_READ_ONLY]);
    expect(await errorOf(await send({ replyTo: POST_ID }))).toEqual([403, CLUB_READ_ONLY]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("a member posts while it is live, through the club's webinar function", async () => {
    club("live");
    const response = await send({ clientId: "00000000-0000-4000-8000-0000000000aa" });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("send_chat_club_live_message", {
      p_user: "account-bob",
      p_body: "Hello from the webinar!",
      p_reply: null,
      p_files: [],
      p_client: "00000000-0000-4000-8000-0000000000aa",
    });
    expect(mocks.publish).toHaveBeenCalledWith("club", expect.objectContaining({ kind: "message", eventType: "INSERT" }));
  });
  it("a member replies while it is live", async () => {
    club("live");
    expect((await send({ replyTo: POST_ID })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("send_chat_club_live_message", expect.objectContaining({ p_reply: POST_ID }));
  });
  it("a reply under a stock-pick card is refused by the database guard, live or not", async () => {
    club("live");
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "club_read_only" } });
    expect(await errorOf(await send({ replyTo: CARD_ID }))).toEqual([403, "Replies are off under the stock-pick cards."]);
  });
  it("the ordinary send limit's answer comes through unchanged", async () => {
    club("live");
    mocks.rpc.mockResolvedValue({ data: { status: "rate_limited", reason: "burst" }, error: null });
    expect(await errorOf(await send())).toEqual([429, "rate_limited"]);
  });
  it("during a short drop a post still goes through; once it is marked ended the member is told so", async () => {
    club("dropped");
    expect((await send()).status).toBe(200);
    club("ended", 2_000);
    mocks.rpc.mockClear();
    expect(await errorOf(await send())).toEqual([403, CLUB_WEBINAR_ENDED]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    club("ended", CLUB_ENDED_RECENT_MS + 1_000);
    expect(await errorOf(await send())).toEqual([403, CLUB_READ_ONLY]);
  });
  it("what the page says about being live is never read", async () => {
    const claims = { live: true, webinar: true, state: "live", chat: true, stage: "live" };
    expect(await errorOf(await send(claims))).toEqual([403, CLUB_READ_ONLY]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("an API token and an agent are refused in both states", async () => {
    for (const state of ["idle", "live"] as const) {
      club(state);
      mocks.auth.mockResolvedValue(asMember({ apiToken: true }));
      expect(await errorOf(await send())).toEqual([403, CLUB_READ_ONLY]);
      mocks.auth.mockResolvedValue(asAdmin({ apiToken: true }));
      expect(await errorOf(await send())).toEqual([403, CLUB_READ_ONLY]);
      mocks.auth.mockResolvedValue(asMember({ apiToken: true, agent: { id: "agent", postRooms: ["club"], thread: true, react: true } }));
      expect(await errorOf(await send())).toEqual([403, CLUB_READ_ONLY]);
      mocks.auth.mockResolvedValue(asMember({ access: { ...member, botRooms: ["club"] }, apiToken: true }));
      expect(await errorOf(await send())).toEqual([403, CLUB_READ_ONLY]);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.lk.calls).toBe(0);
  });
  it("an admin posts as before, live or not, through the ordinary function", async () => {
    mocks.auth.mockResolvedValue(asAdmin());
    for (const state of ["idle", "live"] as const) {
      club(state);
      expect((await send()).status).toBe(200);
      expect(mocks.rpc).toHaveBeenLastCalledWith("send_chat_room_message", expect.objectContaining({ p_room: "club", p_user: "account-alice" }));
    }
  });
  it("someone who cannot open the room is refused either way", async () => {
    club("live");
    mocks.auth.mockResolvedValue(asMember({ access: { longboard: false, shortscout: false, admin: false } }));
    expect(await errorOf(await send())).toEqual([403, "room_forbidden"]);
  });
  it("reactions never depended on it: a member reacts in both states", async () => {
    for (const state of ["idle", "live"] as const) {
      club(state);
      mocks.target.mockResolvedValue({ data: { id: POST_ID, message_id: POST_ID, guest_id: "member-bob", active: true }, error: null });
      const response = await chatPost(post("/api/chat", { action: "react", room: "club", messageId: POST_ID, active: true }));
      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenLastCalledWith("set_chat_message_reaction", expect.objectContaining({ p_room: "club", p_message: POST_ID, p_active: true }));
    }
    expect(mocks.lk.calls).toBe(0);
  });
  it("other rooms send as before and ask nothing about the club", async () => {
    club("live");
    expect((await chatPost(post("/api/chat", { action: "send", room: "main", body: "hi" }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("send_chat_room_message", expect.objectContaining({ p_room: "main" }));
    expect(mocks.lk.calls).toBe(0);
  });
});

describe("editing and deleting", () => {
  it("a member edits and deletes their own post while it is live", async () => {
    club("live");
    expect((await change({ action: "edit", body: "Edited", expectedBody: "Hello" })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_club_live_message", {
      p_actor: "account-bob",
      p_message: POST_ID,
      p_action: "edit",
      p_body: "Edited",
      p_expected_body: "Hello",
      p_expected_revision: null,
    });
    expect((await change({ action: "delete" })).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_club_live_message", expect.objectContaining({ p_action: "delete" }));
  });
  it("after the lock a member can neither edit nor delete, and the database is not asked", async () => {
    club("ended", 5_000);
    expect(await errorOf(await change({ action: "edit", body: "Edited", expectedBody: "Hello" }))).toEqual([403, CLUB_WEBINAR_ENDED]);
    expect(await errorOf(await change({ action: "delete" }))).toEqual([403, CLUB_WEBINAR_ENDED]);
    club("idle");
    expect(await errorOf(await change({ action: "delete" }))).toEqual([403, CLUB_READ_ONLY]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("a stock-pick card is never a member's to change: the database's refusal comes back", async () => {
    club("live");
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "message_forbidden" } });
    expect(await errorOf(await change({ messageId: CARD_ID, action: "edit", body: "Mine now", expectedBody: "#1 stock of the day" }))).toEqual([403, "message_forbidden"]);
    expect(await errorOf(await change({ messageId: CARD_ID, action: "delete" }))).toEqual([403, "message_forbidden"]);
    // Never sent as a moderator.
    for (const [name, args] of mocks.rpc.mock.calls) {
      expect(name).toBe("change_chat_club_live_message");
      expect(args).not.toHaveProperty("p_admin");
    }
  });
  it("an admin removes a member's post, never a stock-pick card or another bot post", async () => {
    mocks.auth.mockResolvedValue(asAdmin());
    for (const state of ["idle", "live"] as const) {
      club(state);
      mocks.target.mockResolvedValue({ data: { guest_id: "member-bob", bot_slug: null }, error: null });
      await change({ action: "delete" });
      expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_message", expect.objectContaining({ p_room: "club", p_action: "delete", p_admin: true }));
      mocks.target.mockResolvedValue({ data: { guest_id: null, bot_slug: "club" }, error: null });
      await change({ messageId: CARD_ID, action: "delete" });
      expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_message", expect.objectContaining({ p_message: CARD_ID, p_admin: false }));
      mocks.target.mockResolvedValue({ data: { guest_id: null, bot_slug: "longboard" }, error: null });
      await change({ messageId: CARD_ID, action: "delete" });
      expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_message", expect.objectContaining({ p_admin: false }));
      // The post could not be looked up: not as a moderator.
      mocks.target.mockResolvedValue({ data: null, error: { message: "down" } });
      await change({ action: "delete" });
      expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_message", expect.objectContaining({ p_admin: false }));
      // An edit is never a moderator's.
      mocks.target.mockResolvedValue({ data: { guest_id: "member-bob", bot_slug: null }, error: null });
      await change({ action: "edit", body: "Edited", expectedBody: "Hello" });
      expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_message", expect.objectContaining({ p_action: "edit", p_admin: false }));
    }
  });
  it("an API token is refused in both states", async () => {
    for (const state of ["idle", "live"] as const) {
      club(state);
      mocks.auth.mockResolvedValue(asMember({ apiToken: true }));
      expect(await errorOf(await change({ action: "delete" }))).toEqual([403, CLUB_READ_ONLY]);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("other rooms change as before", async () => {
    await messagePost(post("/api/chat/message", { room: "main", messageId: POST_ID, action: "delete" }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_message", expect.objectContaining({ p_room: "main", p_admin: false }));
    mocks.auth.mockResolvedValue(asAdmin());
    await messagePost(post("/api/chat/message", { room: "main", messageId: POST_ID, action: "delete" }));
    expect(mocks.rpc).toHaveBeenLastCalledWith("change_chat_message", expect.objectContaining({ p_room: "main", p_admin: true }));
  });
});

describe("files", () => {
  const auth = (over: Record<string, unknown> = {}) => asMember(over) as unknown as Parameters<typeof attachmentAccess>[1];
  const attach = (who = auth()) => attachmentAccess(db as unknown as Parameters<typeof attachmentAccess>[0], who, { room_slug: "club" }, true);
  it("a member attaches a file only while it is live", async () => {
    await expect(attach()).rejects.toMatchObject({ message: CLUB_READ_ONLY, status: 403 });
    club("live");
    await expect(attach()).resolves.toMatchObject({ id: "member-bob" });
    club("ended", 1_000);
    await expect(attach()).rejects.toMatchObject({ message: CLUB_WEBINAR_ENDED, status: 403 });
  });
  it("never through an API token", async () => {
    club("live");
    await expect(attach(auth({ apiToken: true }))).rejects.toMatchObject({ message: CLUB_READ_ONLY, status: 403 });
  });
  it("reading a file never asks", async () => {
    await expect(attachmentAccess(db as unknown as Parameters<typeof attachmentAccess>[0], auth(), { room_slug: "club" })).resolves.toMatchObject({ id: "member-bob" });
    expect(mocks.lk.calls).toBe(0);
  });
});

describe("what the page is told, and raising a hand", () => {
  const status = async (room = "club", fresh = true) =>
    (await statusGet(new NextRequest(`https://longboard.test/api/chat/stage/status?room=${room}${fresh ? "&fresh=1" : ""}`))).json();
  it("the club's status says whether the chat is open", async () => {
    expect(await status()).toMatchObject({ state: "waiting", chat: false });
    club("live");
    expect(await status()).toMatchObject({ state: "live", chat: true });
    club("dropped");
    expect(await status()).toMatchObject({ state: "waiting", chat: true });
    club("ended", 1_000);
    expect(await status()).toMatchObject({ state: "waiting", chat: false });
    club("never");
    expect(await status()).toMatchObject({ state: "off", chat: false });
  });
  it("no other room's status carries it, and the database is not read for them", async () => {
    club("live");
    expect(await status("main")).not.toHaveProperty("chat");
    expect(mocks.latest).not.toHaveBeenCalled();
  });
  it("a member raises a hand in the club while it is live, and not otherwise", async () => {
    const identity = "member-bob#00000001";
    const raise = () => handPost(post("/api/chat/stage/hand", { room: "club", identity, raised: true }));
    expect(await errorOf(await raise())).toEqual([409, "not_live"]);
    club("live");
    const response = await raise();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ raised: true });
    expect(mocks.lk.hands).toEqual([identity]);
    // Never through an API token, as in every room.
    mocks.auth.mockResolvedValue(asMember({ apiToken: true }));
    expect(await errorOf(await raise())).toEqual([403, "browser_only"]);
  });
});
