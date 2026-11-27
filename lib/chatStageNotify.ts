// #503 Stage mode: telling a room, once, that its live video is on.
//
// The room message is a Longboard Bot post whose id is worked out from the room and the ten-minute
// slot the broadcast began in, so every server that sees the same broadcast asks for the same id and
// the database creates it at most once.
// #524: the record of a broadcast is its row in public.chat_stage_broadcasts (keyed by that message):
// when it started, when it was last seen live, when it ended. That row, not a look back over six
// hours of message ids, decides whether what LiveKit shows now is the broadcast already announced
// (however long it has run), the same one back after a short drop, or a new one (announced, and an
// earlier notice whose end nobody saw is marked ended at that moment). The database allows a room
// one open broadcast at a time, and the message, its row and the closing of a stale one are written
// together (lib/chatStageNotifyServer.ts, supabase/migrations/20261126120000_chat_stage_broadcasts.sql).
// Server only (lib/chatLongboardBot.ts hashes with node:crypto); the wording is lib/chatStageNotice.ts.
import { ANNOUNCE_ROOMS, uuidFrom } from "./chatLongboardBot";
import { CHAT_ROOMS, parseChatRoom, type ChatRoom } from "./publicChat";
import { composeStageEndedNotice, composeStageLiveNotice, stageLivePush } from "./chatStageNotice";
import { stageStateOf, type StageIngress } from "./chatStageVideo";

/** One notice at most per room per slot. Never longer than STAGE_RECONNECT_MS (see tellStageLive). */
export const STAGE_NOTICE_SLOT_MS = 10 * 60_000;
/** A broadcast that returns within this long of ending is the same broadcast: nobody is told again. */
export const STAGE_RECONNECT_MS = 10 * 60_000;
/** A phone notification is recognised as a live notice's for this long (6 hours of slots); see stageNoticePush. */
export const STAGE_NOTICE_LOOKBACK_SLOTS = 36;
/** A broadcast that stops sending is given this long to return before the message says it ended. */
export const STAGE_DROP_GRACE_MS = 20_000;
/** #524: while a broadcast is live, "last seen live" is written at most this often. */
export const STAGE_SEEN_GAP_MS = 60_000;
/** #524: when LiveKit gives no start time, an open notice not seen live for this long is an earlier broadcast's. */
export const STAGE_UNSEEN_MS = 6 * 60 * 60_000;
/** #524: bell entries still unfinished this long after the notice was posted are finished by the next look. */
export const STAGE_BELLS_RETRY_MS = 45_000;
/** #524: bell entries are written for this many members of the list per database call... */
export const STAGE_BELL_PAGE = 500;
/** ...and at most this many calls per look (200,000 members); the next look carries on from there. */
export const STAGE_BELL_PAGES_MAX = 400;

const slotOf = (ms: number) => Math.floor(ms / STAGE_NOTICE_SLOT_MS);
export const stageNoticeId = (room: ChatRoom, slot: number) => uuidFrom(`stage-live-notice:${room}:${slot}`);
/** Every id a notice of the last 6 hours can have (and the next slot, for a clock a little ahead). */
export function stageNoticeIds(room: ChatRoom, now: number) {
  const last = slotOf(now) + 1;
  return Array.from({ length: STAGE_NOTICE_LOOKBACK_SLOTS + 2 }, (_, back) => stageNoticeId(room, last - back));
}

/**
 * #537: the rooms a room's "live now" notice is copied into. Only the Webinars room has any: a
 * webinar there is for everyone, so every other member room gets a short copy of the notice (the
 * same words and the same "Watch live" link). Every other room's broadcast is told in that room
 * alone, as before.
 * The copies go wherever Longboard Bot may post (ANNOUNCE_ROOMS: every room except Gainers, where
 * every post is read as a stock alert and the database refuses anything else), except the private
 * Admins room and Webinars itself. That includes the read-only rooms (Booker Stock Club, the
 * announcement and recording rooms, What's New), where a bot post is allowed.
 * A copy is silent: no bell entry and no phone notification. Each member is told once, by the
 * Webinars room's own notice. A member only ever sees the copies in rooms they can open.
 */
export const STAGE_COPY_FROM: ChatRoom = "webinars";
export const stageCopyRooms = (room: ChatRoom): ChatRoom[] =>
  room === STAGE_COPY_FROM ? ANNOUNCE_ROOMS.filter((slug) => slug !== "admins" && slug !== STAGE_COPY_FROM) : [];
/** #537: a copy's message id, worked out from its notice and its room, so two servers ask for the same one. */
export const stageCopyId = (noticeId: string, room: ChatRoom) => uuidFrom(`stage-live-copy:${noticeId}:${room}`);

export const stageRoomName = (room: ChatRoom) => CHAT_ROOMS.find((known) => known.slug === room)?.label ?? room;
const roomName = stageRoomName;

/** #524: one announced broadcast (a row of chat_stage_broadcasts). `id` is its room message. Times in ms. */
export type StageBroadcast = {
  id: string;
  startedAt: number;
  lastLiveAt: number;
  endedAt: number | null;
  recordingUrl: string | null;
  /** Who set or removed the recording ("post": the recordings room; "admin": by hand); null: nobody yet. */
  recordingSource: "post" | "admin" | null;
  /** When every bell entry had been written; null while that is unfinished. */
  notifiedAt: number | null;
  createdAt: number;
};

/** What the rules below ask of the database. lib/chatStageNotifyServer.ts is the real one. */
export interface StageNoticeStore {
  /** The room's most recently announced broadcast, or null when it has never had one. */
  latest(room: ChatRoom): Promise<StageBroadcast | null>;
  /** The broadcast whose notice has this id, or null. */
  broadcast(id: string): Promise<StageBroadcast | null>;
  /**
   * The "live now" message and its record, together. true only for the one call that created them;
   * false when the id was already there or another server announced this broadcast at the same
   * moment. An open broadcast the room still has is marked ended first (`staleBody`).
   */
  open(id: string, room: ChatRoom, body: string, startedAt: number, staleBody: string): Promise<boolean>;
  /** The broadcast was live at `at`: remembered, unless something within `gap` ms of it already is. */
  seen(id: string, at: number, gap: number): Promise<void>;
  /** Over: the record, the message's words and its alerts taken back. true only for the one call that marked it. */
  close(room: ChatRoom, id: string, body: string, endedAt: number): Promise<boolean>;
  /** Back shortly after ending: the same message says live again. Nobody is notified. */
  reopen(room: ChatRoom, id: string, body: string): Promise<boolean>;
  /** Bell entries for the next slice of the room's members (the database queues their phone notifications from them). */
  notifyPage(id: string, room: ChatRoom): Promise<{ done: boolean }>;
  /**
   * #537: the notice's silent copies, one per room of `rooms` that does not have this broadcast's
   * copy yet (asking again posts nothing new). Nothing is posted once the broadcast is over. A room
   * that refuses goes without. When the notice's words change later (ended, back, a recording),
   * the database changes its copies with it.
   */
  copy(id: string, rooms: ChatRoom[], body: string): Promise<void>;
}

/**
 * #537: posts the copies of a room's notice (only Webinars has any). Never throws: the room's own
 * notice and its bell entries do not wait on the copies. false: it failed and is worth another try.
 */
export async function writeStageCopies(store: Pick<StageNoticeStore, "copy">, id: string, room: ChatRoom, body: string): Promise<boolean> {
  const rooms = stageCopyRooms(room);
  if (!rooms.length) return true;
  try {
    await store.copy(id, rooms, body);
    return true;
  } catch {
    return false;
  }
}

/**
 * #524: writes a notice's bell entries, a slice of the member list at a time, until the database
 * says the whole list is covered. The database remembers how far it got and never writes a member's
 * entry twice, so this can be cut off anywhere (a timeout, a recycled function) and simply run
 * again: by the announcing call, or by a later look that finds the job unfinished.
 */
export async function writeStageBells(store: Pick<StageNoticeStore, "notifyPage">, id: string, room: ChatRoom): Promise<boolean> {
  for (let pages = 0; pages < STAGE_BELL_PAGES_MAX; pages++) if ((await store.notifyPage(id, room)).done) return true;
  return false;
}

/**
 * #524: what a broadcast LiveKit shows live right now is, next to the room's last announced one.
 *  - "same": the one already announced, still (or again, after a drop too short to matter) on;
 *  - "resume": that one ended under STAGE_RECONNECT_MS before this one began: the same broadcast is back;
 *  - "new": another broadcast.
 * `startedAt` is LiveKit's start time for what is on now (the same for every server), when it gives one.
 * An open notice is the same broadcast when what is on now began before it was last seen live, or
 * within the reconnect time after. That holds however long the broadcast runs and however rarely
 * anyone looks. Begun later than that, the earlier broadcast ended unseen and this is a new one.
 */
export function stageBroadcastVerdict(last: StageBroadcast, at: { now: number; startedAt: number | null }): "same" | "resume" | "new" {
  const { now, startedAt } = at;
  if (last.endedAt === null) {
    if (startedAt === null) return now - last.lastLiveAt < STAGE_UNSEEN_MS ? "same" : "new";
    return startedAt - last.lastLiveAt < STAGE_RECONNECT_MS ? "same" : "new";
  }
  if (now - last.endedAt < STAGE_RECONNECT_MS) return "resume";
  // Looked at late: what is on now is a later start than the one announced, begun soon after that one ended.
  if (startedAt !== null && startedAt > last.startedAt && startedAt - last.endedAt < STAGE_RECONNECT_MS) return "resume";
  return "new";
}

export type StageLiveResult = "announced" | "resumed" | "already";

/**
 * The room's live video is on (as LiveKit says, not as a webhook hints). Tells the room once:
 *  - the room's last notice is this broadcast: nothing (a repeated webhook, another server, a
 *    reconnect, the sixth hour of a long one). It is noted as seen live, at most once a minute, and
 *    bell entries an earlier call did not finish are finished;
 *  - it ended under 10 minutes before: the same broadcast is back; its message says live again and
 *    nobody is notified;
 *  - otherwise a new notice, with the id of the slot the broadcast began in (#537: and, for the
 *    Webinars room, its silent copies in every other member room, once, by the same call). Every server that
 *    sees this broadcast works out the same id, and only the call that created it writes the bells.
 *    An earlier notice still saying "live" is marked ended in the same step.
 */
export async function tellStageLive(
  store: StageNoticeStore,
  room: ChatRoom,
  at: { now: number; startedAt?: number | null; origin: string },
): Promise<StageLiveResult> {
  const { now } = at;
  // LiveKit's start time, unless it is in the future (then the clock is used).
  const startedAt = typeof at.startedAt === "number" && at.startedAt > 0 && at.startedAt <= now + STAGE_NOTICE_SLOT_MS ? at.startedAt : null;
  const body = composeStageLiveNotice(roomName(room), at.origin, room);
  const settle = async (known: StageBroadcast): Promise<StageLiveResult | null> => {
    const verdict = stageBroadcastVerdict(known, { now, startedAt });
    if (verdict === "new") return null;
    if (verdict === "resume") return (await store.reopen(room, known.id, body)) ? "resumed" : "already";
    // At most once a minute, and nothing is sent to the database in between.
    if (now - known.lastLiveAt >= STAGE_SEEN_GAP_MS) await store.seen(known.id, now, STAGE_SEEN_GAP_MS);
    // The message is there and its bell entries are not all written: the call that posted it was cut off.
    // #537: the copies are posted before the bells, so unfinished bells may mean unposted copies too.
    if (known.notifiedAt === null && now - known.createdAt >= STAGE_BELLS_RETRY_MS) {
      await writeStageCopies(store, known.id, room, body);
      await writeStageBells(store, known.id, room);
    }
    return "already";
  };
  const last = await store.latest(room);
  const known = last && (await settle(last));
  if (known) return known;
  // The slot the broadcast began in; then the clock's own slot, for a start time that turns out to
  // be an older broadcast's (a slot is never longer than the reconnect window, so it is free).
  const recent = startedAt !== null && now - startedAt < (STAGE_NOTICE_LOOKBACK_SLOTS / 2) * STAGE_NOTICE_SLOT_MS;
  for (const slot of new Set([slotOf(recent ? startedAt : now), slotOf(now)])) {
    const id = stageNoticeId(room, slot);
    if (id === last?.id) continue;
    if (await store.open(id, room, body, startedAt ?? now, composeStageEndedNotice(roomName(room)))) {
      // #537: a Webinars broadcast is also told in every other member room, silently, and first:
      // the copies are a handful of posts, the bells one entry per member.
      const copied = await writeStageCopies(store, id, room, body);
      await writeStageBells(store, id, room);
      if (!copied) await writeStageCopies(store, id, room, body);
      return "announced";
    }
    // Already there: another server told the room a moment ago, or the slot holds an earlier notice.
    const held = await store.broadcast(id);
    const settled = held ? await settle(held) : "already";
    if (settled) return settled;
  }
  return "already";
}

/**
 * The broadcast is over: the open notice (if there is one) says so, and its alerts are taken back.
 * `endedAt`: when it stopped, as well as that is known.
 */
export async function tellStageEnded(store: StageNoticeStore, room: ChatRoom, endedAt: number): Promise<boolean> {
  const last = await store.latest(room);
  if (!last || last.endedAt !== null) return false;
  return store.close(room, last.id, composeStageEndedNotice(roomName(room), last.recordingUrl), endedAt);
}

export type StageSyncResult = StageLiveResult | "ended" | "none";

/**
 * Brings the room's notice in line with what LiveKit says right now. Called (after the response)
 * whenever something hints the live video changed: a LiveKit webhook, an admin's player or reset
 * key, or (#512, in case a webhook was missed) the room's status being read. #512: a room keeps its
 * ingress for good and there is no End button, so a broadcast is over when LiveKit says the ingress
 * is no longer publishing: it gets STAGE_DROP_GRACE_MS to come back, and then the message says it
 * ended and its alerts are taken back. (A room whose ingress is gone altogether is marked at once.)
 * #524: when the broadcast stopped is kept with the record, as well as it is known: this server saw
 * it stop (`stoppedFor`), or LiveKit says when its ingress was last active, or the caller was told
 * just now (`timely`: a webhook, an admin's action). Otherwise all that is known is when it was
 * last seen live. A broadcast that starts later is judged against that time (stageBroadcastVerdict),
 * so a notice found stale long after the fact does not swallow the next broadcast's announcement.
 */
export async function syncStageNotice(
  deps: {
    store: StageNoticeStore;
    ingresses: () => Promise<Pick<StageIngress, "publishing" | "startedAt" | "activeAt">[]>;
    wait: (ms: number) => Promise<unknown>;
    now: () => number;
    origin: string;
    /** #521: how long the broadcast is already known to have been stopped (ms), when that is known: only the rest of the grace is waited. */
    stoppedFor?: () => number | null;
    /** #524: the caller has just been told of a change (a webhook, an admin's action), so "stopped" means "stopped now". */
    timely?: boolean;
  },
  room: ChatRoom,
): Promise<StageSyncResult> {
  let ingresses = await deps.ingresses();
  if (stageStateOf(ingresses) !== "live") {
    const last = await deps.store.latest(room);
    if (!last || last.endedAt !== null) return "none";
    const now = deps.now();
    const sawFor = deps.stoppedFor?.() ?? null;
    const active = Math.max(0, ...ingresses.map((ingress) => (ingress.publishing ? 0 : (ingress.activeAt ?? 0))));
    const stopped =
      sawFor !== null ? now - Math.max(0, sawFor) : active > last.lastLiveAt && active <= now ? active : deps.timely ? now : null;
    if (ingresses.length) {
      // Kept before the wait: if this look is lost, the next one still knows the broadcast was on until then.
      if (stopped !== null) await deps.store.seen(last.id, stopped, 0);
      const left = STAGE_DROP_GRACE_MS - Math.min(STAGE_DROP_GRACE_MS, Math.max(0, sawFor ?? 0));
      if (left > 0) {
        await deps.wait(left);
        ingresses = await deps.ingresses();
      }
    }
    if (stageStateOf(ingresses) !== "live")
      return (await deps.store.close(room, last.id, composeStageEndedNotice(roomName(room), last.recordingUrl), stopped ?? last.lastLiveAt)) ? "ended" : "none";
  }
  const startedAt = Math.max(0, ...ingresses.filter((ingress) => ingress.publishing).map((ingress) => ingress.startedAt ?? 0));
  return tellStageLive(deps.store, room, { now: deps.now(), startedAt: startedAt || null, origin: deps.origin });
}

/**
 * A phone notification's address is /chat?room=<room>&thread=<message>. When that message is a live
 * notice (its id is one this room's notices can have), the notification says the room is live and
 * opens the stage link instead. No database read: the ids are worked out here.
 */
export function stageNoticePush(url: unknown, now: number): { title: string; body: string; url: string } | null {
  const match = typeof url === "string" ? /^\/chat\?room=([a-z0-9-]+)&thread=([0-9a-f-]{36})$/.exec(url) : null;
  const room = match && parseChatRoom(match[1]);
  if (!match || !room || !stageNoticeIds(room, now).includes(match[2])) return null;
  return stageLivePush(roomName(room), room);
}
