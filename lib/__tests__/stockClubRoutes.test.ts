// #386 Booker Stock Club routes: the cron's CRON_SECRET, the card route's room check, the admin
// route's admin check, and the lookup route listing the club's extra tickers. No real service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ChatAuthResult } from "@/lib/chatAuth";

const server = vi.hoisted(() => ({
  inClubWindow: vi.fn(() => true),
  runStockClubTick: vi.fn(async () => ({ status: "posted", day: "2026-11-06", top: "AAAA" })),
  readFacts: vi.fn(async () => new Map([["AAAA", { ticker: "AAAA", country: "China", inst_own_pct: "7.5" }]])),
  readDayState: vi.fn(async () => ({ locked: false, candidates: [{ ticker: "AAAA" }], candidatesAt: null, picks: [], posted: [] })),
  postAdminPick: vi.fn(async () => ({ posted: true, messageId: "m1" })),
  resumeAutomatic: vi.fn(async () => ({ day: "2026-11-06", locked: false })),
  clubLookupNeeds: vi.fn(async () => ({ needs: [{ ticker: "CLUB", fields: ["country", "cash", "instOwn"] }], borrow: [{ ticker: "CLUB" }] })),
}));
vi.mock("@/lib/stockClubServer", () => server);
const publish = vi.fn();
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: (...a: unknown[]) => publish(...a) }));
const pickRow = { data: { ticker: "AAAA", day: "2026-11-06", country: null, instOwnPct: null, borrow: null, levels: [], chart: null, source: "auto" } };
const rpc = vi.fn(async (name: string) => (name === "chat_gainers_table" ? { data: [], error: null } : { data: [], error: null }));
const db = {
  rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: pickRow, error: null }) }) }) }),
};
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => db, requestOriginAllowed: () => true }));
let auth: ChatAuthResult = { ok: false, status: 401, error: "unauthenticated" };
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: async () => auth }));

const person = (access: Record<string, unknown>, role: "user" | "admin" = "user", extra: Record<string, unknown> = {}) =>
  ({ ok: true, user: { id: "u1", role }, access: { longboard: false, shortscout: false, admin: role === "admin", ...access }, ...extra }) as unknown as ChatAuthResult;
const MESSAGE = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "c".repeat(40);
  process.env.CHAT_GAINERS_LOOKUP_TOKEN = "l".repeat(40);
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.CHAT_GAINERS_LOOKUP_TOKEN;
});

describe("/api/cron/stock-club", () => {
  const call = async (header?: string) => {
    const { GET } = await import("@/app/api/cron/stock-club/route");
    return GET(new NextRequest("http://x/api/cron/stock-club", { headers: header ? { authorization: header } : {} }));
  };
  it("needs CRON_SECRET, like the morning report tick", async () => {
    delete process.env.CRON_SECRET;
    expect((await call(`Bearer ${"c".repeat(40)}`)).status).toBe(500);
    process.env.CRON_SECRET = "c".repeat(40);
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    expect(server.runStockClubTick).not.toHaveBeenCalled();
  });
  it("runs, and tells open rooms when it posted", async () => {
    const response = await call(`Bearer ${"c".repeat(40)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "posted", top: "AAAA" });
    expect(publish).toHaveBeenCalledWith("club", { kind: "changed", topics: ["history"] });
  });
  it("does nothing outside market hours", async () => {
    server.inClubWindow.mockReturnValueOnce(false);
    expect(await (await call(`Bearer ${"c".repeat(40)}`)).json()).toMatchObject({ status: "skipped" });
    expect(server.runStockClubTick).not.toHaveBeenCalled();
  });
  it("a failure names no detail", async () => {
    server.runStockClubTick.mockRejectedValueOnce(new Error("Polygon /v2/snapshot returned 500: secret stuff"));
    const response = await call(`Bearer ${"c".repeat(40)}`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "failed", error: "scan_failed" });
  });
});

describe("/api/chat/club/pick", () => {
  const call = async (message = MESSAGE) => {
    const { GET } = await import("@/app/api/chat/club/pick/route");
    return GET(new NextRequest(`http://x/api/chat/club/pick?message=${message}`));
  };
  it("signed out and members without the room are refused", async () => {
    auth = { ok: false, status: 401, error: "unauthenticated" };
    expect((await call()).status).toBe(401);
    auth = person({});
    expect((await call()).status).toBe(403);
  });
  it("a Gainers member gets the card with fresh facts", async () => {
    auth = person({ longboard: true });
    expect((await call("nope")).status).toBe(400);
    const body = await (await call()).json();
    expect(body.pick).toMatchObject({ ticker: "AAAA", country: "China", instOwnPct: 7.5 });
  });
});

describe("/api/chat/club/admin", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/chat/club/admin/route");
    return POST(new NextRequest("http://x/api/chat/club/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  };
  it("only admins, and never an API token", async () => {
    auth = person({ longboard: true });
    expect((await post({ ticker: "AAAA" })).status).toBe(403);
    auth = person({ longboard: true }, "admin", { apiToken: true });
    expect((await post({ ticker: "AAAA" })).status).toBe(403);
    const { GET } = await import("@/app/api/chat/club/admin/route");
    auth = person({ longboard: true });
    expect((await GET(new NextRequest("http://x/api/chat/club/admin"))).status).toBe(403);
    expect(server.postAdminPick).not.toHaveBeenCalled();
  });
  it("an admin sets the pick, or turns automatic picks back on", async () => {
    auth = person({ longboard: true }, "admin");
    expect((await post({ ticker: "bad ticker" })).status).toBe(400);
    const response = await post({ ticker: " aaaa " });
    expect(await response.json()).toEqual({ posted: true, ticker: "AAAA", messageId: "m1" });
    expect(server.postAdminPick).toHaveBeenCalledWith(db, "AAAA");
    expect(publish).toHaveBeenCalledWith("club", { kind: "changed", topics: ["history"] });
    expect(await (await post({ action: "resume" })).json()).toEqual({ day: "2026-11-06", locked: false });
  });
});

describe("/api/chat/gainers/facts also lists the club's tickers", () => {
  it("after Gainers' own", async () => {
    const { GET } = await import("@/app/api/chat/gainers/facts/route");
    const body = await (await GET(new NextRequest("http://x/api/chat/gainers/facts", { headers: { authorization: `Bearer ${"l".repeat(40)}` } }))).json();
    expect(body.needs).toEqual([{ ticker: "CLUB", fields: ["country", "cash", "instOwn"] }]);
    expect(body.borrow).toEqual([{ ticker: "CLUB" }]);
    expect(server.clubLookupNeeds).toHaveBeenCalledWith(db, expect.any(String), new Set(), expect.anything(), expect.any(Number));
  });
});
