// #482: every database read and write AI Insights makes, behind one small interface, so the daily
// job and the answers are tested with an in-memory store. The database's own rules (once per day,
// once per reply, the limits, who may post) are in 20261121130000_chat_ai_insights.sql.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_INSIGHTS_MAX_MESSAGES, type ChatRow, type ThreadMessage } from "@/lib/chatAiInsights";
import type { ChatRoom } from "@/lib/publicChat";

export type PostResult = {
  status: string;
  messageId?: string;
  noteMessageId?: string | null;
  message?: Record<string, unknown>;
};
export type ClaimResult = {
  status: "answer" | "limit_note" | "duplicate" | "capped" | "room_capped" | "not_eligible";
  day?: string;
  rootId?: string;
};
export type StoredMessage = ChatRow & {
  room_slug: string;
  member_id?: string | null;
  guest_id?: string | null;
};
export type Writeup = { day: string; messageId: string; body: string };

export type AiInsightsStore = {
  dayRecord(day: string): Promise<{ messageId: string; noteMessageId: string | null } | null>;
  roomMessages(room: ChatRoom, start: Date, end: Date): Promise<ChatRow[]>;
  postWriteup(day: string, body: string, messageCount: number, model: string): Promise<PostResult>;
  postNote(day: string, body: string): Promise<PostResult>;
  message(id: string): Promise<StoredMessage | null>;
  tagsMembers(messageId: string): Promise<boolean>;
  /** The write-up that started this thread, else the latest one on or before that New York day. */
  writeupFor(rootId: string, onOrBefore: string): Promise<Writeup | null>;
  thread(rootId: string, upTo: string): Promise<ThreadMessage[]>;
  claim(triggerId: string, memberCap: number, roomCap: number): Promise<ClaimResult>;
  postAnswer(triggerId: string, body: string): Promise<PostResult>;
  failAnswer(triggerId: string): Promise<void>;
};

const MESSAGE_COLUMNS =
  "id, room_slug, author_label, body, created_at, reply_to_id, answered_id, attachment_ids, bot_slug, agent_id, member_id, guest_id, deleted_at, removed";
const PAGE = 1000;
/** How much of a long thread the model reads: its first message and the latest replies. */
const THREAD_REPLIES = 40;

function fail(what: string, error: { message?: string } | null): never {
  throw new Error(`ai_insights_${what}${error?.message ? `: ${error.message}` : ""}`);
}

export function supabaseAiInsightsStore(db: SupabaseClient): AiInsightsStore {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) fail(fn, error);
    return data as Record<string, unknown>;
  };
  const one = async (id: string) => {
    const { data, error } = await db
      .from("longboard_chat_messages")
      .select(MESSAGE_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error) fail("message", error);
    return (data as StoredMessage | null) ?? null;
  };
  return {
    async dayRecord(day) {
      const { data, error } = await db
        .from("chat_ai_insights_days")
        .select("message_id, note_message_id")
        .eq("day", day)
        .maybeSingle();
      if (error) fail("day", error);
      return data
        ? {
            messageId: data.message_id as string,
            noteMessageId: (data.note_message_id as string | null) ?? null,
          }
        : null;
    },
    async roomMessages(room, start, end) {
      const rows: ChatRow[] = [];
      for (let from = 0; from < AI_INSIGHTS_MAX_MESSAGES + PAGE; from += PAGE) {
        const { data, error } = await db
          .from("longboard_chat_messages")
          .select(MESSAGE_COLUMNS)
          .eq("room_slug", room)
          .is("deleted_at", null)
          .eq("removed", false)
          .gte("created_at", start.toISOString())
          .lt("created_at", end.toISOString())
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) fail("messages", error);
        rows.push(...((data ?? []) as ChatRow[]));
        if (!data || data.length < PAGE) break;
      }
      return rows;
    },
    async postWriteup(day, body, messageCount, model) {
      return (await rpc("post_chat_ai_insights_writeup", {
        p_day: day,
        p_body: body,
        p_message_count: messageCount,
        p_model: model,
      })) as PostResult;
    },
    async postNote(day, body) {
      return (await rpc("post_chat_ai_insights_note", { p_day: day, p_body: body })) as PostResult;
    },
    message: one,
    async tagsMembers(messageId) {
      const { data, error } = await db
        .from("chat_message_tags")
        .select("member_id")
        .eq("message_id", messageId)
        .limit(1);
      if (error) fail("tags", error);
      return (data ?? []).length > 0;
    },
    async writeupFor(rootId, onOrBefore) {
      let { data, error } = await db
        .from("chat_ai_insights_days")
        .select("day, message_id")
        .eq("message_id", rootId)
        .maybeSingle();
      if (error) fail("writeup", error);
      if (!data) {
        ({ data, error } = await db
          .from("chat_ai_insights_days")
          .select("day, message_id")
          .lte("day", onOrBefore)
          .order("day", { ascending: false })
          .limit(1)
          .maybeSingle());
        if (error) fail("writeup", error);
      }
      if (!data) return null;
      const post = await one(data.message_id as string);
      return post && !post.deleted_at && !post.removed
        ? { day: data.day as string, messageId: post.id, body: post.body }
        : null;
    },
    async thread(rootId, upTo) {
      const root = await one(rootId);
      const { data, error } = await db
        .from("longboard_chat_messages")
        .select(MESSAGE_COLUMNS)
        .eq("reply_to_id", rootId)
        .is("deleted_at", null)
        .eq("removed", false)
        .lte("created_at", upTo)
        .order("created_at", { ascending: false })
        .limit(THREAD_REPLIES);
      if (error) fail("thread", error);
      const replies = ((data ?? []) as ThreadMessage[]).reverse();
      return root && !root.deleted_at ? [root as ThreadMessage, ...replies] : replies;
    },
    async claim(triggerId, memberCap, roomCap) {
      return (await rpc("claim_chat_ai_insights_answer", {
        p_trigger: triggerId,
        p_member_cap: memberCap,
        p_room_cap: roomCap,
      })) as ClaimResult;
    },
    async postAnswer(triggerId, body) {
      return (await rpc("post_chat_ai_insights_answer", {
        p_trigger: triggerId,
        p_body: body,
      })) as PostResult;
    },
    async failAnswer(triggerId) {
      const { error } = await db.rpc("fail_chat_ai_insights_answer", { p_trigger: triggerId });
      if (error) fail("fail_answer", error);
    },
  };
}
