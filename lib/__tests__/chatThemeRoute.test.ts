import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
const { auth, admin, origin } = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: admin, requestOriginAllowed: origin }));
import { GET, POST } from "@/app/api/chat/theme/route";

const member = { ok: true, user: { id: "acct-1" }, access: { longboard: true, shortscout: false, admin: false } };
function fakeDb(saved: unknown = undefined, failing = false) {
  const upsert = vi.fn().mockResolvedValue({ error: failing ? { message: "down" } : null });
  const eq = vi.fn();
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => (eq(...args), query),
    maybeSingle: vi
      .fn()
      .mockResolvedValue(
        failing ? { data: null, error: { message: "down" } } : { data: saved === undefined ? null : { theme: saved }, error: null },
      ),
  };
  const from = vi.fn(() => ({ ...query, upsert }));
  return { db: { from }, upsert, eq, from };
}
const post = (body: unknown) =>
  POST(new NextRequest("https://chat.test/api/chat/theme", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const get = () => GET(new NextRequest("https://chat.test/api/chat/theme"));

describe("chat theme route (#407)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    origin.mockReturnValue(true);
    auth.mockResolvedValue(member);
  });

  it("refuses signed-out callers before touching the database", async () => {
    auth.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    expect((await get()).status).toBe(401);
    expect((await post({ theme: "terminal" })).status).toBe(401);
    expect(admin).not.toHaveBeenCalled();
  });

  it("refuses writes from another site", async () => {
    origin.mockReturnValue(false);
    expect((await post({ theme: "terminal" })).status).toBe(403);
    expect(auth).not.toHaveBeenCalled();
  });

  it("reads the signed-in account's theme, null when never chosen", async () => {
    const saved = fakeDb("terminal");
    admin.mockReturnValue(saved.db);
    const response = await get();
    expect(await response.json()).toEqual({ theme: "terminal" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(saved.from).toHaveBeenCalledWith("chat_activity_preferences");
    expect(saved.eq).toHaveBeenCalledWith("account_id", "acct-1");
    admin.mockReturnValue(fakeDb().db);
    expect(await (await get()).json()).toEqual({ theme: null });
    // A value that isn't a theme any more reads as not chosen.
    admin.mockReturnValue(fakeDb("sepia").db);
    expect(await (await get()).json()).toEqual({ theme: null });
  });

  it("saves only the theme, for the signed-in account and never one named in the body", async () => {
    const { db, upsert } = fakeDb();
    admin.mockReturnValue(db);
    const response = await post({ theme: "blade-runner", account_id: "someone-else" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ theme: "blade-runner" });
    expect(upsert).toHaveBeenCalledWith({ account_id: "acct-1", theme: "blade-runner" }, { onConflict: "account_id" });
  });

  it("rejects anything that isn't one of the chat themes", async () => {
    const { db, upsert } = fakeDb();
    admin.mockReturnValue(db);
    for (const body of [{ theme: "sepia" }, { theme: "Terminal" }, { theme: null }, {}, "not json", { theme: ["dark"] }])
      expect((await post(body)).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports the database being unavailable", async () => {
    admin.mockReturnValue(fakeDb(undefined, true).db);
    expect((await get()).status).toBe(503);
    expect((await post({ theme: "dark" })).status).toBe(503);
    admin.mockReturnValue(null);
    expect((await get()).status).toBe(503);
  });
});
