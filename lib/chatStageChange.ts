// #522/#523: what the server does when a room's broadcast may have started or stopped. Server only.
// One place for the LiveKit webhook, an admin's "Reset key" and an admin player's report, so that a
// change is acted on once: LiveKit reports a start or a stop as three events, and each used to tell
// the whole room and start its own look at the room's message.
// Nothing here is a timer that outlives its request: the waits run after the response, inside the
// route's own time limit, the way the message's own check does (lib/chatStageNotifyServer.ts).
import { after } from "next/server";
import { publishRoomEventAfterResponse } from "./chatRealtimePublish";
import { STAGE_GRACE_MS } from "./chatStageLink";
import { stageNoticeAfterResponse } from "./chatStageNotifyServer";
import { forgetStageState, readStageState, sharedStageState, stageStateNews, stageVideoRoom, type StageVideoApi } from "./chatStageVideo";
import type { StageState } from "./chatStageLive";
import type { ChatRoom } from "./publicChat";

/** How the waits below wait. A unit test replaces `wait` so nothing really sleeps. */
export const stageChangeTiming = { wait: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
const sleep = (ms: number) => stageChangeTiming.wait(ms);
/** After the response when there is one (never failing the caller); at once in tests and scripts. */
function afterResponse(run: () => Promise<unknown>) {
  const safe = () => run().catch(() => undefined);
  try {
    after(safe);
  } catch {
    void safe();
  }
}

// One close per room at a time on this server, however many things report the same stop.
const closing = new Set<ChatRoom>();
// One second look per room at a time (see stageMayHaveChanged).
const rechecking = new Set<ChatRoom>();

/**
 * How long after a broadcast stops the server closes its LiveKit room: a little after the player's
 * own goodbye (STAGE_GRACE_MS, 25 seconds), so a well-behaved player has already left by itself
 * (and asked the status as it went, which the room's "ended" message relies on) and only what is
 * still connected is cut off. It is also past the 20 seconds the room's message waits before it
 * says the broadcast has ended (lib/chatStageNotify.ts STAGE_DROP_GRACE_MS).
 */
export const STAGE_CLOSE_AFTER_MS = STAGE_GRACE_MS + 5_000;

/**
 * #522: nobody lingers after a broadcast. The player's own 25-second goodbye runs in the browser
 * and cannot be relied on, so once a broadcast has been stopped for STAGE_CLOSE_AFTER_MS (one that
 * comes back within it is left alone) the LiveKit room is closed, which disconnects everyone still
 * in it. `graceMs` 0 (Reset key, which has just deleted the ingress): closed at once. The room's
 * stream key is not touched: the ingress is separate from the room, and LiveKit makes the room
 * again when the next broadcast or viewer joins. The stock on screen lives in the room and goes
 * with it, as it already did when a room emptied.
 */
export async function closeStageRoom(room: ChatRoom, api: StageVideoApi, graceMs = STAGE_CLOSE_AFTER_MS, wait: (ms: number) => Promise<void> = sleep): Promise<"closed" | "live" | "busy" | "failed"> {
  if (graceMs > 0) {
    if (closing.has(room)) return "busy";
    closing.add(room);
  }
  try {
    if (graceMs > 0) {
      await wait(graceMs);
      if ((await readStageState(api, room)) === "live") return "live";
    }
    await api.closeRoom(stageVideoRoom(room));
    // What this server remembered about the room (the stock on screen) went with it.
    forgetStageState(room);
    return "closed";
  } catch {
    // Never a key or an address in the log.
    console.info("[chat-stage] close-failed");
    return "failed";
  } finally {
    if (graceMs > 0) closing.delete(room);
  }
}
/** For tests: nothing is being closed or looked at again. */
export function forgetStageChanges() {
  closing.clear();
  rechecking.clear();
}
export const stageCloseAfterResponse = (room: ChatRoom, api: StageVideoApi, graceMs = STAGE_CLOSE_AFTER_MS) =>
  afterResponse(() => closeStageRoom(room, api, graceMs));

/** Everyone showing the room asks its status again (the signal carries no address or key), and its message is brought in line. */
function tell(room: ChatRoom, api: StageVideoApi, actor: string | null | undefined, stopped: boolean) {
  publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"] });
  stageNoticeAfterResponse(room, api, actor);
  if (stopped) stageCloseAfterResponse(room, api);
}

/** How long after an event that LiveKit's own answer did not yet bear out it is asked once more. */
export const STAGE_RECHECK_MS = 3_000;

/**
 * Something hints that the room's broadcast started or stopped (`expect`: which, when the hint
 * says). This server forgets what it remembered, reads the state from LiveKit, and acts only if
 * that state is not the one it last acted on: tells the room, has the room's message checked, and
 * after a stop closes the LiveKit room once the grace has passed.
 * When the read does not bear out the hint (LiveKit's event can arrive a moment before its own
 * answer changes), it is read once more a few seconds later, after the response.
 * A read that fails is treated as before #523: the room is told and the message checked, so a
 * LiveKit hiccup can never swallow a go-live.
 */
export async function stageMayHaveChanged(room: ChatRoom, api: StageVideoApi, options: { actor?: string | null; expect?: "live" | "stopped" } = {}): Promise<void> {
  forgetStageState(room);
  let state: StageState;
  try {
    state = await readStageState(api, room);
  } catch {
    return tell(room, api, options.actor, false);
  }
  // The answer just read serves the next few seconds of status requests on this server.
  void sharedStageState(room, async () => state);
  const act = (read: StageState) => {
    const news = stageStateNews(room, read);
    // A stop: this server had it live, or the event itself says the broadcast went.
    if (news) tell(room, api, options.actor, read !== "live" && (news.before === "live" || options.expect === "stopped"));
    return !!news;
  };
  if (act(state) || !options.expect || (options.expect === "live") === (state === "live") || rechecking.has(room)) return;
  rechecking.add(room);
  afterResponse(async () => {
    try {
      await sleep(STAGE_RECHECK_MS);
      forgetStageState(room);
      act(await readStageState(api, room));
    } finally {
      rechecking.delete(room);
    }
  });
}

/**
 * #512 "Reset key" has replaced the room's ingress: always told (admins' cards read the new key),
 * and the LiveKit room is closed at once, so nobody stays connected to a room whose broadcast was
 * cut off.
 */
export function stageKeyWasReset(room: ChatRoom, api: StageVideoApi, actor: string) {
  forgetStageState(room);
  stageStateNews(room, "waiting");
  publishRoomEventAfterResponse(room, { kind: "changed", topics: ["stage"] });
  stageNoticeAfterResponse(room, api, actor);
  stageCloseAfterResponse(room, api, 0);
}
