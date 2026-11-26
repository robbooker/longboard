// #502 Stage mode's live video: the pieces that need no LiveKit library (settings, names, the
// "is this room live" memory and who may do what). The LiveKit calls themselves are in
// lib/chatStageLiveKit.ts, behind the small StageVideoApi below so tests can stand in for LiveKit.
//
// Nothing is stored in the database: LiveKit is the record. #512: a room has ONE permanent RTMP
// ingress (its stream address and key), made the first time an admin opens the room's "Live video"
// card and then reused for good, so StreamYard is set up once per room. The room is "live" while
// that ingress is publishing; starting and stopping in StreamYard is the whole control.
// Never log an API key, secret, viewer token or stream key from here or from the routes.
import { parseChatRoom, type ChatRoom } from "./publicChat";
import { parseStageOnScreen, type StageOnScreen, type StageState } from "./chatStageLive";

export type StageVideoConfig = { url: string; apiKey: string; apiSecret: string };

/**
 * The three server-only settings. Any one missing (or CHAT_STAGE_MODE=off) and live video is off
 * everywhere: no status checks, no badge, no token, and the stage is the admin preview as before.
 */
export function stageVideoConfig(env: Record<string, string | undefined> = process.env): StageVideoConfig | null {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return null;
  if (!/^(wss?|https?):\/\/[^\s/]+/i.test(url)) return null;
  if (env.CHAT_STAGE_MODE?.trim().toLowerCase() === "off") return null;
  return { url, apiKey, apiSecret };
}

/** The address a browser connects to (wss://…). */
export const stageVideoSocketUrl = (config: StageVideoConfig) => config.url.replace(/^http/i, "ws");
/** The address this server calls LiveKit's API at (https://…). */
export const stageVideoApiUrl = (config: StageVideoConfig) => config.url.replace(/^ws/i, "http");

/** The LiveKit room for a chat room: always "chat-<room slug>", so nothing has to be remembered. */
export const stageVideoRoom = (room: ChatRoom) => `chat-${room}`;
export const chatRoomOfStageVideoRoom = (name: unknown): ChatRoom | null =>
  typeof name === "string" && name.startsWith("chat-") ? parseChatRoom(name.slice(5)) : null;
/** Who the broadcast (StreamYard, through the ingress) is in the LiveKit room. */
export const STAGE_BROADCAST_IDENTITY = "stage-broadcast";

/** One RTMP ingress as this app uses it. `streamKey` is a secret: admins only, never logged. */
export type StageIngress = {
  id: string;
  url: string;
  streamKey: string;
  publishing: boolean;
  /** #503: when LiveKit says this broadcast began (ms), if it says. The same for every server that asks. */
  startedAt?: number;
  /** #512: when this ingress was last broadcast to (a broadcast starting or stopping, ms), if LiveKit says. */
  activeAt?: number;
};

/** What this app asks of LiveKit. lib/chatStageLiveKit.ts is the real one. */
export interface StageVideoApi {
  ingresses(videoRoom: string): Promise<StageIngress[]>;
  createIngress(videoRoom: string): Promise<StageIngress>;
  deleteIngress(id: string): Promise<void>;
  /** #507: the LiveKit room's metadata ("" when it has none), or null when there is no such room. */
  roomMetadata(videoRoom: string): Promise<string | null>;
  /** #507: sets the LiveKit room's metadata, making the room first when nobody has joined it yet. */
  setRoomMetadata(videoRoom: string, metadata: string): Promise<void>;
  viewerToken(videoRoom: string, identity: string, name: string): Promise<string>;
}

/**
 * Publishing: live. Set up (the room's ingress exists) and not publishing: waiting, which since
 * #512 is where a room rests between broadcasts. No ingress yet: off.
 */
export function stageStateOf(ingresses: readonly Pick<StageIngress, "publishing">[]): StageState {
  if (!ingresses.length) return "off";
  return ingresses.some((ingress) => ingress.publishing) ? "live" : "waiting";
}

/** How long one answer from LiveKit is reused by this server (like the radio playout's few seconds). */
export const STAGE_STATE_MEMORY_MS = 4_000;

/**
 * One answer per room, asked of LiveKit at most once per window by this server however many members
 * ask; requests that arrive during a read wait for that read. A failed read is remembered as
 * `failed` for the same window, so a LiveKit outage is not hammered either.
 */
function roomMemory<T>(failed: T) {
  const remembered = new Map<ChatRoom, { at: number; value: T }>();
  const reading = new Map<ChatRoom, Promise<T>>();
  return {
    shared(room: ChatRoom, read: () => Promise<T>, now = Date.now()): Promise<T> {
      const known = remembered.get(room);
      if (known && now >= known.at && now - known.at < STAGE_STATE_MEMORY_MS) return Promise.resolve(known.value);
      const pending = reading.get(room);
      if (pending) return pending;
      const current: Promise<T> = read()
        .catch((): T => failed)
        .then((value) => {
          // Aged from when the read began. Skipped if the room was forgotten (started or ended) meanwhile.
          if (reading.get(room) === current) remembered.set(room, { at: now, value });
          return value;
        })
        .finally(() => {
          if (reading.get(room) === current) reading.delete(room);
        });
      reading.set(room, current);
      return current;
    },
    forget(room?: ChatRoom) {
      if (room) {
        remembered.delete(room);
        reading.delete(room);
      } else {
        remembered.clear();
        reading.clear();
      }
    },
  };
}
const stateMemory = roomMemory<StageState>("off");
const onScreenMemory = roomMemory<StageOnScreen | null>(null);

/** Whether a room is live (see roomMemory: one read per few seconds per room; a failed read is "off"). */
export const sharedStageState = (room: ChatRoom, read: () => Promise<StageState>, now = Date.now()) =>
  stateMemory.shared(room, read, now);
/** #507: the stock on screen in a room, remembered the same way (a failed read: nothing known). */
export const sharedStageOnScreen = (room: ChatRoom, read: () => Promise<StageOnScreen | null>, now = Date.now()) =>
  onScreenMemory.shared(room, read, now);

/** Forget what is remembered (after a new or reset key, a new stock on screen, a LiveKit webhook, and in tests). */
export function forgetStageState(room?: ChatRoom) {
  stateMemory.forget(room);
  onScreenMemory.forget(room);
  // #521: since when the broadcast has been stopped is only trusted while nothing else has happened.
  if (room) stoppedSince.delete(room);
  // (The once-a-minute look at a room's message keeps its own time; only "forget everything" resets it.)
  if (!room) {
    noticeChecks.clear();
    stoppedSince.clear();
    noticeFollowUps.clear();
  }
}

/** #512: how often one server looks again at a room's "live now" message with nothing having hinted. */
export const STAGE_NOTICE_CHECK_MS = 60_000;
const noticeChecks = new Map<ChatRoom, { at: number; state: StageState }>();

/**
 * #512: nobody presses End any more, so a broadcast's end is known only from LiveKit: its webhook,
 * and, in case that is missed, the status itself. Called with each answer read from LiveKit for the
 * status (never a remembered one): true when the room's "live now" message should be brought in
 * line with it (lib/chatStageNotify.ts), which is when this server sees the state change, and
 * otherwise once a minute. A room that has never been set up has no message and asks for nothing.
 */
export function stageNoticeCheckDue(room: ChatRoom, state: StageState, now = Date.now()): boolean {
  const last = noticeChecks.get(room);
  // #521: when this server itself saw the broadcast stop (live, then not), it knows since when.
  if (state !== "waiting") stoppedSince.delete(room);
  else if (last?.state === "live" && !stoppedSince.has(room)) stoppedSince.set(room, now);
  if (last && last.state === state && now >= last.at && now - last.at < STAGE_NOTICE_CHECK_MS) return false;
  noticeChecks.set(room, { at: now, state });
  return state !== "off" || (!!last && last.state !== "off");
}

// #521: a look at a room's message runs after the response, and can be lost: the function is
// recycled while it waits out the grace, or the page that asked had already gone (closed tab,
// navigation) by the time the look was queued, and then it never starts. The once-a-minute rule
// above had already counted it as done, and players that have let go ask the status nothing more,
// so the message could say "live" for as long as nobody caused another look. So each look is
// remembered here until it reports back; one that has not reported back in time is run again by the
// next status answer for that room (fresh or remembered: no extra LiveKit read to decide).
const stoppedSince = new Map<ChatRoom, number>();
const noticeFollowUps = new Map<ChatRoom, { dueAt: number; tries: number }>();
/** A look that was run again and still has not reported back is tried again this much later... */
export const STAGE_NOTICE_FOLLOW_UP_GAP_MS = 10_000;
/** ...this many times at most. After that the once-a-minute look is all there is, as before. */
export const STAGE_NOTICE_FOLLOW_UP_TRIES = 6;

/**
 * A look at the room's message is starting: if none has reported back `within` ms from now, one is
 * due again. (A look started while another is still owed takes over its time, so two never run a
 * moment apart; the count of tries is kept.)
 */
export function stageNoticeLookStarted(room: ChatRoom, within: number, now = Date.now()) {
  noticeFollowUps.set(room, { dueAt: now + within, tries: noticeFollowUps.get(room)?.tries ?? 0 });
}
/** A look reported back (whatever it found): nothing is owed any more. */
export function stageNoticeLookDone(room: ChatRoom) {
  noticeFollowUps.delete(room);
}
/** True when a look for this room never reported back and should be run again now. Bounded: see above. */
export function stageNoticeFollowUpDue(room: ChatRoom, now = Date.now()): boolean {
  const owed = noticeFollowUps.get(room);
  if (!owed || now < owed.dueAt) return false;
  if (owed.tries >= STAGE_NOTICE_FOLLOW_UP_TRIES) {
    noticeFollowUps.delete(room);
    return false;
  }
  // (The look this starts sets its own time when it begins: stageNoticeLookStarted.)
  noticeFollowUps.set(room, { dueAt: now + STAGE_NOTICE_FOLLOW_UP_GAP_MS, tries: owed.tries + 1 });
  return true;
}
/** How long ago this server saw the room's broadcast stop (ms), or null when it did not see it. */
export function stageStoppedFor(room: ChatRoom, now = Date.now()): number | null {
  const since = stoppedSince.get(room);
  return since === undefined || now < since ? null : now - since;
}

/** One read of a room's state from LiveKit. */
export const readStageState = async (api: StageVideoApi, room: ChatRoom) =>
  stageStateOf(await api.ingresses(stageVideoRoom(room)));

/**
 * #512: the one ingress a room uses, of those LiveKit has for it. There is normally exactly one.
 * With more (made by hand, or by two admins opening a new room at the same moment): the one that is
 * broadcasting; otherwise the one most recently broadcast to (the key that is in StreamYard);
 * otherwise, none ever used, the first in LiveKit's own order, which is the one the admin card has
 * always shown. LiveKit keeps no creation time for an ingress, so "newest" cannot be asked of it.
 * Nothing is ever deleted here.
 */
export function stageIngressOf<T extends Pick<StageIngress, "publishing" | "activeAt">>(ingresses: readonly T[]): T | undefined {
  return ingresses.reduce<T | undefined>((best, next) => {
    if (!best) return next;
    if (best.publishing !== next.publishing) return next.publishing ? next : best;
    return (next.activeAt ?? 0) > (best.activeAt ?? 0) ? next : best;
  }, undefined);
}

/** What an admin is shown: the room's ingress, and how many other ingresses LiveKit has for the room. */
export type StageKey = { ingress: StageIngress; created: boolean; extra: number };

// Two requests on one server for a room with no ingress yet make it once.
const making = new Map<ChatRoom, Promise<StageIngress>>();

/**
 * #512: the room's permanent stream address and key. Whatever ingress LiveKit already has for the
 * room is reused, always (so a key already pasted into StreamYard keeps working); one is made only
 * when the room has none. Never deletes anything.
 */
export async function stageKeyFor(api: StageVideoApi, room: ChatRoom): Promise<StageKey> {
  const videoRoom = stageVideoRoom(room);
  const existing = await api.ingresses(videoRoom);
  const ingress = stageIngressOf(existing);
  if (ingress) return { ingress, created: false, extra: existing.length - 1 };
  let pending = making.get(room);
  if (!pending) {
    pending = api.createIngress(videoRoom).finally(() => making.delete(room));
    making.set(room, pending);
  }
  return { ingress: await pending, created: true, extra: 0 };
}

/** #512: the same, read only: null when the room has not been set up yet. */
export async function readStageKey(api: StageVideoApi, room: ChatRoom): Promise<StageKey | null> {
  const existing = await api.ingresses(stageVideoRoom(room));
  const ingress = stageIngressOf(existing);
  return ingress ? { ingress, created: false, extra: existing.length - 1 } : null;
}

/**
 * #512 "Reset key": every ingress LiveKit has for the room is deleted (the old key stops working at
 * once, and a broadcast using it is cut off), then a new one is made. The LiveKit room itself is
 * left alone: whoever is watching stays, and sees the broadcast stop.
 */
export async function resetStageKey(api: StageVideoApi, room: ChatRoom): Promise<StageKey> {
  const videoRoom = stageVideoRoom(room);
  for (const ingress of await api.ingresses(videoRoom)) await api.deleteIngress(ingress.id);
  return { ingress: await api.createIngress(videoRoom), created: true, extra: 0 };
}

// #507: the stock on screen. It lives in the LiveKit room's metadata as {"onScreen":"APUS","at":<ms>}
// ({"onScreen":null,…} once cleared), so nothing is stored in the database and someone who opens the
// stage later reads the same thing. It goes when the LiveKit room does (LiveKit closes a room once
// everyone has left it).

/** The metadata to save for a stock on screen (null: cleared). */
export const stageOnScreenMetadata = (onScreen: StageOnScreen) => JSON.stringify({ onScreen: onScreen.symbol, at: onScreen.at });

/** What a LiveKit room's metadata says is on screen; null when it says nothing (or it is not ours). */
export function stageOnScreenOfMetadata(metadata: string | null | undefined): StageOnScreen | null {
  if (!metadata) return null;
  try {
    const value = JSON.parse(metadata) as { onScreen?: unknown; at?: unknown } | null;
    return value && typeof value === "object" && "onScreen" in value ? parseStageOnScreen({ symbol: value.onScreen, at: value.at }) : null;
  } catch {
    return null;
  }
}

/** One read of what is on screen in a room, from LiveKit. */
export const readStageOnScreen = async (api: StageVideoApi, room: ChatRoom) =>
  stageOnScreenOfMetadata(await api.roomMetadata(stageVideoRoom(room)));

/**
 * The host sets (or, with null, clears) the stock on screen. Only for a room that has been set up
 * (its ingress exists, which since #512 is from the first time an admin opened its "Live video"
 * card): otherwise null comes back and nothing is saved.
 */
export async function setStageOnScreen(api: StageVideoApi, room: ChatRoom, symbol: string | null, now = Date.now()): Promise<StageOnScreen | null> {
  const videoRoom = stageVideoRoom(room);
  if (!(await api.ingresses(videoRoom)).length) return null;
  const onScreen: StageOnScreen = { symbol, at: now };
  await api.setRoomMetadata(videoRoom, stageOnScreenMetadata(onScreen));
  return onScreen;
}

/**
 * A viewer's identity in the LiveKit room: the member's id, plus a short per-connection suffix.
 * LiveKit disconnects an earlier connection with the same identity, so without the suffix a member
 * watching in two tabs (or on a computer and a phone) would keep knocking themselves off.
 */
export const stageViewerIdentity = (memberId: string, connection: string) => `${memberId}#${connection}`;
/** The member behind a viewer identity (for counting people rather than tabs). */
export const stageViewerMember = (identity: string) => identity.split("#")[0];

/** The few fields of a LiveKit webhook this app reads (after its signature has been checked). */
export type StageWebhookEvent = { id: string; event: string; room: string; participant: string };

/**
 * What a LiveKit webhook means for a chat room: its live video (probably) came on, or went off.
 * Only LiveKit rooms named "chat-<room>" count, and only events about the room, its ingress or the
 * broadcast itself; a viewer joining or leaving means nothing here. The answer is a hint for what
 * to do next: whether the room IS live is always read from LiveKit (sharedStageState).
 */
export function stageWebhookChange(event: StageWebhookEvent): { room: ChatRoom; live: boolean } | null {
  const room = chatRoomOfStageVideoRoom(event.room);
  if (!room) return null;
  const broadcast = event.participant === STAGE_BROADCAST_IDENTITY;
  switch (event.event) {
    case "ingress_started":
    case "room_started":
      return { room, live: true };
    case "track_published":
      return broadcast ? { room, live: true } : null;
    case "ingress_ended":
    case "room_finished":
      return { room, live: false };
    case "participant_left":
      return broadcast ? { room, live: false } : null;
    default:
      return null;
  }
}

/** LiveKit retries and can repeat a webhook: each event id is acted on once (per server instance). */
const WEBHOOK_MEMORY = 500;
const seenWebhooks = new Set<string>();
export function stageWebhookIsNew(id: string) {
  if (!id) return true;
  if (seenWebhooks.has(id)) return false;
  if (seenWebhooks.size >= WEBHOOK_MEMORY) seenWebhooks.delete(seenWebhooks.values().next().value!);
  seenWebhooks.add(id);
  return true;
}
/** For tests. */
export const forgetStageWebhooks = () => seenWebhooks.clear();
