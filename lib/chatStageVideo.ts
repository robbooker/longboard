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
/**
 * #522: the room a stage API request names, read strictly. parseChatRoom() answers "main" for a
 * missing room on purpose (page addresses); a stage request that names no room, or names it with
 * anything but text, names none (the route answers 400 invalid_room) so it can never act on LB by default.
 */
export const parseStageRoom = (value: unknown): ChatRoom | null => (typeof value === "string" && value ? parseChatRoom(value) : null);
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
  /** #522 `tab`: which page's player this connection is for (kept on the participant, see pickStageSeat). */
  viewerToken(videoRoom: string, identity: string, name: string, tab?: string): Promise<string>;
  /** #522: one viewer connection as LiveKit has it now, or null when nobody with that identity is in the room. */
  viewer(videoRoom: string, identity: string): Promise<StageSeatHolder | null>;
  /**
   * #522: disconnects one viewer (false: nobody with that identity was there). `revoke`: tokens for
   * that identity issued before now stop working too, so a held token cannot be used to walk back in.
   */
  removeViewer(videoRoom: string, identity: string, revoke?: boolean): Promise<boolean>;
  /** #522: closes the LiveKit room, disconnecting everyone still in it (nothing happens when there is none). */
  closeRoom(videoRoom: string): Promise<void>;
  /** #522: the names of the LiveKit rooms that exist right now. */
  videoRooms(): Promise<string[]>;
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
 * #523: how long "nothing is being broadcast" (waiting, or never set up) is reused for an ordinary
 * room open or switch. A room with a permanent key rests at "waiting" between broadcasts, so without
 * this every few seconds of ordinary chat traffic cost a LiveKit call. Whatever signals a change
 * (LiveKit's webhook, an admin's action) forgets the answer on the server that handles it, and a
 * page that asks BECAUSE of a signal (or to connect) is never answered from this long memory, only
 * from the few-second one. So this is the longest a LIVE button can be late, and only for a page
 * that opens the room, with no signal, on a server that has not heard yet.
 */
export const STAGE_SETTLED_MEMORY_MS = 30_000;

/**
 * One answer per room, asked of LiveKit at most once per window by this server however many members
 * ask; requests that arrive during a read wait for that read. A failed read is remembered as
 * `failed` for the same window, so a LiveKit outage is not hammered either.
 */
function roomMemory<T>(failed: T, settled: (value: T) => boolean = () => false) {
  const remembered = new Map<ChatRoom, { at: number; value: T; failed: boolean }>();
  const reading = new Map<ChatRoom, Promise<T>>();
  return {
    /** `longMemory`: this caller accepts a settled answer (see STAGE_SETTLED_MEMORY_MS). A failed read never is one. */
    shared(room: ChatRoom, read: () => Promise<T>, now = Date.now(), longMemory = false): Promise<T> {
      const known = remembered.get(room);
      if (known && now >= known.at) {
        const kept = longMemory && !known.failed && settled(known.value) ? STAGE_SETTLED_MEMORY_MS : STAGE_STATE_MEMORY_MS;
        if (now - known.at < kept) return Promise.resolve(known.value);
      }
      const pending = reading.get(room);
      if (pending) return pending;
      let ok = true;
      const current: Promise<T> = read()
        .catch((): T => {
          ok = false;
          return failed;
        })
        .then((value) => {
          // Aged from when the read began. Skipped if the room was forgotten (started or ended) meanwhile.
          if (reading.get(room) === current) remembered.set(room, { at: now, value, failed: !ok });
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
const stateMemory = roomMemory<StageState>("off", (state) => state !== "live");
const onScreenMemory = roomMemory<StageOnScreen | null>(null, () => true);

/**
 * Whether a room is live (see roomMemory: one read per few seconds per room; a failed read is "off").
 * #523 `longMemory`: only the status route's answer to an ordinary room open asks for it. Anything
 * that decides who may connect (the token and hand routes) and any read caused by a signal does not.
 */
export const sharedStageState = (room: ChatRoom, read: () => Promise<StageState>, now = Date.now(), options?: { longMemory?: boolean }) =>
  stateMemory.shared(room, read, now, options?.longMemory === true);
/**
 * #507: the stock on screen in a room, remembered the same way (a failed read: nothing known).
 * #523 `longMemory`: only for an admin's ordinary room open while nothing is being broadcast.
 */
export const sharedStageOnScreen = (room: ChatRoom, read: () => Promise<StageOnScreen | null>, now = Date.now(), options?: { longMemory?: boolean }) =>
  onScreenMemory.shared(room, read, now, options?.longMemory === true);

/** #523: forget only the stock on screen (the host changed it; the room's state did not change). */
export const forgetStageOnScreen = (room: ChatRoom) => onScreenMemory.forget(room);

/** Forget what is remembered (after a new or reset key, a LiveKit webhook, and in tests). */
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
  // #522/#523: likewise what this server last told the room and last read (for tests).
  if (!room) {
    toldStates.clear();
    readStates.clear();
  }
}

// #523: a broadcast starting or stopping reaches this server as several LiveKit events (and an
// admin's player reports it too). The room is told, and its message looked at, once per change:
// only when the state just read differs from the one this server last acted on.
const toldStates = new Map<ChatRoom, StageState>();
/**
 * Null when `state` is what this server last acted on for the room. Otherwise it is remembered, and
 * the answer says what it was before (`before` null: this server had not acted on the room yet).
 */
export function stageStateNews(room: ChatRoom, state: StageState): { before: StageState | null } | null {
  const before = toldStates.get(room) ?? null;
  if (before === state) return null;
  toldStates.set(room, state);
  return { before };
}

// #522: the status route's own fresh reads, so a broadcast whose end no webhook reported is still
// seen to stop (live, then not) by the server that had seen it live.
const readStates = new Map<ChatRoom, StageState>();
/** Called with each fresh status read: true when this server had last read "live" and now reads otherwise. */
export function stageStopSeen(room: ChatRoom, state: StageState): boolean {
  const before = readStates.get(room);
  readStates.set(room, state);
  return before === "live" && state !== "live";
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
  // #523: a room that has simply been waiting all along (its resting state between broadcasts) is
  // not looked at again every minute. The first sight of it by this server still is, once.
  if (last && last.state === "waiting" && state === "waiting") return false;
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
 * once, and a broadcast using it is cut off), then a new one is made. #522: the route then closes
 * the LiveKit room (lib/chatStageChange.ts), so nobody stays connected to a room with no broadcast.
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
 * A viewer's identity in the LiveKit room: the member's id, "#", and eight hex digits.
 * #522: the digits are a SEAT number, not a random value. A member has STAGE_VIEWER_SEATS seats per
 * video room and every token names one of them, so however many tokens are asked for, on however
 * many servers, one member can hold at most that many connections: LiveKit itself disconnects an
 * earlier connection when another joins with the same identity. Two seats, not three: a stage tab
 * plus a video card, or a computer plus a phone, is two; a third screen is rare and is not refused,
 * it takes over the oldest seat; and each seat is one more LiveKit lookup for every token.
 */
export const STAGE_VIEWER_SEATS = 2;
export const stageViewerIdentity = (memberId: string, seat: number) => `${memberId}#${seat.toString(16).padStart(8, "0")}`;
/** Every identity a member can ever have in a video room. */
export const stageViewerIdentities = (memberId: string) =>
  Array.from({ length: STAGE_VIEWER_SEATS }, (_, index) => stageViewerIdentity(memberId, index + 1));
/** The member behind a viewer identity (for counting people rather than tabs). */
export const stageViewerMember = (identity: string) => identity.split("#")[0];

/** Who holds a seat now: when they joined (ms) and which page's player it is, if it said. */
export type StageSeatHolder = { joinedAt: number; tab?: string };
/** A page's name for its own player: a short random value, so a seat can tell "this tab again" from "another tab". */
export const parseStageTab = (value: unknown): string | null =>
  typeof value === "string" && /^[a-z0-9]{6,24}$/.test(value) ? value : null;
/** The participant attribute that carries it. */
export const STAGE_TAB_ATTRIBUTE = "tab";

/**
 * #522: which seat (1-based) a new connection gets. `holders[i]` is who has seat i+1 now.
 *  - the seat this same tab already holds (it is reconnecting: its old connection is replaced, no
 *    other screen is touched);
 *  - else a free seat, the one the player asked for first (a stage tab asks for 1, a video card and
 *    a phone for 2, so the usual pairs never race for one seat);
 *  - else, every seat taken by other screens: the one that joined longest ago, which that new
 *    connection replaces.
 */
export function pickStageSeat(holders: readonly (StageSeatHolder | null)[], tab: string | null, preferred = 1): number {
  const own = tab ? holders.findIndex((holder) => holder?.tab === tab) : -1;
  if (own >= 0) return own + 1;
  const wanted = Number.isInteger(preferred) && preferred >= 1 && preferred <= holders.length ? preferred : 1;
  if (!holders[wanted - 1]) return wanted;
  const free = holders.findIndex((holder) => !holder);
  if (free >= 0) return free + 1;
  let oldest = 0;
  holders.forEach((holder, index) => {
    if (holder!.joinedAt < holders[oldest]!.joinedAt) oldest = index;
  });
  return oldest + 1;
}

/**
 * #522: the identity for a member's new connection to a video room. Asks LiveKit who holds the
 * member's seats (one small lookup per seat, together). If LiveKit cannot say, the asked-for seat is
 * used: the limit holds either way, because there are only ever STAGE_VIEWER_SEATS identities.
 */
export async function stageSeatFor(api: Pick<StageVideoApi, "viewer">, videoRoom: string, memberId: string, tab: string | null, preferred = 1): Promise<string> {
  const identities = stageViewerIdentities(memberId);
  const holders = await Promise.all(identities.map((identity) => api.viewer(videoRoom, identity))).catch(() => null);
  return identities[pickStageSeat(holders ?? identities.map(() => null), holders ? tab : null, preferred) - 1];
}

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
  // #522: an event with no id cannot be told from a repeat, so it is never acted on.
  if (!id) return false;
  if (seenWebhooks.has(id)) return false;
  if (seenWebhooks.size >= WEBHOOK_MEMORY) seenWebhooks.delete(seenWebhooks.values().next().value!);
  seenWebhooks.add(id);
  return true;
}
/** For tests. */
export const forgetStageWebhooks = () => seenWebhooks.clear();
