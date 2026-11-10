import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
const { auth, admin, origin } = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: admin, requestOriginAllowed: origin }));
import { GET, POST } from "@/app/api/chat/theme/route";

const member = { ok: true, user: { id: "acct-1" }, access: { longboard: true, shortscout: false, admin: false } };
/**
 * A stand-in for the preferences table. `row` is what the account has saved; "down" fails every
 * call; "no-palette" behaves like a database the #420 migration has not reached yet (the palette
 * column does not exist, so naming it is an error).
 */
function fakeDb(row: { theme?: unknown; palette?: unknown } | null = null, mode: "ok" | "down" | "no-palette" = "ok") {
  const down = { message: "down" },
    missing = { message: 'column "palette" does not exist' };
  const upsert = vi.fn((values: Record<string, unknown>) =>
    Promise.resolve({ error: mode === "down" ? down : mode === "no-palette" && "palette" in values ? missing : null }),
  );
  const eq = vi.fn();
  const from = vi.fn(() => {
    let columns = "";
    const query = {
      select: (list: string) => ((columns = list), query),
      eq: (...args: unknown[]) => (eq(...args), query),
      maybeSingle: () =>
        Promise.resolve(
          mode === "down"
            ? { data: null, error: down }
            : mode === "no-palette" && columns.includes("palette")
              ? { data: null, error: missing }
              : { data: row, error: null },
        ),
      upsert,
    };
    return query;
  });
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
    const saved = fakeDb({ theme: "terminal", palette: null });
    admin.mockReturnValue(saved.db);
    const response = await get();
    expect(await response.json()).toEqual({ theme: "terminal", palette: null });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(saved.from).toHaveBeenCalledWith("chat_activity_preferences");
    expect(saved.eq).toHaveBeenCalledWith("account_id", "acct-1");
    admin.mockReturnValue(fakeDb().db);
    expect(await (await get()).json()).toEqual({ theme: null, palette: null });
    // A value that isn't a theme any more reads as not chosen.
    admin.mockReturnValue(fakeDb({ theme: "sepia", palette: "ocean" }).db);
    expect(await (await get()).json()).toEqual({ theme: null, palette: null });
  });

  it("saves only the theme, for the signed-in account and never one named in the body", async () => {
    const { db, upsert } = fakeDb();
    admin.mockReturnValue(db);
    const response = await post({ theme: "blade-runner", account_id: "someone-else" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ theme: "blade-runner", palette: null });
    // A plain theme clears any colour combination saved before it (#420).
    expect(upsert).toHaveBeenCalledWith(
      { account_id: "acct-1", theme: "blade-runner", palette: null },
      { onConflict: "account_id" },
    );
  });

  it("rejects anything that isn't one of the chat themes", async () => {
    const { db, upsert } = fakeDb();
    admin.mockReturnValue(db);
    for (const body of [{ theme: "sepia" }, { theme: "Terminal" }, { theme: null }, {}, "not json", { theme: ["dark"] }])
      expect((await post(body)).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports the database being unavailable", async () => {
    admin.mockReturnValue(fakeDb(null, "down").db);
    expect((await get()).status).toBe(503);
    expect((await post({ theme: "dark" })).status).toBe(503);
    admin.mockReturnValue(null);
    expect((await get()).status).toBe(503);
  });
});

describe("chat theme route: colour combinations (#420)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    origin.mockReturnValue(true);
    auth.mockResolvedValue(member);
  });

  it("reads the combination saved on top of its base theme", async () => {
    admin.mockReturnValue(fakeDb({ theme: "dark", palette: "ocean" }).db);
    expect(await (await get()).json()).toEqual({ theme: "dark", palette: "ocean" });
    admin.mockReturnValue(fakeDb({ theme: "light", palette: "paper" }).db);
    expect(await (await get()).json()).toEqual({ theme: "light", palette: "paper" });
  });

  it("reads a removed combination, or one left under another theme, as the plain theme", async () => {
    admin.mockReturnValue(fakeDb({ theme: "dark", palette: "sepia" }).db);
    expect(await (await get()).json()).toEqual({ theme: "dark", palette: null });
    admin.mockReturnValue(fakeDb({ theme: "terminal", palette: "ocean" }).db);
    expect(await (await get()).json()).toEqual({ theme: "terminal", palette: null });
    admin.mockReturnValue(fakeDb({ theme: "light", palette: "ocean" }).db);
    expect(await (await get()).json()).toEqual({ theme: "light", palette: null });
  });

  it("saves a combination with its base theme", async () => {
    const { db, upsert } = fakeDb();
    admin.mockReturnValue(db);
    const response = await post({ theme: "light", palette: "rose" });
    expect(await response.json()).toEqual({ theme: "light", palette: "rose" });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({ account_id: "acct-1", theme: "light", palette: "rose" }, { onConflict: "account_id" });
  });

  it("saves the plain theme when the combination is unknown or belongs to another theme", async () => {
    for (const palette of ["sepia", "ocean", 7, { id: "rose" }, ""]) {
      const { db, upsert } = fakeDb();
      admin.mockReturnValue(db);
      expect(await (await post({ theme: "light", palette })).json()).toEqual({ theme: "light", palette: null });
      expect(upsert).toHaveBeenCalledWith({ account_id: "acct-1", theme: "light", palette: null }, { onConflict: "account_id" });
    }
  });

  it("before the migration reaches the database there is simply no combination", async () => {
    const old = fakeDb({ theme: "light" }, "no-palette");
    admin.mockReturnValue(old.db);
    expect(await (await get()).json()).toEqual({ theme: "light", palette: null });
    const response = await post({ theme: "dark", palette: "ocean" });
    expect(response.status).toBe(200);
    // The theme (the combination's base) is still saved; the answer says no combination was.
    expect(await response.json()).toEqual({ theme: "dark", palette: null });
    expect(old.upsert).toHaveBeenLastCalledWith({ account_id: "acct-1", theme: "dark" }, { onConflict: "account_id" });
  });
});
