// #482 AI Insights, the daily write-up: read the New York day's SS room, ask Claude for the write-up,
// check its dollar figures against the chat, post it in AI Insights once, then post one note in SS
// that links to it. An admin's dry run does everything but post and returns the text.
import {
  AI_INSIGHTS_MODEL,
  aiInsightsDayWindow,
  buildTranscript,
  buildWriteupPrompt,
  finishWriteup,
  skipDecision,
  unverifiedPrices,
  validDay,
} from "@/lib/chatAiInsights";
import { composeAiInsightsNote } from "@/lib/chatAiInsightsText";
import type { AiInsightsModel } from "@/lib/chatAiInsightsModel";
import type { AiInsightsStore } from "@/lib/chatAiInsightsStore";
import type { ChatRoom } from "@/lib/publicChat";

/** Where the SS note's link points (the chat site). */
export function aiInsightsOrigin(env: Record<string, string | undefined> = process.env) {
  return (env.MEMBERS_CHAT_URL || "https://chat.robbooker.com").replace(/\/+$/, "");
}

export type Publish = (room: ChatRoom, row: Record<string, unknown>) => Promise<void>;

export type DayResult =
  | { status: "posted"; day: string; messageId: string; messageCount: number; note: string }
  | { status: "already_posted"; day: string; messageId: string; note: string }
  | { status: "skipped"; day: string; reason: "too_little_chat"; messageCount: number }
  | { status: "dry_run"; day: string; messageCount: number; text: string; unverifiedPrices: string[] }
  | { status: "failed"; day: string; reason: string; unverifiedPrices?: string[] };

/** A write-up longer than this is refused rather than cut (the room's limit is 10,000). */
const MAX_WRITEUP = 9_000;

async function postNote(
  store: AiInsightsStore,
  day: string,
  messageId: string,
  origin: string,
  publish: Publish,
) {
  try {
    const note = await store.postNote(day, composeAiInsightsNote(origin, messageId));
    if (note.status === "posted" && note.message) await publish("shortscout", note.message);
    return note.status;
  } catch (error) {
    // A paused SS room, say. The write-up stays posted; the note is not tried again today.
    console.error("[ai-insights] SS note failed", error instanceof Error ? error.message : error);
    return "failed";
  }
}

export async function runAiInsightsDay(input: {
  day: string;
  dryRun: boolean;
  store: AiInsightsStore;
  model: AiInsightsModel;
  publish: Publish;
  origin?: string;
}): Promise<DayResult> {
  const { day, dryRun, store, model, publish } = input;
  const origin = input.origin ?? aiInsightsOrigin();
  if (!validDay(day)) throw new Error("invalid_ai_insights_day");
  if (!dryRun) {
    const record = await store.dayRecord(day);
    if (record) {
      // Posted earlier: only the note can still be missing (its post failed then).
      const note = record.noteMessageId
        ? "duplicate"
        : await postNote(store, day, record.messageId, origin, publish);
      return { status: "already_posted", day, messageId: record.messageId, note };
    }
  }
  const { start, end } = aiInsightsDayWindow(day);
  const rows = await store.roomMessages("shortscout", start, end);
  const skip = skipDecision(rows);
  if (skip.skip) return { status: "skipped", day, reason: skip.reason, messageCount: skip.messageCount };

  const transcript = buildTranscript(rows).text;
  let prompt = buildWriteupPrompt(day, rows);
  let text = await model({ system: prompt.system, user: prompt.user, kind: "writeup" });
  let missing = unverifiedPrices(text, [transcript]);
  if (missing.length) {
    // One more try, told which figures were not in the chat.
    prompt = buildWriteupPrompt(day, rows, missing);
    text = await model({ system: prompt.system, user: prompt.user, kind: "writeup" });
    missing = unverifiedPrices(text, [transcript]);
  }
  const body = finishWriteup(text);
  if (dryRun)
    return {
      status: "dry_run",
      day,
      messageCount: prompt.messageCount,
      text: body,
      unverifiedPrices: missing,
    };
  if (missing.length)
    return { status: "failed", day, reason: "unverified_prices", unverifiedPrices: missing };
  if (body.length > MAX_WRITEUP) return { status: "failed", day, reason: "too_long" };

  const posted = await store.postWriteup(day, body, prompt.messageCount, AI_INSIGHTS_MODEL);
  if (!posted.messageId) return { status: "failed", day, reason: "post_failed" };
  if (posted.status !== "posted") {
    const note = posted.noteMessageId
      ? "duplicate"
      : await postNote(store, day, posted.messageId, origin, publish);
    return { status: "already_posted", day, messageId: posted.messageId, note };
  }
  if (posted.message) await publish("ai-insights", posted.message);
  const note = await postNote(store, day, posted.messageId, origin, publish);
  return { status: "posted", day, messageId: posted.messageId, messageCount: prompt.messageCount, note };
}
