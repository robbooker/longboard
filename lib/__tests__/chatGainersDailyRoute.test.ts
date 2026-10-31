import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const upsert = vi.fn(async () => ({ error: null }));
const rpc = vi.fn(async () => ({ data: { start: "2026-10-30T04:00:00Z", finish: "2026-10-31T04:00:00Z" }, error: null }));
const query: Record<string, unknown> = {};
for (const name of ["select", "eq", "is", "gte", "lt", "order"]) query[name] = vi.fn(() => query);
query.range = vi.fn(async () => ({ data: [{ created_at: "2026-10-30T14:00:00Z", body: "alert" }], error: null }));
const from = vi.fn((table: string) => (table === "chat_gainers_pages" ? { upsert } : query));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({ from, rpc }) }));

const TOKEN = "t".repeat(40);
const first = { ts: "2026-10-30T14:22:38Z", px: 2.68, vol: 392999, sess: "day" };
const good = {
  day: "2026-10-30",
  total: 1,
  rest: [],
  top: [{ sym: "CHOW", country: "China", peak: 10, alertCount: 1, first, lastCap: 1, cmp: null, missed: [], historyFrom: null, note: null, lo: 1, hi: 2, bars: [[1, 1, 2, 1, 2, 3]], sma: [], vwap: [] }],
};
const post = (body: unknown, token: string | null = TOKEN, type = "application/json") =>
  new NextRequest("http://x/api/chat/gainers/daily", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (qs: string, token: string | null = TOKEN) =>
  new NextRequest(`http://x/api/chat/gainers/daily?${qs}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

describe("/api/chat/gainers/daily", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHAT_GAINERS_DAILY_TOKEN = TOKEN;
  });
  afterEach(() => {
    delete process.env.CHAT_GAINERS_DAILY_TOKEN;
  });
  it("fails closed when the token isn't set or is short", async () => {
    const { POST, GET } = await import("@/app/api/chat/gainers/daily/route");
    delete process.env.CHAT_GAINERS_DAILY_TOKEN;
    expect((await POST(post(good))).status).toBe(503);
    expect((await GET(get("alerts=2026-10-30"))).status).toBe(503);
    process.env.CHAT_GAINERS_DAILY_TOKEN = "short";
    expect((await POST(post(good, "short"))).status).toBe(503);
    expect(from).not.toHaveBeenCalled();
  });
  it("refuses a wrong or missing token", async () => {
    const { POST, GET } = await import("@/app/api/chat/gainers/daily/route");
    expect((await POST(post(good, "x".repeat(40)))).status).toBe(401);
    expect((await POST(post(good, null))).status).toBe(401);
    expect((await GET(get("alerts=2026-10-30", null))).status).toBe(401);
    expect(from).not.toHaveBeenCalled();
  });
  it("refuses bad bodies", async () => {
    const { POST } = await import("@/app/api/chat/gainers/daily/route");
    expect((await POST(post(good, TOKEN, "text/plain"))).status).toBe(415);
    expect((await POST(post("{"))).status).toBe(400);
    expect((await POST(post({ ...good, day: "nope" }))).status).toBe(400);
    expect((await POST(post("x".repeat(3_000_001)))).status).toBe(413);
    expect(upsert).not.toHaveBeenCalled();
  });
  it("saves by day, so a rerun replaces", async () => {
    const { POST } = await import("@/app/api/chat/gainers/daily/route");
    const response = await POST(post(good));
    expect(await response.json()).toEqual({ saved: true, day: "2026-10-30" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ trading_day: "2026-10-30" }), { onConflict: "trading_day" });
  });
  it("reads only the gainers room, for a valid day", async () => {
    const { GET } = await import("@/app/api/chat/gainers/daily/route");
    expect((await GET(get("alerts=bad"))).status).toBe(400);
    const response = await GET(get("alerts=2026-10-30"));
    expect(await response.json()).toEqual({ day: "2026-10-30", rows: [{ ts: "2026-10-30T14:00:00Z", body: "alert" }] });
    expect(query.eq).toHaveBeenCalledWith("room_slug", "gainers");
    expect(query.is).toHaveBeenCalledWith("reply_to_id", null);
    expect(query.eq).toHaveBeenCalledWith("removed", false);
  });
});
