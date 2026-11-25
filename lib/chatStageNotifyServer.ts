// #503 Stage mode: the database and after-the-response side of lib/chatStageNotify.ts. Every piece
// is existing plumbing: the message is a Longboard Bot post, a bell entry is a chat_room_mentions
// row (whose insert queues the phone notification, with the room's mute checked by the database
// then and again at delivery), and phones are sent by processChatPushJobs (the cron retries).
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { createChatAdminClient } from "./chatAdmin";
import { aiInsightsOrigin } from "./chatAiInsightsServer";
import { PUSH_JOBS_PER_RUN, processChatPushJobs } from "./chatPush";
import { publishRoomEvent } from "./chatRealtimePublish";
import { STAGE_NOTICE_BOT } from "./chatStageNotice";
import {
  stageNoticeRecipients,
  syncStageNotice,
  type StageNotice,
  type StageNoticeStore,
  type StageRecipientReads,
} from "./chatStageNotify";
import { stageVideoRoom, type StageVideoApi } from "./chatStageVideo";
import type { ChatRoom } from "./publicChat";

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const failed = (what: string): never => {
  throw new Error(`stage_notice_${what}`);
};
/** Every row of a read that can pass the 1,000-row page. */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, what: string) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error || !data) return failed(what);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

export function stageRecipientReads(db: SupabaseClient, actor?: string | null): StageRecipientReads {
  return {
    readers: async () => {
      const [owners, admins] = await Promise.all([
        db.from("longboard_chat_owners").select("user_id").limit(5),
        db.from("profiles").select("id").eq("role", "admin").limit(20),
      ]);
      const ids = [actor, ...(owners.data ?? []).map((row) => row.user_id), ...(admins.data ?? []).map((row) => row.id)];
      return [...new Set(ids.filter((id): id is string => typeof id === "string"))];
    },
    members: async (reader, room, cursor) => {
      const { data, error } = await db.rpc("longboard_chat_room_members", { p_user_id: reader, p_room: room, p_cursor: cursor, p_query: "" });
      return error || !Array.isArray(data) ? null : (data as { id: string }[]).map((row) => row.id);
    },
    accounts: async (memberIds) =>
      (
        await Promise.all(
          chunks(memberIds, 100).map(async (ids) => {
            const { data, error } = await db.from("longboard_chat_members").select("user_id").in("id", ids);
            return error || !data ? failed("accounts") : data.map((row) => row.user_id as string);
          }),
        )
      ).flat(),
    bots: async () =>
      (await allRows<{ account_id: string }>((from, to) => db.from("chat_bot_accounts").select("account_id").range(from, to), "bots")).map(
        (row) => row.account_id,
      ),
    quiet: async (room) =>
      (
        await allRows<{ account_id: string }>(
          (from, to) =>
            db.from("chat_room_notification_levels").select("account_id").eq("room_slug", room).in("level", ["mentions", "muted"]).range(from, to),
          "levels",
        )
      ).map((row) => row.account_id),
  };
}

const time = (value: unknown) => (typeof value === "string" ? Date.parse(value) : NaN);

export function stageNoticeStore(db: SupabaseClient, actor?: string | null): StageNoticeStore {
  // Everyone showing the room reloads it (and their bell); never throws.
  const changed = (room: ChatRoom) => publishRoomEvent(room, { kind: "changed", topics: ["history"] });
  return {
    notices: async (ids) => {
      const { data, error } = await db
        .from("longboard_chat_messages")
        .select("id,body,created_at,edited_at,revision")
        .eq("bot_slug", STAGE_NOTICE_BOT)
        .in("id", ids);
      if (error || !data) return failed("read");
      return data.map(
        (row): StageNotice => ({
          id: row.id,
          body: row.body,
          createdAt: time(row.created_at) || 0,
          editedAt: time(row.edited_at) || null,
          revision: Number(row.revision) || 0,
        }),
      );
    },
    post: async (id, room, body) => {
      const { data, error } = await db.rpc("post_chat_longboard_announcement", { p_id: id, p_room: room, p_body: body });
      if (error) return failed("post");
      const posted = (data as { posted?: boolean } | null)?.posted === true;
      if (posted) await changed(room);
      return posted;
    },
    rewrite: async (room, notice, body) => {
      const { data, error } = await db
        .from("longboard_chat_messages")
        .update({ body, edited_at: new Date().toISOString(), revision: notice.revision + 1 })
        .eq("id", notice.id)
        .eq("revision", notice.revision)
        .select("id");
      if (error) return failed("rewrite");
      if (data?.length) await changed(room);
      return !!data?.length;
    },
    recipients: (room) => stageNoticeRecipients(stageRecipientReads(db, actor), room, actor),
    notify: async (id, room, accounts) => {
      for (const group of chunks(accounts, 500)) {
        const { error } = await db
          .from("chat_room_mentions")
          .upsert(group.map((account) => ({ account_id: account, message_id: id, room_slug: room })), { onConflict: "account_id,message_id", ignoreDuplicates: true });
        if (error) return failed("notify");
      }
      // The bells only: the rows above arrived after the message's own signal.
      if (accounts.length) await publishRoomEvent(room, { kind: "changed", topics: [] });
    },
    withdraw: async (id) => {
      const { error } = await db.from("chat_room_mentions").delete().eq("message_id", id);
      if (error) return failed("withdraw");
    },
  };
}

/** Sends what the announcement queued, a few rounds at most; the push cron sends whatever is left. */
async function sendQueuedPushes() {
  for (let round = 0; round < 4; round++) if ((await processChatPushJobs()).processed < PUSH_JOBS_PER_RUN) return;
}

/**
 * After the response is sent: bring the room's "live now" message in line with LiveKit and, when
 * this call is the one that announced a new broadcast, send the phone notifications. Never throws
 * and never delays the caller. `actor` is the admin whose action this is (they are not notified).
 */
export function stageNoticeAfterResponse(room: ChatRoom, api: StageVideoApi, actor?: string | null): void {
  const run = async () => {
    try {
      const db = createChatAdminClient();
      if (!db) return;
      const result = await syncStageNotice(
        {
          store: stageNoticeStore(db, actor),
          ingresses: () => api.ingresses(stageVideoRoom(room)),
          wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          now: Date.now,
          origin: aiInsightsOrigin(),
        },
        room,
      );
      if (result === "announced") await sendQueuedPushes();
    } catch {
      // No message text, key or address is ever logged from here.
      console.info("[chat-stage] notice-failed");
    }
  };
  try {
    after(run);
  } catch {
    // Outside a request (tests, scripts).
    void run();
  }
}
