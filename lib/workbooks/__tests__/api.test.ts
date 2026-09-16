import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getWorkbook } from "../definitions";
import { emptyResponse } from "../responses";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.auth }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
import { GET, PUT } from "@/app/api/workbooks/[slug]/route";

const context = () => ({ params: Promise.resolve({ slug: "act-your-way" }) });
const response = emptyResponse(getWorkbook("act-your-way")!);
const request = (body: unknown, origin = "http://localhost") => new NextRequest("http://localhost/api/workbooks/act-your-way", {
  method: "PUT", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});

function database(result: unknown) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue(result), single: vi.fn().mockResolvedValue(result), insert: vi.fn(), update: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.insert.mockReturnValue(query); query.update.mockReturnValue(query);
  mocks.client.mockResolvedValue({ from: vi.fn().mockReturnValue(query) });
  return query;
}

beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ ok: true, user: { id: "owner" } }); });
describe("workbook API", () => {
  it("requires a verified account for reads and writes", async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401 });
    expect((await GET(new NextRequest("http://localhost"), context())).status).toBe(401);
    expect((await PUT(request({ response, revision: 0 }), context())).status).toBe(401);
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("does not turn load errors into empty workbooks", async () => {
    database({ data: null, error: { code: "offline" } });
    expect((await GET(new NextRequest("http://localhost"), context())).status).toBe(503);
  });
  it("returns an empty workbook only when no row exists", async () => {
    const query = database({ data: null, error: null });
    const result = await GET(new NextRequest("http://localhost"), context());
    expect(await result.json()).toEqual({ response, revision: 0, updatedAt: null });
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(result.headers.get("cache-control")).toContain("no-store");
  });
  it("derives ownership from auth and compares the saved revision", async () => {
    const query = database({ data: { revision: 3, updated_at: "today" }, error: null });
    expect((await PUT(request({ response, revision: 2, user_id: "impostor" }), context())).status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(query.eq).toHaveBeenCalledWith("revision", 2);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ revision: 3, response }));
  });
  it("rejects stale updates and racing first saves", async () => {
    database({ data: null, error: null });
    expect((await PUT(request({ response, revision: 1 }), context())).status).toBe(409);
    database({ data: null, error: { code: "23505" } });
    expect((await PUT(request({ response, revision: 0 }), context())).status).toBe(409);
  });
  it("rejects foreign origins, unknown workbooks and malformed payloads", async () => {
    expect((await PUT(request({ response, revision: 0 }, "https://elsewhere.test"), context())).status).toBe(403);
    expect((await PUT(request({ response, revision: -1 }), context())).status).toBe(400);
    expect((await PUT(request(null), context())).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost"), { params: Promise.resolve({ slug: "missing" }) })).status).toBe(404);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
