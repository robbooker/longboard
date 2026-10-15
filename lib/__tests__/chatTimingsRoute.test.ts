import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), insert: vi.fn(), rpc: vi.fn(), requireAdmin: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mock.auth }));
vi.mock("@/lib/auth", () => ({ requireAdmin: mock.requireAdmin }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: mock.admin,
  requestOriginAllowed: (req: NextRequest) => !req.headers.get("origin") || req.headers.get("origin") === "https://longboard.test",
}));

const batch = { device: "desktop", rows: [{ m: "room_switch", v: 180, r: "social" }, { m: "wrong_landing", v: 0, r: "main" }] };
let ip = 0;
function post(body: string, origin = "https://longboard.test", forwarded = `10.0.0.${++ip}`) {
  return new NextRequest("https://longboard.test/api/chat/timings", {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8", origin, "x-forwarded-for": forwarded },
    body,
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.auth.mockResolvedValue({ ok: true, user: { id: "u1", email: "a@example.invalid", role: "user" } });
  mock.insert.mockResolvedValue({ error: null });
  mock.del.mockResolvedValue({ error: null, count: 3 });
  mock.admin.mockReturnValue({
    from: () => ({ insert: mock.insert, delete: () => ({ lt: mock.del }) }),
    rpc: mock.rpc,
  });
});

describe("POST /api/chat/timings", () => {
  it("stores only metric, value, room and device", async () => {
    const { POST } = await import("@/app/api/chat/timings/route");
    const response = await POST(post(JSON.stringify(batch)));
    expect(response.status).toBe(204);
    expect(mock.insert).toHaveBeenCalledWith([
      { metric: "room_switch", value: 180, room: "social", device: "desktop" },
      { metric: "wrong_landing", value: 0, room: "main", device: "desktop" },
    ]);
  });
  it("quietly ignores invalid batches before auth or the database", async () => {
    const { POST } = await import("@/app/api/chat/timings/route");
    const text = JSON.stringify({ device: "desktop", rows: [{ m: "room_switch", v: 1, r: "main", body: "secret message" }] });
    expect((await POST(post(text))).status).toBe(204);
    expect(mock.auth).not.toHaveBeenCalled();
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it("rejects foreign origins", async () => {
    const { POST } = await import("@/app/api/chat/timings/route");
    expect((await POST(post(JSON.stringify(batch), "https://evil.test"))).status).toBe(403);
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it("drops batches from signed-out callers", async () => {
    mock.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    const { POST } = await import("@/app/api/chat/timings/route");
    expect((await POST(post(JSON.stringify(batch)))).status).toBe(204);
    expect(mock.insert).not.toHaveBeenCalled();
  });
  it("rate-limits one caller", async () => {
    const { POST } = await import("@/app/api/chat/timings/route");
    for (let i = 0; i < 20; i++) await POST(post(JSON.stringify(batch), "https://longboard.test", "10.9.9.9"));
    expect(mock.insert).toHaveBeenCalledTimes(12);
  });
  it("stays quiet and backs off while the table does not exist", async () => {
    mock.insert.mockResolvedValue({ error: { code: "PGRST205", message: "missing" } });
    const { POST } = await import("@/app/api/chat/timings/route");
    expect((await POST(post(JSON.stringify(batch)))).status).toBe(204);
    expect((await POST(post(JSON.stringify(batch)))).status).toBe(204);
    expect(mock.insert).toHaveBeenCalledTimes(1);
  });
  it("GET returns the server clock", async () => {
    const { GET } = await import("@/app/api/chat/timings/route");
    const body = await (await GET()).json();
    expect(Math.abs(body.now - Date.now())).toBeLessThan(1000);
  });
});

describe("GET /api/chat/timings/stats", () => {
  const get = (auth?: string) =>
    new NextRequest("https://longboard.test/api/chat/timings/stats?days=7", { headers: auth ? { authorization: auth } : {} });
  it("needs the read token or an admin", async () => {
    vi.stubEnv("CHAT_TIMINGS_READ_TOKEN", "read-token-for-tests");
    mock.requireAdmin.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    const { GET } = await import("@/app/api/chat/timings/stats/route");
    expect((await GET(get("Bearer wrong"))).status).toBe(401);
    expect((await GET(get())).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("returns daily median and p95 per metric and device", async () => {
    vi.stubEnv("CHAT_TIMINGS_READ_TOKEN", "read-token-for-tests");
    mock.rpc.mockResolvedValue({
      data: [
        { day: "2026-10-15", metric: "send_visible", device: "phone", samples: "40", median: 412.5, p95: 1210.2, wrong_share: 1 },
        { day: "2026-10-15", metric: "wrong_landing", device: "desktop", samples: 9, median: 0, p95: 36, wrong_share: 0.111 },
      ],
      error: null,
    });
    const { GET } = await import("@/app/api/chat/timings/stats/route");
    const response = await GET(get("Bearer read-token-for-tests"));
    expect(response.status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("chat_timings_daily", { p_days: 7 });
    expect(await response.json()).toEqual({
      days: 7,
      timezone: "America/Chicago",
      ready: true,
      rows: [
        { day: "2026-10-15", metric: "send_visible", device: "phone", samples: 40, median: 413, p95: 1210 },
        { day: "2026-10-15", metric: "wrong_landing", device: "desktop", samples: 9, median: 0, p95: 36, wrongShare: 0.111 },
      ],
    });
  });
  it("reports not ready before the migration", async () => {
    mock.requireAdmin.mockResolvedValue({ ok: true, user: { id: "a", email: "a@example.invalid", role: "admin" } });
    mock.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
    const { GET } = await import("@/app/api/chat/timings/stats/route");
    expect(await (await GET(get())).json()).toMatchObject({ ready: false, rows: [] });
  });
});

describe("GET /api/cron/chat-timings", () => {
  it("deletes rows older than 30 days with the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "cron-for-tests");
    const { GET } = await import("@/app/api/cron/chat-timings/route");
    const unauthorized = await GET(new NextRequest("https://longboard.test/api/cron/chat-timings"));
    expect(unauthorized.status).toBe(401);
    const response = await GET(
      new NextRequest("https://longboard.test/api/cron/chat-timings", { headers: { authorization: "Bearer cron-for-tests" } }),
    );
    expect(await response.json()).toEqual({ deleted: 3 });
    const cutoff = Date.parse(mock.del.mock.calls[0][1]);
    expect(Math.abs(Date.now() - 30 * 86_400_000 - cutoff)).toBeLessThan(5_000);
    expect(mock.del.mock.calls[0][0]).toBe("created_at");
  });
});
