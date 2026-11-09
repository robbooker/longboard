import { beforeEach, describe, expect, it, vi } from "vitest";
// #384: the admin members API is for admins only, and checks what it's given.
const m = vi.hoisted(() => ({ auth: vi.fn(), calls: [] as { table: string; op: string; value?: unknown }[], rows: {} as Record<string, unknown[]> }));
vi.mock("@/lib/auth", () => ({ requireAdmin: m.auth }));
vi.mock("@/lib/chatAdmin", () => {
  const query = (table: string) => {
    const chain: Record<string, unknown> = {};
    const result = () => Promise.resolve({ data: m.rows[table] ?? [], error: null });
    for (const name of ["select", "order", "limit", "ilike", "in", "eq", "is"]) chain[name] = (...args: unknown[]) => (m.calls.push({ table, op: name, value: args }), chain);
    chain.insert = (value: unknown) => (m.calls.push({ table, op: "insert", value }), chain);
    chain.update = (value: unknown) => (m.calls.push({ table, op: "update", value }), chain);
    chain.upsert = (value: unknown) => (m.calls.push({ table, op: "upsert", value }), (m.rows[table] = [{ id: "p-new", ...(value as object) }]), chain);
    chain.maybeSingle = () => Promise.resolve({ data: (m.rows[table] ?? [])[0] ?? null, error: null });
    chain.single = () => Promise.resolve({ data: (m.rows[table] ?? [])[0] ?? { id: "new" }, error: null });
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => result().then(resolve, reject);
    return chain;
  };
  return { createChatAdminClient: () => ({ from: query }), requestOriginAllowed: (r: Request) => !r.headers.get("origin") || r.headers.get("origin") === "https://chat.robbooker.com" };
});
import { GET } from "@/app/api/admin/members/route";
import { PATCH, POST } from "@/app/api/admin/members/entitlements/route";
import { NextRequest } from "next/server";

const admin = { ok: true, user: { id: "00000000-0000-4000-8000-000000000001", email: "rob@example.test", role: "admin" } };
const req = (method: string, body?: unknown, origin = "https://chat.robbooker.com") =>
  new NextRequest("https://chat.robbooker.com/api/admin/members/entitlements", { method, headers: { "content-type": "application/json", host: "chat.robbooker.com", origin }, body: body === undefined ? undefined : JSON.stringify(body) });
beforeEach(() => {
  m.calls = [];
  m.rows = {
    member_people: [{ id: "p1", email: "buyer@example.test", name: null, stripe_customer_id: null, chat_account_id: null, created_at: "2026-11-01T00:00:00Z" }],
    member_purchases: [],
    member_entitlements: [
      { id: "e1", person_id: "p1", entitlement_key: "gainers", starts_at: "2026-11-01T00:00:00Z", ends_at: null, revoked_at: null },
      { id: "e2", person_id: "p1", entitlement_key: "reader", starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-11-02T00:00:00Z", revoked_at: null },
    ],
    member_product_entitlements: [{ entitlement_key: "reader" }, { entitlement_key: "gainers" }, { entitlement_key: "gainers" }],
  };
  m.auth.mockResolvedValue(admin);
});

describe("auth", () => {
  it.each([
    [{ ok: false, status: 401, error: "unauthenticated" }, 401],
    [{ ok: false, status: 403, error: "admin_only" }, 403],
  ])("refuses %o", async (result, status) => {
    m.auth.mockResolvedValue(result);
    expect((await GET(new NextRequest("https://chat.robbooker.com/api/admin/members"))).status).toBe(status);
    expect((await POST(req("POST", { email: "a@example.test", key: "gainers" }))).status).toBe(status);
    expect((await PATCH(req("PATCH", { action: "revoke", id: "00000000-0000-4000-8000-000000000009" }))).status).toBe(status);
    expect(m.calls).toEqual([]);
  });
  it("refuses another site's form post", async () => {
    expect((await POST(req("POST", { email: "a@example.test", key: "gainers" }, "https://evil.example"))).status).toBe(403);
    expect(m.calls).toEqual([]);
  });
});

describe("admin", () => {
  it("lists members with their active keys and searches by email", async () => {
    const response = await GET(new NextRequest("https://chat.robbooker.com/api/admin/members?q=Buyer_"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.keys).toEqual(["gainers", "reader"]);
    expect(body.members[0]).toMatchObject({ email: "buyer@example.test", activeKeys: ["gainers"] });
    expect(body.members[0].entitlements.map((e: { active: boolean }) => e.active)).toEqual([true, false]);
    expect(m.calls).toContainEqual({ table: "member_people", op: "ilike", value: ["email", "%buyer\\_%"] });
  });
  it("grants by hand as admin, with the granting admin recorded", async () => {
    m.rows.member_people = [];
    const response = await POST(req("POST", { email: " New@Example.test ", key: "reader", ends_at: "2099-01-01", note: "comp" }));
    expect(response.status).toBe(200);
    expect(m.calls).toContainEqual({ table: "member_people", op: "upsert", value: expect.objectContaining({ email: "new@example.test" }) });
    expect(m.calls).toContainEqual({
      table: "member_entitlements",
      op: "insert",
      value: expect.objectContaining({ entitlement_key: "reader", granted_by: "admin", granted_by_user: admin.user.id, ends_at: "2099-01-01T00:00:00.000Z", note: "comp" }),
    });
  });
  it("checks the grant", async () => {
    expect((await POST(req("POST", { email: "nope", key: "reader" }))).status).toBe(400);
    expect((await POST(req("POST", { email: "a@example.test", key: "Not A Key" }))).status).toBe(400);
    expect((await POST(req("POST", { email: "a@example.test", key: "reader", ends_at: "2001-01-01" }))).status).toBe(400);
  });
  it("revokes as admin", async () => {
    m.rows.member_entitlements = [{ id: "00000000-0000-4000-8000-000000000009" }];
    expect((await PATCH(req("PATCH", { action: "revoke", id: "00000000-0000-4000-8000-000000000009" }))).status).toBe(200);
    expect(m.calls).toContainEqual({ table: "member_entitlements", op: "update", value: expect.objectContaining({ revoked_by: "admin", revoked_by_user: admin.user.id }) });
    expect((await PATCH(req("PATCH", { action: "delete", id: "00000000-0000-4000-8000-000000000009" }))).status).toBe(400);
    expect((await PATCH(req("PATCH", { action: "revoke", id: "x" }))).status).toBe(400);
    m.rows.member_entitlements = [];
    expect((await PATCH(req("PATCH", { action: "revoke", id: "00000000-0000-4000-8000-000000000009" }))).status).toBe(404);
  });
});
