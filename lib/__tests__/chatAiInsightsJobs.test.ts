// #482 AI Insights: the daily job and the answers, on an in-memory store and a fake model. The real
// Anthropic API is never called (the model is a function the test passes in).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { runAiInsightsDay, type Publish } from "@/lib/chatAiInsightsServer";
import { answerAiInsightsReply } from "@/lib/chatAiInsightsAnswers";
import { AI_INSIGHTS_LIMIT_NOTE, AI_INSIGHTS_MEMBER_CAP, AI_INSIGHTS_MODEL, type ChatRow, type ThreadMessage } from "@/lib/chatAiInsights";
import { AI_INSIGHTS_FOOTER } from "@/lib/chatAiInsightsText";
import type { AiInsightsRequest } from "@/lib/chatAiInsightsModel";
import type { AiInsightsStore, ClaimResult, StoredMessage } from "@/lib/chatAiInsightsStore";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor() {
      throw new Error("the real Anthropic client must never be built in tests");
    }
  },
}));

const DAY = "2026-11-20";
const MEMBER = "member-1";

/** The database's rules, in memory: one write-up and one note a day, one claim per reply, the limits. */
function memoryStore() {
  const messages = new Map<string, StoredMessage>();
  const days = new Map<string, { messageId: string; noteMessageId: string | null }>();
  const answers = new Map<string, { day: string; member: string; kind: string; status: string }>();
  const tags = new Set<string>();
  const add = (m: Partial<StoredMessage> & { body: string }) => {
    const message: StoredMessage = {
      id: randomUUID(),
      room_slug: "shortscout",
      author_label: "Dana",
      created_at: "2026-11-20T15:00:00.000Z",
      reply_to_id: null,
      guest_id: MEMBER,
      member_id: MEMBER,
      ...m,
    };
    messages.set(message.id, message);
    return message;
  };
  const insertBot = (room: string, body: string, reply?: string) => {
    const root = reply ? (messages.get(reply)?.reply_to_id ?? reply) : null;
    return add({ room_slug: room, author_label: "AI Insights", body, bot_slug: "ai-insights", guest_id: null, member_id: null, reply_to_id: root, answered_id: reply ?? null, created_at: new Date().toISOString() });
  };
  const store: AiInsightsStore = {
    dayRecord: async (day) => days.get(day) ?? null,
    roomMessages: async (room, start, end) =>
      [...messages.values()].filter((m) => m.room_slug === room && !m.deleted_at && !m.removed && m.created_at >= start.toISOString() && m.created_at < end.toISOString()) as ChatRow[],
    postWriteup: async (day, body) => {
      const existing = days.get(day);
      if (existing) return { status: "duplicate", messageId: existing.messageId, noteMessageId: existing.noteMessageId };
      const m = insertBot("ai-insights", body);
      days.set(day, { messageId: m.id, noteMessageId: null });
      return { status: "posted", messageId: m.id, message: { ...m } };
    },
    postNote: async (day, body) => {
      const d = days.get(day);
      if (!d) return { status: "no_writeup" };
      if (d.noteMessageId) return { status: "duplicate", messageId: d.noteMessageId };
      const m = insertBot("shortscout", body);
      d.noteMessageId = m.id;
      return { status: "posted", messageId: m.id, message: { ...m } };
    },
    message: async (id) => messages.get(id) ?? null,
    tagsMembers: async (id) => tags.has(id),
    writeupFor: async (rootId) => {
      for (const [day, d] of days) if (d.messageId === rootId) return { day, messageId: rootId, body: messages.get(rootId)!.body };
      return null;
    },
    thread: async (rootId) => [messages.get(rootId)!, ...[...messages.values()].filter((m) => m.reply_to_id === rootId)] as ThreadMessage[],
    claim: async (id, memberCap, roomCap): Promise<ClaimResult> => {
      const m = messages.get(id);
      if (!m || m.room_slug !== "ai-insights" || m.bot_slug || !m.reply_to_id) return { status: "not_eligible" };
      if (answers.has(id)) return { status: "duplicate" };
      const today = [...answers.values()].filter((a) => a.day === DAY);
      const used = today.filter((a) => a.member === m.member_id && a.kind === "answer").length;
      const status =
        today.filter((a) => a.kind !== "skipped").length >= roomCap
          ? "room_capped"
          : used >= memberCap
            ? today.some((a) => a.member === m.member_id && a.kind === "limit_note")
              ? "capped"
              : "limit_note"
            : "answer";
      answers.set(id, { day: DAY, member: m.member_id!, kind: status === "answer" || status === "limit_note" ? status : "skipped", status: "pending" });
      return { status, day: DAY, rootId: m.reply_to_id };
    },
    postAnswer: async (id, body) => {
      const a = answers.get(id);
      if (!a || a.status !== "pending") return { status: "not_pending" };
      a.status = "posted";
      const m = insertBot("ai-insights", body, id);
      return { status: "posted", messageId: m.id, message: { ...m } };
    },
    failAnswer: async (id) => {
      const a = answers.get(id);
      if (a?.status === "pending") a.status = "failed";
    },
  };
  return { store, messages, days, answers, tags, add };
}

const writeup = `**AI Insights · Friday, Nov 20**\nPriya shorted $ZPLX at $4.55.`;
function fakeModel(...texts: string[]) {
  const calls: AiInsightsRequest[] = [];
  const model = vi.fn(async (request: AiInsightsRequest) => {
    calls.push(request);
    return texts[Math.min(calls.length - 1, texts.length - 1)];
  });
  return { model, calls };
}
const chat = (s: ReturnType<typeof memoryStore>, n: number) => {
  for (let i = 0; i < n; i++)
    s.add({ body: `Priya short $ZPLX at $4.55 (${i})`, author_label: "Priya", created_at: new Date(Date.parse("2026-11-20T14:30:00Z") + i * 60_000).toISOString() });
};

describe("the daily write-up", () => {
  let s: ReturnType<typeof memoryStore>;
  let publish: ReturnType<typeof vi.fn<Publish>>;
  beforeEach(() => {
    s = memoryStore();
    publish = vi.fn<Publish>(async () => undefined);
  });
  const run = (model: ReturnType<typeof fakeModel>["model"], dryRun = false) =>
    runAiInsightsDay({ day: DAY, dryRun, store: s.store, model, publish, origin: "https://chat.test" });

  it("posts the write-up with the footer, then one note in SS that links to it", async () => {
    chat(s, 20);
    const { model, calls } = fakeModel(writeup);
    const result = await run(model);
    expect(result).toMatchObject({ status: "posted", day: DAY, messageCount: 20, note: "posted" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: "writeup" });
    expect(calls[0].user).toContain("Priya: Priya short $ZPLX at $4.55 (0)");
    const post = s.messages.get(s.days.get(DAY)!.messageId)!;
    expect(post).toMatchObject({ room_slug: "ai-insights", author_label: "AI Insights", reply_to_id: null });
    expect(post.body.endsWith(`*${AI_INSIGHTS_FOOTER}*`)).toBe(true);
    const note = s.messages.get(s.days.get(DAY)!.noteMessageId!)!;
    expect(note.room_slug).toBe("shortscout");
    expect(note.body).toBe(`Today's AI Insights are ready 👉 AI Insights: https://chat.test/chat?room=ai-insights#chat-message-${post.id}`);
    expect(publish.mock.calls.map((c) => c[0])).toEqual(["ai-insights", "shortscout"]);
  });

  it("posts at most once a day: a second run calls no model and posts nothing", async () => {
    chat(s, 20);
    await run(fakeModel(writeup).model);
    const again = fakeModel(writeup);
    expect(await run(again.model)).toMatchObject({ status: "already_posted", note: "duplicate" });
    expect(again.calls).toHaveLength(0);
    expect([...s.messages.values()].filter((m) => m.bot_slug === "ai-insights")).toHaveLength(2);
  });

  it("posts a note that failed earlier, once, on the next run", async () => {
    chat(s, 20);
    const postNote = s.store.postNote;
    s.store.postNote = async () => {
      throw new Error("longboard_chat_paused");
    };
    expect(await run(fakeModel(writeup).model)).toMatchObject({ status: "posted", note: "failed" });
    expect(s.days.get(DAY)!.noteMessageId).toBeNull();
    s.store.postNote = postNote;
    expect(await run(fakeModel(writeup).model)).toMatchObject({ status: "already_posted", note: "posted" });
    expect(await run(fakeModel(writeup).model)).toMatchObject({ status: "already_posted", note: "duplicate" });
  });

  it("skips a day with fewer than 15 member messages: no model, no post, no note", async () => {
    chat(s, 14);
    s.add({ body: "alert", bot_slug: "runner-watch", guest_id: null, member_id: null });
    const { model } = fakeModel(writeup);
    expect(await run(model)).toEqual({ status: "skipped", day: DAY, reason: "too_little_chat", messageCount: 14 });
    expect(model).not.toHaveBeenCalled();
    expect(s.days.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("only counts that New York day", async () => {
    chat(s, 14);
    s.add({ body: "late last night", created_at: "2026-11-20T04:59:00Z" }); // 11:59 PM on the 19th
    s.add({ body: "after midnight", created_at: "2026-11-21T05:00:00Z" }); // 12:00 AM on the 21st
    expect(await run(fakeModel(writeup).model)).toMatchObject({ status: "skipped", messageCount: 14 });
    s.add({ body: "11:59 PM", created_at: "2026-11-21T04:59:00Z" });
    expect(await run(fakeModel(writeup).model)).toMatchObject({ status: "posted", messageCount: 15 });
  });

  it("dry run returns the text and posts nothing, even on a day already posted", async () => {
    chat(s, 20);
    const result = await run(fakeModel(writeup).model, true);
    expect(result).toMatchObject({ status: "dry_run", messageCount: 20, unverifiedPrices: [] });
    expect(result.status === "dry_run" && result.text).toBe(`${writeup}\n\n*${AI_INSIGHTS_FOOTER}*`);
    expect(s.days.size).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    await run(fakeModel(writeup).model);
    expect(await run(fakeModel(writeup).model, true)).toMatchObject({ status: "dry_run" });
    expect([...s.messages.values()].filter((m) => m.bot_slug === "ai-insights")).toHaveLength(2);
  });

  it("asks again when a dollar figure is not in the chat, and posts the clean one", async () => {
    chat(s, 20);
    const { model, calls } = fakeModel(`${writeup} SSR at $87.30.`, writeup);
    expect(await run(model)).toMatchObject({ status: "posted" });
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain("not in the chat: $87.30");
  });

  it("never posts made-up figures: fails after the second try", async () => {
    chat(s, 20);
    const { model } = fakeModel(`${writeup} SSR at $87.30.`);
    expect(await run(model)).toEqual({ status: "failed", day: DAY, reason: "unverified_prices", unverifiedPrices: ["$87.30"] });
    expect(s.days.size).toBe(0);
    // The dry run still shows the text, with the figures named, so a sample can be checked.
    expect(await run(model, true)).toMatchObject({ status: "dry_run", unverifiedPrices: ["$87.30"] });
  });

  it("records the model and the message count", async () => {
    chat(s, 16);
    const spy = vi.spyOn(s.store, "postWriteup");
    await run(fakeModel(writeup).model);
    expect(spy).toHaveBeenCalledWith(DAY, expect.stringContaining("AI Insights"), 16, AI_INSIGHTS_MODEL);
  });
});

describe("answers in a write-up's thread", () => {
  let s: ReturnType<typeof memoryStore>;
  let root: StoredMessage;
  let publish: ReturnType<typeof vi.fn<Publish>>;
  beforeEach(async () => {
    s = memoryStore();
    chat(s, 20);
    publish = vi.fn<Publish>(async () => undefined);
    await runAiInsightsDay({ day: DAY, dryRun: false, store: s.store, model: fakeModel(writeup).model, publish: async () => undefined, origin: "https://chat.test" });
    root = s.messages.get(s.days.get(DAY)!.messageId)!;
  });
  const reply = (body: string, over: Partial<StoredMessage> = {}) =>
    s.add({ room_slug: "ai-insights", body, reply_to_id: root.id, created_at: "2026-11-21T01:40:00Z", author_label: "Priya", ...over });
  const answer = (id: string, model = fakeModel("Priya's entry was $4.55.").model) => answerAiInsightsReply(id, { store: s.store, model, publish });

  it("answers a reply to its post, in the same thread, with the thread, write-up and day as context", async () => {
    const q = reply("Why was $4.55 the entry?");
    const { model, calls } = fakeModel("Priya's entry was $4.55, right under the close.");
    const result = await answer(q.id, model);
    expect(result.status).toBe("posted");
    const a = s.messages.get(result.messageId!)!;
    expect(a).toMatchObject({ room_slug: "ai-insights", author_label: "AI Insights", bot_slug: "ai-insights", reply_to_id: root.id, answered_id: q.id });
    expect(a.body).toBe("Priya's entry was $4.55, right under the close.");
    expect(calls[0].kind).toBe("answer");
    expect(calls[0].context).toContain(`<writeup date="${DAY}">`);
    expect(calls[0].context).toContain("Priya short $ZPLX at $4.55 (0)");
    expect(calls[0].user).toContain("[ANSWER THIS]: Why was $4.55 the entry?");
    expect(publish).toHaveBeenCalledWith("ai-insights", expect.objectContaining({ id: a.id }));
  });

  it("answers each reply at most once", async () => {
    const q = reply("AI, what's a locate?");
    const first = fakeModel("A locate is a borrow.");
    await answer(q.id, first.model);
    const second = fakeModel("Again.");
    expect(await answer(q.id, second.model)).toEqual({ status: "duplicate" });
    expect(second.model).not.toHaveBeenCalled();
    expect([...s.messages.values()].filter((m) => m.answered_id === q.id)).toHaveLength(1);
  });

  it("answers a reply to its own answer, and @AI or a question by name between members", async () => {
    const q = reply("thanks");
    const own = s.add({ room_slug: "ai-insights", body: "Earlier answer", bot_slug: "ai-insights", reply_to_id: root.id, guest_id: null, member_id: null });
    const toAnswer = reply("and the float?", { answered_id: own.id });
    expect((await answer(toAnswer.id)).status).toBe("posted");
    const bob = reply("I covered at $4.15", { author_label: "Bob", member_id: "member-2", guest_id: "member-2" });
    expect((await answer(reply("@AI was that early?", { answered_id: bob.id }).id)).status).toBe("posted");
    expect((await answer(reply("Wren, was that early?", { answered_id: bob.id }).id)).status).toBe("posted");
    expect(q).toBeTruthy();
  });

  it("stays out of members talking to each other", async () => {
    const bob = reply("I covered at $4.15", { author_label: "Bob", member_id: "member-2", guest_id: "member-2" });
    const model = fakeModel("no");
    expect(await answer(reply("nice cover Bob", { answered_id: bob.id }).id, model.model)).toEqual({ status: "not_for_ai" });
    const tagged = reply("@Bob where did you cover?");
    s.tags.add(tagged.id);
    expect(await answer(tagged.id, model.model)).toEqual({ status: "not_for_ai" });
    expect(model.model).not.toHaveBeenCalled();
    expect(s.answers.size).toBe(0);
  });

  it("never answers its own messages, a new post, another room, a deleted reply or an agent", async () => {
    const own = s.add({ room_slug: "ai-insights", body: "x", bot_slug: "ai-insights", reply_to_id: root.id, guest_id: null, member_id: null });
    const model = fakeModel("no");
    expect(await answer(own.id, model.model)).toEqual({ status: "not_eligible" });
    expect(await answer(root.id, model.model)).toEqual({ status: "not_eligible" });
    expect(await answer(s.add({ room_slug: "shortscout", body: "AI?", reply_to_id: root.id }).id, model.model)).toEqual({ status: "not_eligible" });
    expect(await answer(reply("AI?", { deleted_at: "2026-11-21T01:41:00Z" }).id, model.model)).toEqual({ status: "not_eligible" });
    expect(await answer(reply("AI?", { agent_id: "agent" }).id, model.model)).toEqual({ status: "not_eligible" });
    expect(model.model).not.toHaveBeenCalled();
  });

  it(`stops at ${AI_INSIGHTS_MEMBER_CAP} answers a member a day, with one limit note`, async () => {
    const model = fakeModel("Sure.");
    for (let i = 0; i < AI_INSIGHTS_MEMBER_CAP; i++) expect((await answer(reply(`q ${i}`).id, model.model)).status).toBe("posted");
    const over = reply("one more");
    expect((await answer(over.id, model.model)).status).toBe("posted");
    const note = [...s.messages.values()].find((m) => m.answered_id === over.id)!;
    expect(note.body).toBe(AI_INSIGHTS_LIMIT_NOTE);
    expect(await answer(reply("and another").id, model.model)).toEqual({ status: "capped" });
    expect(model.model).toHaveBeenCalledTimes(AI_INSIGHTS_MEMBER_CAP);
    // Another member still gets answers.
    expect((await answer(reply("me too", { member_id: "member-2", guest_id: "member-2" }).id, model.model)).status).toBe("posted");
  });

  it("never posts made-up figures in an answer, and keeps the reply answered-once", async () => {
    const q = reply("What was the SSR price?");
    const { model, calls } = fakeModel("It was $87.30.");
    expect(await answer(q.id, model)).toEqual({ status: "unverified_prices" });
    expect(calls).toHaveLength(2);
    expect(calls[1].user).toContain("$87.30");
    expect(s.answers.get(q.id)!.status).toBe("failed");
    expect(await answer(q.id, model)).toEqual({ status: "duplicate" });
  });

  it("marks the claim failed when the model fails", async () => {
    const q = reply("AI?");
    const model = vi.fn(async () => {
      throw new Error("model_refused");
    });
    await expect(answerAiInsightsReply(q.id, { store: s.store, model, publish })).rejects.toThrow("model_refused");
    expect(s.answers.get(q.id)!.status).toBe("failed");
  });
});
