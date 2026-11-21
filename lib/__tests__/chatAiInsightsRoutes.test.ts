// #482 AI Insights routes: members reply but never start a post (the send route), a reply wakes the
// answer step after the response, the cron's secret and New York hour, and the admin dry run.
const later = vi.hoisted(() => vi.fn());
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: later }));
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  answer: vi.fn(),
  run: vi.fn(),
  admin: vi.fn(),
  db: {},
}));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc, from: vi.fn() }) }));
vi.mock("@/lib/chatAdmin", () => ({
  requestOriginAllowed: () => true,
  readPublicRoomState: async () => ({ isOpen: true }),
  createChatAdminClient: () => mocks.db,
}));
vi.mock("@/lib/chatPush", () => ({ processChatPushJobs: vi.fn() }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: vi.fn(), publishRoomEvent: vi.fn() }));
vi.mock("@/lib/chatAiInsightsAnswers", () => ({ answerAiInsightsReply: mocks.answer }));
vi.mock("@/lib/chatAiInsightsServer", () => ({ runAiInsightsDay: mocks.run }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      throw new Error("never the real API in tests");
    }
  },
}));

import { POST as chatPost } from "@/app/api/chat/route";
import { GET as cronGet } from "@/app/api/cron/ai-insights/route";
import { POST as adminPost } from "@/app/api/admin/ai-insights/route";

const ROOT = "00000000-0000-4000-8000-000000000001";
const ss = { longboard: false, shortscout: true, admin: false };
const send = (body: Record<string, unknown>) =>
  new NextRequest("https://longboard.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "send", room: "ai-insights", body: "What was the SSR price?", ...body }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
  vi.stubEnv("CRON_SECRET", "synthetic-cron");
  mocks.auth.mockResolvedValue({ ok: true, access: ss, user: { id: "account" } });
  mocks.rpc.mockImplementation(async (_fn: string, args: { p_reply: string | null }) => ({
    data: { status: "sent", message: { id: "reply-id", body: "x", reply_to_id: args.p_reply, memberships: [] } },
    error: null,
  }));
});

describe("posting in AI Insights", () => {
  it("refuses a member's new post before the database", async () => {
    const response = await chatPost(send({}));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "replies_only" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("takes a member's reply and answers it after the response", async () => {
    const response = await chatPost(send({ replyTo: ROOT }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("send_chat_room_message", expect.objectContaining({ p_room: "ai-insights", p_reply: ROOT }));
    for (const [task] of later.mock.calls) await task();
    expect(mocks.answer).toHaveBeenCalledWith("reply-id");
  });
  it("lets an admin start a post from the browser, never through an API token", async () => {
    mocks.auth.mockResolvedValue({ ok: true, access: { ...ss, longboard: true, admin: true }, user: { id: "admin" } });
    expect((await chatPost(send({}))).status).toBe(200);
    for (const [task] of later.mock.calls) await task();
    expect(mocks.answer).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ ok: true, access: { ...ss, longboard: true, admin: true }, user: { id: "admin" }, apiToken: true });
    expect((await chatPost(send({}))).status).toBe(403);
  });
  it("keeps it from members without SS", async () => {
    mocks.auth.mockResolvedValue({ ok: true, access: { longboard: true, boardroom: true, shortscout: false, shortscoutMember: true, admin: false }, user: { id: "lb" } });
    expect((await chatPost(send({ replyTo: ROOT }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("turns the database guard's refusal into the same message", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "ai_insights_read_only" } });
    const response = await chatPost(send({ replyTo: ROOT }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "replies_only" });
  });
  it("leaves SS as it was: members start posts there, and nothing is answered", async () => {
    expect((await chatPost(send({ room: "shortscout" }))).status).toBe(200);
    for (const [task] of later.mock.calls) await task();
    expect(mocks.answer).not.toHaveBeenCalled();
  });
});

describe("the cron", () => {
  const cron = (auth = "Bearer synthetic-cron") => new NextRequest("https://longboard.test/api/cron/ai-insights", { headers: { authorization: auth } });
  it("needs the cron secret", async () => {
    expect((await cronGet(cron("Bearer wrong"))).status).toBe(401);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("runs only at 8 PM New York, for that New York day", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-21T00:30:00Z")); // 7:30 PM New York in winter
      expect(await (await cronGet(cron())).json()).toMatchObject({ status: "skipped", reason: "not_insights_hour" });
      expect(mocks.run).not.toHaveBeenCalled();
      vi.setSystemTime(new Date("2026-11-21T01:30:00Z"));
      mocks.run.mockResolvedValue({ status: "posted", day: "2026-11-20" });
      expect((await cronGet(cron())).status).toBe(200);
      expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-11-20", dryRun: false }));
      vi.setSystemTime(new Date("2026-11-27T01:30:00Z")); // Thanksgiving evening
      mocks.run.mockClear();
      expect(await (await cronGet(cron())).json()).toMatchObject({ status: "skipped", reason: "not_a_trading_day" });
      expect(mocks.run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the admin dry run", () => {
  const dry = (body: unknown) =>
    new NextRequest("https://longboard.test/api/admin/ai-insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  it("is for admins only", async () => {
    mocks.admin.mockResolvedValue({ ok: false, status: 403, error: "admin_only" });
    expect((await adminPost(dry({ day: "2026-11-20" }))).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("runs any day without posting and returns the text", async () => {
    mocks.admin.mockResolvedValue({ ok: true, user: { id: "admin", role: "admin" } });
    expect((await adminPost(dry({ day: "2026-02-30" }))).status).toBe(400);
    mocks.run.mockResolvedValue({ status: "dry_run", day: "2026-11-20", text: "**AI Insights**", messageCount: 20, unverifiedPrices: [] });
    const response = await adminPost(dry({ day: "2026-11-20" }));
    expect(await response.json()).toMatchObject({ status: "dry_run", text: "**AI Insights**" });
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ day: "2026-11-20", dryRun: true }));
  });
});
