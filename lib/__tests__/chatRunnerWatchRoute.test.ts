import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
const publish = vi.fn();
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: (...a: unknown[]) => publish(...a) }));
import { POST } from "@/app/api/chat/runner-watch/route";

const TOKEN = "t".repeat(40);
const good = { id: "a", tickers: ["SGRX"], summary: "S", fullText: "F", alert: true };
const post = (body: unknown = good, token: string | null = TOKEN, type = "application/json") =>
  new NextRequest("https://www.longboardai.com/api/chat/runner-watch", {
    method: "POST",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("/api/chat/runner-watch", () => {
  beforeEach(() => {
    vi.stubEnv("CHAT_RUNNER_WATCH_TOKEN", TOKEN);
    rpc.mockReset();
    publish.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([[undefined], ["short"]])("fails closed when the secret is %s", async (secret) => {
    vi.stubEnv("CHAT_RUNNER_WATCH_TOKEN", secret as string);
    expect((await POST(post())).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([[null], ["w".repeat(40)], [""]])("refuses key %s and touches nothing", async (token) => {
    expect((await POST(post(good, token))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("checks type, JSON, size and shape", async () => {
    expect((await POST(post(good, TOKEN, "text/plain"))).status).toBe(415);
    expect((await POST(post("{"))).status).toBe(400);
    expect((await POST(post("x".repeat(256_001)))).status).toBe(413);
    const bad = await POST(post({ id: "a" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "summary_required" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("posts, and tells every room it reached", async () => {
    rpc.mockResolvedValue({ data: { status: "posted", reportId: "r", rooms: ["main", "shortscout"], capped: [] }, error: null });
    const r = await POST(post());
    expect(await r.json()).toMatchObject({ status: "posted", url: "https://www.longboardai.com/runner-watch/r", mainRooms: ["main", "shortscout"] });
    expect(publish.mock.calls.map((c) => c[0])).toEqual(["runner-watch", "main", "shortscout"]);
    const args = rpc.mock.calls[0][1];
    expect(args.p_post).toMatch(/^Alert: S\n\nMore about SGRX here: https:\/\/www\.longboardai\.com\/runner-watch\//);
    expect(args.p_main_post).toMatch(/^Runner Risk Watch alert: S\n/);
  });
  it.each([
    ["duplicate", 200], ["saved", 200], ["held", 429], ["refused", 429], ["off", 503],
  ])("%s answers %i and publishes nothing", async (status, code) => {
    rpc.mockResolvedValue({ data: { status, reportId: "r" }, error: null });
    expect((await POST(post())).status).toBe(code);
    expect(publish).not.toHaveBeenCalled();
  });
  it("a paused room and a database failure ask for a resend", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "longboard_chat_paused" } });
    expect((await POST(post())).status).toBe(423);
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const r = await POST(post());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "feed_unavailable" });
  });
});
