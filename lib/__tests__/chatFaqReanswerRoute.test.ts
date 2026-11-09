import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// #344: a re-answer needs the write token, replaces only the draft, and leaves the old answer if the AI fails.
const mock = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn(), nano: vi.fn() }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mock.admin }));
vi.mock("@/lib/chatOpenAI", () => ({ runNanoChat: mock.nano }));

import * as route from "@/app/api/chat/faq/suggestions/reanswer/route";
import { FAQ_NOT_ENOUGH_INFO, parseFaqReview } from "@/lib/chatFaq";

const WRITE = "w".repeat(40);
const READ = "r".repeat(40);
const ID = "11111111-1111-4111-8111-111111111111";
const actor = { id: "member-1", name: "Rob" };
const call = (body: unknown, authorization: string | undefined = `Bearer ${WRITE}`) =>
  route.POST(new NextRequest("https://www.longboardai.com/api/chat/faq/suggestions/reanswer", { method: "POST", headers: authorization ? { authorization } : {}, body: JSON.stringify(body) }));

type Row = { topic: string; ai_answer: string | null } | null;
function fakeDb(suggestion: Row = { topic: "How do I pin a DM?", ai_answer: "Old draft" }, publicAnswer: string | null = null) {
  const writes: string[] = [];
  return {
    writes,
    rpc: mock.rpc,
    from(table: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve({ data: table === "chat_faq_suggestions" ? suggestion : publicAnswer ? { answer: publicAnswer } : null, error: null }),
        update: () => (writes.push(table), chain),
        insert: () => (writes.push(table), chain),
        delete: () => (writes.push(table), chain),
      };
      return chain;
    },
  };
}
const input = () => JSON.parse(mock.nano.mock.calls[0][0].input);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN", WRITE);
  vi.stubEnv("CHAT_FAQ_SUGGESTIONS_READ_TOKEN", READ);
  mock.admin.mockReturnValue(fakeDb());
  mock.nano.mockResolvedValue('{"topic":"Pinning","answer":"New answer","covered":true}');
  mock.rpc.mockResolvedValue({ data: { outcome: "reanswered", status: "pending", reanswerPending: false }, error: null });
});

describe("POST /api/chat/faq/suggestions/reanswer", () => {
  it("refuses without the write token, with the read token, and when not configured, before calling the AI", async () => {
    expect((await call({ id: ID, actor }, "")).status).toBe(401);
    expect((await call({ id: ID, actor }, `Bearer ${READ}`)).status).toBe(401);
    vi.stubEnv("CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN", READ);
    expect((await call({ id: ID, actor }, `Bearer ${READ}`)).status).toBe(503);
    vi.stubEnv("CHAT_FAQ_SUGGESTIONS_WRITE_TOKEN", "short");
    expect((await call({ id: ID, actor }, "Bearer short")).status).toBe(503);
    expect(mock.nano).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("re-answers without a note, saving through the one function and writing no table itself", async () => {
    const db = fakeDb();
    mock.admin.mockReturnValue(db);
    const res = await call({ id: ID, actor });
    expect(res.status).toBe(200);
    expect(input().adminNote).toBeUndefined();
    expect(input().question).toBe("How do I pin a DM?");
    expect(input().previousAnswer).toBe("Old draft");
    expect(mock.rpc).toHaveBeenCalledWith("reanswer_chat_faq_suggestion", { p_id: ID, p_actor_name: "Rob", p_actor_ref: "member-1", p_note: null, p_topic: "Pinning", p_answer: "New answer" });
    expect(db.writes).toEqual([]);
  });
  it("passes a note to the AI and to the history, and a correction shows in the new answer", async () => {
    mock.nano.mockImplementation(async ({ input: text }: { input: string }) => JSON.stringify({ topic: "Pinning", answer: `Use the ••• menu. (${JSON.parse(text).adminNote})`, covered: true }));
    await call({ id: ID, actor, note: "  It is the ••• menu  " });
    expect(input().adminNote).toBe("It is the ••• menu");
    const saved = mock.rpc.mock.calls[0][1];
    expect(saved.p_note).toBe("It is the ••• menu");
    expect(saved.p_answer).toContain("It is the ••• menu");
  });
  it("tells the AI what members read now, on an approved question", async () => {
    mock.admin.mockReturnValue(fakeDb({ topic: "Pins?", ai_answer: "First AI draft" }, "The public answer"));
    await call({ id: ID, actor });
    expect(input().previousAnswer).toBe("The public answer");
  });
  it("saves not enough information like any draft", async () => {
    mock.nano.mockResolvedValue('{"topic":"Polls","covered":false}');
    await call({ id: ID, actor });
    expect(mock.rpc.mock.calls[0][1].p_answer).toBe(FAQ_NOT_ENOUGH_INFO);
  });
  it.each([["an AI failure", () => Promise.reject(new Error("chat_ai_request_failed"))], ["an unusable reply", () => Promise.resolve("sorry")]])("leaves the old answer alone on %s", async (_label, reply) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mock.nano.mockImplementation(reply);
    const res = await call({ id: ID, actor, note: "a private note" });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("The old one is still here");
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("a private note");
  });
  it("refuses a bad body, a long note and a gone suggestion", async () => {
    expect((await call({ id: "nope", actor })).status).toBe(404);
    expect((await call({ id: ID })).status).toBe(400);
    expect((await call({ id: ID, actor, note: "x".repeat(1001) })).status).toBe(400);
    expect((await call({ id: ID, actor, note: 5 })).status).toBe(400);
    mock.admin.mockReturnValue(fakeDb(null));
    expect((await call({ id: ID, actor })).status).toBe(404);
    expect(mock.nano).not.toHaveBeenCalled();
  });
  it("gives no database detail when saving fails", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    const res = await call({ id: ID, actor });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "review_unavailable" });
  });
});

describe("approving", () => {
  it("refuses to publish not enough information", () => {
    const parsed = parseFaqReview({ id: ID, action: "approve", actor, question: "Q?", topic: "T", answer: FAQ_NOT_ENOUGH_INFO });
    expect(parsed.ok).toBe(false);
  });
});
