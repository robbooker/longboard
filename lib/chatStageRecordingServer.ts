// #524: the database side of an ended notice's recording link (lib/chatStageRecording.ts has the rules).
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { createChatAdminClient } from "./chatAdmin";
import { publishRoomEvent } from "./chatRealtimePublish";
import { composeStageEndedNotice } from "./chatStageNotice";
import { stageRoomName } from "./chatStageNotify";
import { latestStageBroadcast } from "./chatStageNotifyServer";
import { stageRecordingFits, stageRecordingFromPost } from "./chatStageRecording";
import type { ChatRoom } from "./publicChat";

/**
 * Sets, changes or (url null) removes the recording on one ended notice, and rewrites its words.
 * false: there is no such ended notice in that room, or (onlyIfEmpty) somebody got there first.
 * Everyone showing the room reloads it. Nobody is notified: no bell entry, no phone notification.
 */
export async function setStageRecording(
  db: SupabaseClient,
  room: ChatRoom,
  noticeId: string,
  url: string | null,
  by: { source: "post" | "admin"; onlyIfEmpty?: boolean },
): Promise<boolean> {
  const { data, error } = await db.rpc("chat_stage_broadcast_recording", {
    p_id: noticeId,
    p_room: room,
    p_url: url,
    p_body: composeStageEndedNotice(stageRoomName(room), url),
    p_source: by.source,
    p_only_if_empty: by.onlyIfEmpty === true,
  });
  if (error) throw new Error("stage_recording_failed");
  if (data === true) await publishRoomEvent(room, { kind: "changed", topics: ["history"] });
  return data === true;
}

/** A post that has just landed in a recordings room: its link goes onto the room's last broadcast when it fits. */
export async function attachStageRecordingFromPost(db: SupabaseClient, postRoom: ChatRoom, body: string, postedAt: number): Promise<boolean> {
  const found = stageRecordingFromPost(postRoom, body);
  if (!found) return false;
  const last = await latestStageBroadcast(db, found.room);
  if (!last || !stageRecordingFits(last, postedAt)) return false;
  return setStageRecording(db, found.room, last.id, found.url, { source: "post", onlyIfEmpty: true });
}

/**
 * Called by the route that saved a room post. Does nothing at all unless the post is in LB
 * Recordings or SS Recordings and has a YouTube or Loom link; then, after the response is sent, it
 * tries the attach above. Best effort: it never throws, and the post is already saved and answered.
 */
export function stageRecordingAfterPost(postRoom: ChatRoom, body: string, createdAt: string | null | undefined): void {
  if (!stageRecordingFromPost(postRoom, body)) return;
  const run = async () => {
    try {
      const db = createChatAdminClient();
      if (db) await attachStageRecordingFromPost(db, postRoom, body, Date.parse(createdAt ?? "") || Date.now());
    } catch {
      console.info("[chat-stage] recording-attach-failed");
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
