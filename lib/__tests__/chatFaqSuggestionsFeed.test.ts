import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The Marketing HQ feed: bearer secret only, refused when unset, and no member or message id leaves.
const mock = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin }));

import * as route from "@/app/api/chat/faq/suggestions/feed/route";

const SECRET = "s".repeat(40);
const URL = "https://www.longboardai.com/api/chat/faq/suggestions/feed";
const call = (authorization?: string) => route.GET(new NextRequest(URL, { headers: authorization ? { authorization } : {} }));
const row = (name: string | null, topic: string, created_at: string) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name,
  topic,
  created_at,
  status: "pending",
  ai_status: "ready",
  ai_topic: "Margin",
  ai_answer: "Draft",
  events: [{ action: "submitted", actor_name: name ?? "Former member", question: null, topic: null, answer: null, created_at }],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHAT_FAQ_SUGGESTIONS_READ_TOKEN", SECRET);
  mock.rpc.mockResolvedValue({ data: [], error: null });
  mock.admin.mockReturnValue({ rpc: mock.rpc });
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
  it("passes on the database's rows, newest first as it gave them, uncached", async () => {
    const rows = [row("Dana", "Margin calls", "2026-10-30T12:00:00Z"), row(null, "Stops", "2026-10-29T12:00:00Z")];
    mock.rpc.mockResolvedValue({ data: rows, error: null });
    const res = await call(`Bearer ${SECRET}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ suggestions: rows, truncated: false });
    expect(mock.rpc).toHaveBeenCalledWith("chat_faq_suggestions_feed", { p_limit: 1000 });
  });

  it("calls a draft that never came back failed, but not one still on its way", async () => {
    const pending = (created_at: string) => ({ ...row("Dana", "x", created_at), ai_status: "pending", ai_topic: null, ai_answer: null });
    mock.rpc.mockResolvedValue({ data: [pending(new Date().toISOString()), pending("2026-10-01T12:00:00Z")], error: null });
    const { suggestions } = await (await call(`Bearer ${SECRET}`)).json();
    expect(suggestions.map((s: { ai_status: string }) => s.ai_status)).toEqual(["pending", "failed"]);
  });

  it("says unavailable, with no database detail, when the read fails or the function isn't there", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: "42883", message: "function does not exist" } });
    let res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feed_unavailable" });
    mock.rpc.mockRejectedValue(new Error("network detail"));
    res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "feed_unavailable" });
  });

  it("says unavailable when the server has no database keys", async () => {
    mock.admin.mockReturnValue(null);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(503);
  });
});
