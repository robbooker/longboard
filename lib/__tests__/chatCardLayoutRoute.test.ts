import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
const { auth, inbox, admin } = vi.hoisted(() => ({ auth: vi.fn(), inbox: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatReads/inbox", () => ({ readInbox: inbox }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: admin, requestOriginAllowed: () => true }));
import { GET, POST } from "@/app/api/chat/card-layout/route";

const dmId = "22222222-2222-4222-8222-222222222220";
const conversations = [
  { id: dmId, otherId: "friend", otherName: "Friend", status: "accepted", blockedByMe: false, unavailable: false },
];
// A ShortScout-only member: no LB room, but Social and Gainers.
const ssMember = { ok: true, user: { id: "acct-1" }, access: { longboard: false, shortscout: true, admin: false } };
const botNoGainers = { ok: true, user: { id: "bot" }, access: { longboard: false, shortscout: false, admin: false, botRooms: ["social"] } };

function fakeDb(saved: unknown = null) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: vi.fn().mockResolvedValue({ data: saved === null ? null : { slots: saved }, error: null }),
  };
  return { db: { from: vi.fn(() => ({ ...query, upsert })) }, upsert };
}
const post = (body: unknown) =>
  POST(new NextRequest("https://chat.test/api/chat/card-layout", { method: "POST", body: JSON.stringify(body) }));
const get = () => GET(new NextRequest("https://chat.test/api/chat/card-layout?view=six"));

describe("card layout route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    inbox.mockImplementation(async () => Response.json({ conversations }));
  });
  it("rejects signed-out callers before reading anything", async () => {
    auth.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    expect((await get()).status).toBe(401);
    expect(inbox).not.toHaveBeenCalled();
  });
  it("saves only cards the member can reach, keyed by the signed-in account", async () => {
    auth.mockResolvedValue(ssMember);
    const { db, upsert } = fakeDb();
    admin.mockReturnValue(db);
    const response = await post({
      view: "six",
      layout: [
        { type: "room", source: "main" }, // LB room: not theirs
        { type: "room", source: "shortscout" },
        { type: "dm", source: dmId },
        { type: "dm", source: "33333333-3333-4333-8333-333333333333" }, // someone else's DM
        { type: "gainers-table", source: "" },
        { type: "chart", source: "AAPL" }, // not a type yet
      ],
    });
    expect(response.status).toBe(200);
    const expected = [null, { type: "room", source: "shortscout" }, { type: "dm", source: dmId }, null, { type: "gainers-table", source: "" }, null];
    expect((await response.json()).layout).toEqual(expected);
    expect(upsert.mock.calls[0][0]).toMatchObject({ account_id: "acct-1", view: "six", slots: expected });
  });
  it("#383: saves the News Feed card for Gainers members and empties it for everyone else", async () => {
    auth.mockResolvedValue(ssMember);
    admin.mockReturnValue(fakeDb().db);
    const ok = await post({ view: "six", layout: [{ type: "news", source: "" }] });
    expect((await ok.json()).layout[0]).toEqual({ type: "news", source: "" });
    auth.mockResolvedValue(botNoGainers);
    admin.mockReturnValue(fakeDb().db);
    const refused = await post({ view: "six", layout: [{ type: "news", source: "" }, { type: "room", source: "social" }] });
    expect((await refused.json()).layout.slice(0, 2)).toEqual([null, { type: "room", source: "social" }]);
  });
  it("does not give the Gainers Table to members without Gainers", async () => {
    auth.mockResolvedValue(botNoGainers);
    const { db, upsert } = fakeDb();
    admin.mockReturnValue(db);
    const response = await post({ view: "six", layout: [{ type: "gainers-table", source: "" }, { type: "room", source: "social" }] });
    expect((await response.json()).layout.slice(0, 2)).toEqual([null, { type: "room", source: "social" }]);
    // A bot account has no DMs: the inbox isn't read for it at all.
    expect(inbox).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledOnce();
  });
  it("saves nothing when the member's DMs can't be read", async () => {
    auth.mockResolvedValue(ssMember);
    inbox.mockResolvedValue(Response.json({ error: "inbox_unavailable" }, { status: 503 }));
    const { db, upsert } = fakeDb();
    admin.mockReturnValue(db);
    expect((await post({ view: "six", layout: [] })).status).toBe(503);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("rejects malformed bodies and unknown views with 400", async () => {
    auth.mockResolvedValue(ssMember);
    admin.mockReturnValue(fakeDb().db);
    for (const body of [null, { view: "six", layout: "x" }, { view: "nine", layout: [] }, { view: "six", layout: Array(7).fill(null) }])
      expect((await post(body)).status).toBe(400);
  });
  it("re-checks a saved layout on every read", async () => {
    auth.mockResolvedValue({ ...ssMember, access: { longboard: false, shortscout: false, shortscoutMember: true, admin: false } });
    admin.mockReturnValue(fakeDb([{ type: "room", source: "shortscout" }, { type: "room", source: "social" }]).db);
    const body = await (await get()).json();
    expect(body.saved).toBe(true);
    expect(body.layout).toEqual([null, { type: "room", source: "social" }, null, null, null, null]);
  });
  it("says nothing is saved yet, and answers 503 when storage is down", async () => {
    auth.mockResolvedValue(ssMember);
    admin.mockReturnValue(fakeDb().db);
    expect(await (await get()).json()).toEqual({ layout: null, saved: false });
    admin.mockReturnValue(null);
    expect((await get()).status).toBe(503);
  });
});
