// #503 Stage mode: the database and after-the-response side of lib/chatStageNotify.ts.
// #524: the message is a Longboard Bot post and each broadcast has a row in chat_stage_broadcasts;
// both are written by the database functions of 20261126120000_chat_stage_broadcasts.sql, so a
// notice and its record can never part. A bell entry is a chat_room_mentions row (whose insert
// queues the phone notification, with the room's mute checked by the database then and again at
// delivery). Phones are sent by the push queue's own cron (every minute), not from here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { createChatAdminClient } from "./chatAdmin";
import { aiInsightsOrigin } from "./chatAiInsightsServer";
import { publishRoomEvent } from "./chatRealtimePublish";
import { isStageRoom } from "./chatStageLive";
import {
  STAGE_BELL_PAGE,
  STAGE_DROP_GRACE_MS,
  syncStageNotice,
  type StageBroadcast,
  type StageNoticeStore,
} from "./chatStageNotify";
import {
  forgetStageState,
  stageNoticeLookDone,
  stageNoticeLookStarted,
  stageStoppedFor,
  stageVideoRoom,
  type StageVideoApi,
} from "./chatStageVideo";
import type { ChatRoom } from "./publicChat";

const failed = (what: string): never => {
  throw new Error(`stage_notice_${what}`);
};
const time = (value: unknown) => (typeof value === "string" ? Date.parse(value) : NaN);
const BROADCAST_COLUMNS = "notice_id,started_at,last_live_at,ended_at,recording_url,recording_source,notified_at,created_at";
type BroadcastRow = Record<string, unknown>;
const broadcastOf = (row: BroadcastRow): StageBroadcast => ({
  id: String(row.notice_id),
  startedAt: time(row.started_at) || 0,
  lastLiveAt: time(row.last_live_at) || 0,
  endedAt: time(row.ended_at) || null,
  recordingUrl: typeof row.recording_url === "string" ? row.recording_url : null,
  recordingSource: row.recording_source === "post" || row.recording_source === "admin" ? row.recording_source : null,
  notifiedAt: time(row.notified_at) || null,
  createdAt: time(row.created_at) || 0,
});

/** #524: the room's most recently announced broadcast (one indexed read), or null. */
export async function latestStageBroadcast(db: SupabaseClient, room: ChatRoom): Promise<StageBroadcast | null> {
  const { data, error } = await db
    .from("chat_stage_broadcasts")
    .select(BROADCAST_COLUMNS)
    .eq("room_slug", room)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data) return failed("read");
  return data[0] ? broadcastOf(data[0] as BroadcastRow) : null;
}

/** `actor`: the admin whose own player or action reported the broadcast; they get no bell entry from this call. */
export function stageNoticeStore(db: SupabaseClient, actor?: string | null): StageNoticeStore {
  // Everyone showing the room reloads it (and their bell); never throws.
  const changed = (room: ChatRoom) => publishRoomEvent(room, { kind: "changed", topics: ["history"] });
  const call = async (name: string, args: Record<string, unknown>, what: string) => {
    const { data, error } = await db.rpc(name, args);
    if (error) return failed(what);
    return data as unknown;
  };
  return {
    latest: (room) => latestStageBroadcast(db, room),
    broadcast: async (id) => {
      const { data, error } = await db.from("chat_stage_broadcasts").select(BROADCAST_COLUMNS).eq("notice_id", id).limit(1);
      if (error || !data) return failed("read");
      return data[0] ? broadcastOf(data[0] as BroadcastRow) : null;
    },
    open: async (id, room, body, startedAt, staleBody) => {
      const { data, error } = await db.rpc("chat_stage_broadcast_open", {
        p_id: id,
        p_room: room,
        p_body: body,
        p_started_at: new Date(startedAt).toISOString(),
        p_stale_body: staleBody,
      });
      // 23505: the room already has an open broadcast, written by another server this very moment.
      if (error) return error.code === "23505" ? false : failed("post");
      const result = data as { posted?: boolean; closed?: number } | null;
      if (result?.posted === true || result?.closed) await changed(room);
      return result?.posted === true;
    },
    seen: async (id, at, gap) => {
      const { error } = await db
        .from("chat_stage_broadcasts")
        .update({ last_live_at: new Date(at).toISOString() })
        .eq("notice_id", id)
        .is("ended_at", null)
        .lt("last_live_at", new Date(at - gap).toISOString());
      if (error) return failed("seen");
    },
    close: async (room, id, body, endedAt) => {
      const closed = (await call("chat_stage_broadcast_close", { p_id: id, p_body: body, p_ended_at: new Date(endedAt).toISOString() }, "close")) === true;
      if (closed) await changed(room);
      return closed;
    },
    reopen: async (room, id, body) => {
      const { data, error } = await db.rpc("chat_stage_broadcast_reopen", { p_id: id, p_body: body });
      if (error) return error.code === "23505" ? false : failed("reopen");
      if (data === true) await changed(room);
      return data === true;
    },
    notifyPage: async (id, room) => {
      const result = (await call("chat_stage_broadcast_notify", { p_id: id, p_skip: actor ?? null, p_limit: STAGE_BELL_PAGE }, "notify")) as { done?: boolean; added?: number } | null;
      // The bells only: the rows arrived after the message's own signal.
      if (result?.added) await publishRoomEvent(room, { kind: "changed", topics: [] });
      return { done: result?.done === true };
    },
  };
}

/** #521: a look is owed again when it has not reported back this long after the grace it may have to wait out. */
const STAGE_NOTICE_LOOK_SLACK_MS = 2_000;

/**
 * After the response is sent: bring the room's "live now" message in line with LiveKit and, when
 * this call is the one that announced a new broadcast, write its bell entries (#524: the push
 * queue's cron sends the phones; nothing is drained here). Never throws and never delays the caller. `actor` is the admin whose action this is (they are not notified).
 * #512 `tellRoom`: for a caller that has not told the room anything itself (the status noticing
 * what a missed webhook would have said). When the message really changed here (a broadcast
 * announced, back, or over), everyone showing the room is told to ask its status again. The message
 * changes once however many servers look, so the room is told once.
 */
export function stageNoticeAfterResponse(room: ChatRoom, api: StageVideoApi, actor?: string | null, options?: { tellRoom?: boolean }): void {
  // #524: a room that does not offer live video has no notice (and no look is owed for it).
  if (!isStageRoom(room)) return;
  // #521: remembered until it reports back. A look that never does (see lib/chatStageVideo.ts) is
  // run again by the room's next status answer once the grace and a little more have passed.
  stageNoticeLookStarted(room, STAGE_DROP_GRACE_MS + STAGE_NOTICE_LOOK_SLACK_MS);
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
          stoppedFor: () => stageStoppedFor(room),
          // #524: a webhook or an admin's action says "now"; the status noticing by itself (tellRoom) does not.
          timely: !options?.tellRoom,
        },
        room,
      );
      stageNoticeLookDone(room);
      if (options?.tellRoom && (result === "announced" || result === "resumed" || result === "ended")) {
        forgetStageState(room);
        await publishRoomEvent(room, { kind: "changed", topics: ["stage"] });
      }
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
