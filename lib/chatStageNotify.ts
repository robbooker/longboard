// #503 Stage mode: telling a room, once, that its live video is on.
//
// Nothing new is stored. The record of "this broadcast was announced" is the room message itself:
// a Longboard Bot post whose id is worked out from the room and the ten-minute slot the broadcast
// began in. public.post_chat_longboard_announcement inserts a given id at most once, whichever
// server asks and however often, so only the one call that really created the message goes on to
// the bell and the phones. The same message is rewritten when the broadcast ends, and rewritten
// back, with no second notification, when it returns within STAGE_RECONNECT_MS.
// The ids can be listed for any stretch of time, so the latest notice is found by primary key.
// Server only (lib/chatLongboardBot.ts hashes with node:crypto); the wording is lib/chatStageNotice.ts.
import { uuidFrom } from "./chatLongboardBot";
import { CHAT_ROOMS, parseChatRoom, type ChatRoom } from "./publicChat";
import { composeStageEndedNotice, composeStageLiveNotice, stageLiveNotice, stageLivePush } from "./chatStageNotice";
import { stageStateOf, type StageIngress } from "./chatStageVideo";

/** One notice at most per room per slot. Never longer than STAGE_RECONNECT_MS (see tellStageLive). */
export const STAGE_NOTICE_SLOT_MS = 10 * 60_000;
/** A broadcast that returns within this long of ending is the same broadcast: nobody is told again. */
export const STAGE_RECONNECT_MS = 10 * 60_000;
/** How far back a notice still counts as "the current broadcast": 6 hours of slots. */
export const STAGE_NOTICE_LOOKBACK_SLOTS = 36;
/** A broadcast that stops sending is given this long to return before the message says it ended. */
export const STAGE_DROP_GRACE_MS = 20_000;

const slotOf = (ms: number) => Math.floor(ms / STAGE_NOTICE_SLOT_MS);
export const stageNoticeId = (room: ChatRoom, slot: number) => uuidFrom(`stage-live-notice:${room}:${slot}`);
/** Every id a notice of the last 6 hours can have (and the next slot, for a clock a little ahead). */
export function stageNoticeIds(room: ChatRoom, now: number) {
  const last = slotOf(now) + 1;
  return Array.from({ length: STAGE_NOTICE_LOOKBACK_SLOTS + 2 }, (_, back) => stageNoticeId(room, last - back));
}
const roomName = (room: ChatRoom) => CHAT_ROOMS.find((known) => known.slug === room)?.label ?? room;

export type StageNotice = { id: string; body: string; createdAt: number; editedAt: number | null; revision: number };

/** What the rules below ask of the database. lib/chatStageNotifyServer.ts is the real one. */
export interface StageNoticeStore {
  /** The notices among these ids. */
  notices(ids: string[]): Promise<StageNotice[]>;
  /** true only for the one call that created the message; false when the id was already there. */
  post(id: string, room: ChatRoom, body: string): Promise<boolean>;
  /** New words for a notice, only if nobody changed it since it was read. */
  rewrite(room: ChatRoom, notice: StageNotice, body: string): Promise<boolean>;
  /** The accounts to tell: lib/chatStageNotify.ts's stageNoticeRecipients. */
  recipients(room: ChatRoom): Promise<string[]>;
  /** A bell entry for each account (the database queues their phone notifications from it). */
  notify(id: string, room: ChatRoom, accounts: string[]): Promise<void>;
  /** Takes a notice's bell entries (and so any phone notification not yet sent) back. */
  withdraw(id: string): Promise<void>;
}

const isLive = (notice: StageNotice) => stageLiveNotice(notice.body) !== null;
const latest = (notices: StageNotice[]) => notices.reduce<StageNotice | null>((a, b) => (a && a.createdAt >= b.createdAt ? a : b), null);
const recentlyEnded = (notice: StageNotice, now: number) => now - (notice.editedAt ?? notice.createdAt) < STAGE_RECONNECT_MS;

export type StageLiveResult = "announced" | "resumed" | "already";

/**
 * The room's live video is on (as LiveKit says, not as a webhook hints). Tells the room once:
 *  - a live notice is already there: nothing (a repeated webhook, another server, a reconnect);
 *  - the last notice ended under 10 minutes ago: the same broadcast is back; its message says live
 *    again and nobody is notified;
 *  - otherwise a new notice, with the id of the slot the broadcast began in. Every server that
 *    sees this broadcast works out the same id, and only the call whose insert created the row
 *    notifies. `startedAt` is LiveKit's own start time for the broadcast, the same for every
 *    caller; without it the server's clock is used.
 */
export async function tellStageLive(
  store: StageNoticeStore,
  room: ChatRoom,
  at: { now: number; startedAt?: number | null; origin: string },
): Promise<StageLiveResult> {
  const { now } = at;
  const body = composeStageLiveNotice(roomName(room), at.origin, room);
  const resume = async (notice: StageNotice): Promise<StageLiveResult | null> => {
    if (isLive(notice)) return "already";
    if (!recentlyEnded(notice, now)) return null;
    await store.rewrite(room, notice, body);
    return "resumed";
  };
  const last = latest(await store.notices(stageNoticeIds(room, now)));
  const known = last && (await resume(last));
  if (known) return known;
  const started = at.startedAt;
  const usable =
    typeof started === "number" &&
    started <= now + STAGE_NOTICE_SLOT_MS &&
    now - started < (STAGE_NOTICE_LOOKBACK_SLOTS / 2) * STAGE_NOTICE_SLOT_MS;
  // The slot the broadcast began in; then the clock's own slot, for a start time that turns out to
  // be an older broadcast's (a slot is never longer than the reconnect window, so it is free).
  for (const slot of new Set([slotOf(usable ? started : now), slotOf(now)])) {
    const id = stageNoticeId(room, slot);
    if (await store.post(id, room, body)) {
      await store.notify(id, room, await store.recipients(room));
      return "announced";
    }
    // Already there: another server told the room a moment ago, or the slot holds an earlier notice.
    const [held] = await store.notices([id]);
    const settled = held ? await resume(held) : "already";
    if (settled) return settled;
  }
  return "already";
}

/** The broadcast is over: the live notice (if there is one) says so, and its alerts are taken back. */
export async function tellStageEnded(store: StageNoticeStore, room: ChatRoom, now: number): Promise<boolean> {
  const last = latest(await store.notices(stageNoticeIds(room, now)));
  if (!last || !isLive(last)) return false;
  if (!(await store.rewrite(room, last, composeStageEndedNotice(roomName(room))))) return false;
  await store.withdraw(last.id);
  return true;
}

export type StageSyncResult = StageLiveResult | "ended" | "none";

/**
 * Brings the room's notice in line with what LiveKit says right now. Called (after the response)
 * whenever something hints the live video changed: a LiveKit webhook, or an admin's start, end or
 * player. A started broadcast that is not sending gets STAGE_DROP_GRACE_MS to come back before the
 * message says it ended; an ended one (no ingress) is marked at once.
 */
export async function syncStageNotice(
  deps: {
    store: StageNoticeStore;
    ingresses: () => Promise<Pick<StageIngress, "publishing" | "startedAt">[]>;
    wait: (ms: number) => Promise<unknown>;
    now: () => number;
    origin: string;
  },
  room: ChatRoom,
): Promise<StageSyncResult> {
  let ingresses = await deps.ingresses();
  if (stageStateOf(ingresses) !== "live") {
    const last = latest(await deps.store.notices(stageNoticeIds(room, deps.now())));
    if (!last || !isLive(last)) return "none";
    if (ingresses.length) {
      await deps.wait(STAGE_DROP_GRACE_MS);
      ingresses = await deps.ingresses();
    }
    if (stageStateOf(ingresses) !== "live") return (await tellStageEnded(deps.store, room, deps.now())) ? "ended" : "none";
  }
  const startedAt = Math.max(0, ...ingresses.filter((ingress) => ingress.publishing).map((ingress) => ingress.startedAt ?? 0));
  return tellStageLive(deps.store, room, { now: deps.now(), startedAt: startedAt || null, origin: deps.origin });
}

/** The reads stageNoticeRecipients needs. */
export interface StageRecipientReads {
  /** Accounts whose view of the room's member list may be used (the acting admin, then the owners and admins). */
  readers(): Promise<string[]>;
  /** The next members (ids) of the room's own member list after `cursor`; null when this reader cannot read it. */
  members(reader: string, room: ChatRoom, cursor: string | null): Promise<string[] | null>;
  /** The accounts behind member ids. */
  accounts(memberIds: string[]): Promise<string[]>;
  /** Bot accounts. */
  bots(): Promise<string[]>;
  /** Accounts that set this room to "Mentions only" or "Muted". */
  quiet(room: ChatRoom): Promise<string[]>;
}
const MEMBER_PAGES_MAX = 2_000;

/**
 * Who is told: the room's own member list (public.longboard_chat_room_members, the same rule as
 * every room notification: only people who can read the room now), without bot accounts, without
 * anyone who set the room to "Mentions only" or "Muted" (a live notice is for the whole room, like
 * an announcement, not a personal mention), and without `skip` (the admin whose action this is).
 */
export async function stageNoticeRecipients(reads: StageRecipientReads, room: ChatRoom, skip?: string | null): Promise<string[]> {
  let memberIds: string[] | null = null;
  for (const reader of await reads.readers()) {
    const ids: string[] = [];
    let page = await reads.members(reader, room, null);
    if (!page) continue;
    for (let pages = 1; page?.length && pages < MEMBER_PAGES_MAX; pages++) {
      ids.push(...page);
      page = await reads.members(reader, room, page[page.length - 1]);
    }
    if (page === null) continue;
    memberIds = ids;
    break;
  }
  if (!memberIds?.length) return [];
  const [accounts, bots, quiet] = await Promise.all([reads.accounts(memberIds), reads.bots(), reads.quiet(room)]);
  const left = new Set([...bots, ...quiet, ...(skip ? [skip] : [])]);
  return [...new Set(accounts)].filter((account) => !left.has(account));
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
