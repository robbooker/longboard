import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The Marketing HQ feed: bearer secret only, refused when unset, and only name, topic and date leave.
const mock = vi.hoisted(() => ({ admin: vi.fn(), from: vi.fn(), select: vi.fn(), order: vi.fn(), limit: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin }));

import * as route from "@/app/api/chat/faq/suggestions/feed/route";

const SECRET = "s".repeat(40);
const URL = "https://www.longboardai.com/api/chat/faq/suggestions/feed";
const call = (authorization?: string) => route.GET(new NextRequest(URL, { headers: authorization ? { authorization } : {} }));
const row = (name: string | null, topic: string, created_at: string) => ({
  id: "11111111-1111-4111-8111-111111111111",
  message_id: "22222222-2222-4222-8222-222222222222",
  suggested_by: "33333333-3333-4333-8333-333333333333",
  topic,
  created_at,
  member: name === null ? null : { display_name: name, email: "private@example.invalid" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHAT_FAQ_SUGGESTIONS_READ_TOKEN", SECRET);
  const chain = { select: mock.select, order: mock.order, limit: mock.limit, insert: mock.write, update: mock.write, delete: mock.write };
  mock.select.mockReturnValue(chain);
  mock.order.mockReturnValue(chain);
  mock.limit.mockResolvedValue({ data: [], error: null });
  mock.from.mockReturnValue(chain);
  mock.admin.mockReturnValue({ from: mock.from });
});
afterEach(() => vi.unstubAllEnvs());

describe("who gets in", () => {
  it.each([["unset", undefined], ["empty", ""], ["blank", "     "], ["too short", "short"]])("refuses everyone when the secret is %s, even a caller sending that value", async (_label, value) => {
    if (value === undefined) delete process.env.CHAT_FAQ_SUGGESTIONS_READ_TOKEN;
    else vi.stubEnv("CHAT_FAQ_SUGGESTIONS_READ_TOKEN", value);
    for (const header of [undefined, `Bearer ${value ?? ""}`, "Bearer undefined", `Bearer ${SECRET}`]) {
      const res = await call(header);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "feed_not_configured" });
    }
    expect(mock.admin).not.toHaveBeenCalled();
  });

  it.each([
    ["no header", undefined],
    ["the wrong secret, same length", `Bearer ${"x".repeat(40)}`],
    ["a prefix of the secret", `Bearer ${SECRET.slice(0, 39)}`],
    ["the secret plus more", `Bearer ${SECRET}x`],
    ["another scheme", `Basic ${SECRET}`],
    ["an empty bearer", "Bearer "],
  ])("refuses %s without touching the database", async (_label, header) => {
    const res = await call(header);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(mock.admin).not.toHaveBeenCalled();
  });

  it("takes the right secret", async () => {
    expect((await call(`Bearer ${SECRET}`)).status).toBe(200);
    expect((await call(`bearer ${SECRET}`)).status).toBe(200);
  });

  it("compares with timingSafeEqual over equal-length digests", async () => {
    const source = (await import("node:fs")).readFileSync("app/api/chat/faq/suggestions/feed/route.ts", "utf8");
    expect(source).toContain("timingSafeEqual(digest(given), digest(secret))");
  });

  it("offers no way to write", () => {
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["GET"]);
  });
});

describe("what comes back", () => {
  it("sends only name, topic and created_at, with the name read from the members table", async () => {
    mock.limit.mockResolvedValue({ data: [row("Dana", "Margin calls", "2026-10-30T12:00:00Z"), row("Eli", "Stops", "2026-10-29T12:00:00Z")], error: null });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      suggestions: [
        { name: "Dana", topic: "Margin calls", created_at: "2026-10-30T12:00:00Z" },
        { name: "Eli", topic: "Stops", created_at: "2026-10-29T12:00:00Z" },
      ],
    });
    expect(mock.from).toHaveBeenCalledWith("chat_faq_suggestions");
    expect(mock.select.mock.calls[0][0]).toBe("topic, created_at, member:longboard_chat_members(display_name)");
  });

  it("asks for the newest first, capped, and only reads", async () => {
    await call(`Bearer ${SECRET}`);
    expect(mock.order.mock.calls[0]).toEqual(["created_at", { ascending: false }]);
    expect(mock.limit).toHaveBeenCalledWith(200);
    expect(mock.write).not.toHaveBeenCalled();
  });

  it("gives a null name when the member is gone", async () => {
    mock.limit.mockResolvedValue({ data: [row(null, "Old topic", "2026-10-01T12:00:00Z")], error: null });
    expect(await (await call(`Bearer ${SECRET}`)).json()).toEqual({ suggestions: [{ name: null, topic: "Old topic", created_at: "2026-10-01T12:00:00Z" }] });
  });

  it("says unavailable, with no database detail, when the read fails or the table isn't there", async () => {
    mock.limit.mockResolvedValue({ data: null, error: { code: "42P01", message: 'relation "chat_faq_suggestions" does not exist' } });
    let res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feed_unavailable" });
    mock.limit.mockRejectedValue(new Error("network detail"));
    res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feed_unavailable" });
  });

  it("says unavailable when the server has no database keys", async () => {
    mock.admin.mockReturnValue(null);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });
});
