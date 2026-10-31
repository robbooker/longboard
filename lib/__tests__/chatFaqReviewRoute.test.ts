import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #338: Marketing HQ's review endpoint: its own bearer secret, refused when unset, and one decision a suggestion.
const mock = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin }));

import * as route from "@/app/api/chat/faq/suggestions/review/route";

const WRITE = "w".repeat(40);
const READ = "r".repeat(40);
const ID = "11111111-1111-4111-8111-111111111111";
const actor = { id: "member-1", name: "Rob" };
const approve = { id: ID, action: "approve", actor, question: "Q?", topic: "T", answer: "A" };
const reject = { id: ID, action: "reject", actor };
const call = (body: unknown, authorization: string | undefined = `Bearer ${WRITE}`) =>
  route.POST(new NextRequest("https://www.longboardai.com/api/chat/faq/suggestions/review", { method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN", WRITE);
  vi.stubEnv("CHAT_FAQ_SUGGESTIONS_READ_TOKEN", READ);
  mock.rpc.mockResolvedValue({ data: { outcome: "approved", status: "approved", itemId: "x" }, error: null });
  mock.admin.mockReturnValue({ rpc: mock.rpc });
});
afterEach(() => vi.unstubAllEnvs());

describe("who gets in", () => {
  it.each([["unset", undefined], ["empty", ""], ["blank", "     "], ["too short", "short"], ["the read token", READ]])("refuses everyone when the secret is %s", async (_label, value) => {
    if (value === undefined) delete process.env.CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN;
    else vi.stubEnv("CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN", value);
    for (const header of [undefined, `Bearer ${value ?? ""}`, "Bearer undefined", `Bearer ${WRITE}`]) expect((await call(approve, header)).status).toBe(503);
    expect(mock.admin).not.toHaveBeenCalled();
  });
  it.each([
    ["no header", ""],
    ["the read token", `Bearer ${READ}`],
    ["the wrong secret, same length", `Bearer ${"x".repeat(40)}`],
    ["a prefix", `Bearer ${WRITE.slice(0, 39)}`],
    ["the secret plus more", `Bearer ${WRITE}x`],
    ["another scheme", `Basic ${WRITE}`],
  ])("gives 401 for %s, touching nothing", async (_label, header) => {
    const res = await call(approve, header);
    expect(res.status).toBe(401);
    expect(mock.admin).not.toHaveBeenCalled();
  });
  it("compares in constant time and has only POST", async () => {
    const source = (await import("node:fs")).readFileSync("app/api/chat/faq/suggestions/review/route.ts", "utf8");
    expect(source).toContain("timingSafeEqual(digest(given), digest(secret))");
    expect(Object.keys(route).filter((name) => /^[A-Z]+$/.test(name))).toEqual(["POST"]);
  });
});

describe("a review", () => {
  it("approves with the final text and the named admin", async () => {
    const res = await call(approve);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mock.rpc).toHaveBeenCalledWith("review_chat_faq_suggestion", { p_id: ID, p_action: "approve", p_actor_name: "Rob", p_actor_ref: "member-1", p_question: "Q?", p_topic: "T", p_answer: "A" });
  });
  it("rejects with no text, ignoring any sent", async () => {
    mock.rpc.mockResolvedValue({ data: { outcome: "rejected", status: "rejected" }, error: null });
    expect((await call({ ...reject, question: "ignored", answer: "ignored" })).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("review_chat_faq_suggestion", { p_id: ID, p_action: "reject", p_actor_name: "Rob", p_actor_ref: "member-1", p_question: null, p_topic: null, p_answer: null });
  });
  it.each([{ answer: "" }, { topic: "" }, { question: "" }, { actor: undefined }, { action: "publish" }])("refuses %j without calling the database", async (bad) => {
    expect((await call({ ...approve, ...bad })).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("treats a repeat of the same decision as fine, and tells who did it", async () => {
    mock.rpc.mockResolvedValue({ data: { outcome: "already", status: "approved", by: "Liz", at: "2026-10-31T12:00:00Z" }, error: null });
    const res = await call(approve);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "already", status: "approved", by: "Liz", at: "2026-10-31T12:00:00Z" });
  });
  it("calls the opposite decision a conflict", async () => {
    mock.rpc.mockResolvedValue({ data: { outcome: "already", status: "rejected", by: "Liz", at: "2026-10-31T12:00:00Z" }, error: null });
    expect((await call(approve)).status).toBe(409);
  });
  it("says when a suggestion is gone, or invalid to the database", async () => {
    expect((await call({ ...approve, id: "nope" })).status).toBe(404);
    mock.rpc.mockResolvedValue({ data: null, error: { message: "faq_suggestion_not_found" } });
    expect((await call(approve)).status).toBe(404);
    mock.rpc.mockResolvedValue({ data: null, error: { message: "invalid_faq_review" } });
    expect((await call(approve)).status).toBe(400);
  });
  it("gives no database detail when it fails", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    let res = await call(approve);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "review_unavailable" });
    mock.rpc.mockRejectedValue(new Error("network detail"));
    res = await call(approve);
    expect(await res.json()).toEqual({ error: "review_unavailable" });
    mock.admin.mockReturnValue(null);
    expect((await call(approve)).status).toBe(503);
  });
});
