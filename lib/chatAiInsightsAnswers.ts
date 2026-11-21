// #482 AI Insights, answers: after a member's reply in AI Insights is saved, decide whether it is for
// the AI (lib/chatAiInsights.ts replyWantsAi), claim it once within the daily limits, and answer in the
// same thread with the thread, that day's write-up and that day's SS room as context.
import {
  AI_INSIGHTS_LIMIT_NOTE,
  AI_INSIGHTS_MEMBER_CAP,
  AI_INSIGHTS_ROOM_CAP,
  aiInsightsDayWindow,
  buildAnswerPrompt,
  finishAnswer,
  replyWantsAi,
  unverifiedPrices,
  type ChatRow,
} from "@/lib/chatAiInsights";
import { AI_INSIGHTS_BOT } from "@/lib/chatAiInsightsText";
import { claudeAiInsightsModel, type AiInsightsModel } from "@/lib/chatAiInsightsModel";
import { supabaseAiInsightsStore, type AiInsightsStore } from "@/lib/chatAiInsightsStore";
import { createChatAdminClient } from "@/lib/chatAdmin";
import { publishRoomEvent } from "@/lib/chatRealtimePublish";
import { easternDateKey } from "@/lib/chatSummary";
import type { Publish } from "@/lib/chatAiInsightsServer";

export type AnswerResult = { status: string; messageId?: string };

const defaultPublish: Publish = (room, row) =>
  publishRoomEvent(room, { kind: "message", eventType: "INSERT", row });

export async function answerAiInsightsReply(
  messageId: string,
  deps: { store?: AiInsightsStore; model?: AiInsightsModel; publish?: Publish } = {},
): Promise<AnswerResult> {
  let store = deps.store;
  if (!store) {
    const db = createChatAdminClient();
    if (!db) return { status: "unavailable" };
    store = supabaseAiInsightsStore(db);
  }
  const model = deps.model ?? claudeAiInsightsModel;
  const publish = deps.publish ?? defaultPublish;

  const reply = await store.message(messageId);
  if (
    !reply ||
    reply.room_slug !== "ai-insights" ||
    !reply.reply_to_id ||
    reply.bot_slug ||
    reply.agent_id ||
    !reply.guest_id ||
    reply.deleted_at ||
    reply.removed
  )
    return { status: "not_eligible" };
  const root = await store.message(reply.reply_to_id);
  if (!root) return { status: "not_eligible" };
  const target = reply.answered_id ? await store.message(reply.answered_id) : root;
  const wanted = replyWantsAi({
    targetIsAi: target?.bot_slug === AI_INSIGHTS_BOT,
    toThreadStart: !reply.answered_id,
    tagsMembers: await store.tagsMembers(reply.id),
    body: reply.body,
  });
  if (!wanted) return { status: "not_for_ai" };

  const claim = await store.claim(reply.id, AI_INSIGHTS_MEMBER_CAP, AI_INSIGHTS_ROOM_CAP);
  if (claim.status === "limit_note") return post(store, publish, reply.id, AI_INSIGHTS_LIMIT_NOTE);
  if (claim.status !== "answer") return { status: claim.status };

  try {
    const writeup = await store.writeupFor(root.id, claim.day ?? easternDateKey(new Date(reply.created_at)));
    let dayRows: ChatRow[] = [];
    if (writeup) {
      const { start, end } = aiInsightsDayWindow(writeup.day);
      dayRows = await store.roomMessages("shortscout", start, end);
    }
    const thread = await store.thread(root.id, reply.created_at);
    const base = {
      day: writeup?.day ?? null,
      writeup: writeup?.body ?? null,
      dayRows,
      thread,
      triggerId: reply.id,
    };
    let prompt = buildAnswerPrompt(base);
    let text = await model({
      system: prompt.system,
      context: prompt.context,
      user: prompt.user,
      kind: "answer",
    });
    let missing = unverifiedPrices(text, prompt.sources);
    if (missing.length) {
      prompt = buildAnswerPrompt({ ...base, avoid: missing });
      text = await model({
        system: prompt.system,
        context: prompt.context,
        user: prompt.user,
        kind: "answer",
      });
      missing = unverifiedPrices(text, prompt.sources);
    }
    if (missing.length) {
      await store.failAnswer(reply.id);
      return { status: "unverified_prices" };
    }
    return await post(store, publish, reply.id, finishAnswer(text));
  } catch (error) {
    await store.failAnswer(reply.id).catch(() => undefined);
    throw error;
  }
}

async function post(
  store: AiInsightsStore,
  publish: Publish,
  triggerId: string,
  body: string,
): Promise<AnswerResult> {
  const posted = await store.postAnswer(triggerId, body);
  if (posted.status === "posted" && posted.message) await publish("ai-insights", posted.message);
  return { status: posted.status, messageId: posted.messageId };
}
