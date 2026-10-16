// EVENT-STREAM step 1 (docs/chat-event-stream.md): numbered room events over the existing Ably
// room channels, and "everything after N" when a window may have missed one.
//
// Every change to a room message gets the room's next number (event_seq, set by the database).
// Live events carry the changed row with its number; edits, deletes and "changed" signals also
// carry the room's head (the last number handed out) so changes the publisher did not send
// (cascaded deletes, writers that never publish) are noticed at once. A window keeps one cursor
// per room it shows: `head`, the highest number below which it has applied every change. A
// number it cannot account for means a gap, and it asks GET /api/chat/events for the rows
// changed after its head. Rows are whole current states, so applying one twice (live and in a
// catch-up) is harmless; the list's revision check keeps an older state from replacing a newer.
//
// While a room's cursor is in step, its history reader relaxes from every minute to every five
// (ChatUpdateCoordinator.setStreamRoom). Ably off or disconnected: the cursor is dropped and the
// old timers come back.
import type { ChatRoom } from "./publicChat";

export type ChatEventStreamRollout = "off" | "admins" | "all";
/** Server flag CHAT_EVENT_STREAM: off (default), admins, or all. */
export function chatEventStreamRollout(value: string | undefined): ChatEventStreamRollout {
  return value === "all" || value === "admins" ? value : "off";
}
/**
 * Per-session kill switch: sessionStorage[CHAT_EVENT_STREAM_KILL_KEY] = "off" (or open any chat
 * page with ?eventStream=off; ?eventStream=on clears it). The window then never asks for
 * events and keeps every timer as before.
 */
export const CHAT_EVENT_STREAM_KILL_KEY = "longboard-chat-event-stream";
export function chatEventStreamKilled(
  store: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  search = "",
): boolean {
  try {
    const asked = new URLSearchParams(search).get("eventStream");
    if (asked === "off") store?.setItem(CHAT_EVENT_STREAM_KILL_KEY, "off");
    if (asked === "on") store?.removeItem(CHAT_EVENT_STREAM_KILL_KEY);
    return asked === "off" || store?.getItem(CHAT_EVENT_STREAM_KILL_KEY) === "off";
  } catch {
    return false;
  }
}

/** History readers poll this often while their room's stream is in step (5 minutes). */
export const CHAT_STREAM_RECONCILE_MS = 5 * 60 * 1000;
/** Rows per catch-up; a longer gap is repaired by one full history read instead. */
export const CHAT_EVENT_CATCH_UP_LIMIT = 100;
/** A cursor older than this is not trusted (tombstones are kept 7 days); resync instead. */
export const CHAT_EVENT_CURSOR_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A failed catch-up is retried after 5 s, doubling up to 5 minutes; the timers cover the meantime. */
export const CHAT_EVENT_RETRY_MS = 5000;
export const CHAT_EVENT_RETRY_MAX_MS = 5 * 60 * 1000;

export type ChatStreamEvent =
  { seq: number; row: Record<string, unknown> } | { seq: number; deletedId: string };
export type ChatCatchUp = { head: number; complete: boolean; events: ChatStreamEvent[] };

// Client-safe copy of lib/chatMembers CHAT_UUID (that module imports node:crypto).
const CHAT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const seqOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
/** The number a live event carries: its row's own change, and the room's head when sent. */
export function liveEventNumbers(data: unknown): { seq?: number; head?: number } {
  const event = data as { row?: { event_seq?: unknown }; head?: unknown } | null;
  return { seq: seqOf(event?.row?.event_seq), head: seqOf(event?.head) };
}

/** Validates a catch-up response; anything malformed is treated as a failed read. */
export function parseCatchUp(body: unknown): ChatCatchUp | null {
  const value = body as Partial<ChatCatchUp> | null;
  if (!value || typeof value.head !== "number" || !Number.isSafeInteger(value.head) || value.head < 0)
    return null;
  if (typeof value.complete !== "boolean" || !Array.isArray(value.events)) return null;
  const events: ChatStreamEvent[] = [];
  for (const event of value.events as Array<Record<string, unknown>>) {
    const seq = seqOf(event?.seq);
    if (!seq || seq > value.head) return null;
    if (typeof event.deletedId === "string" && CHAT_UUID.test(event.deletedId))
      events.push({ seq, deletedId: event.deletedId });
    else if (
      event.row &&
      typeof event.row === "object" &&
      typeof (event.row as { id?: unknown }).id === "string"
    )
      events.push({ seq, row: event.row as Record<string, unknown> });
    else return null;
  }
  events.sort((a, b) => a.seq - b.seq);
  return { head: value.head, complete: value.complete, events };
}

/**
 * One room's position in its event sequence. Invariant: every change numbered at or below
 * `head` has been applied here. `head` moves only by the next number arriving on its own row,
 * or by a catch-up (whose rows and head come from one database snapshot).
 */
export class RoomEventCursor {
  /** null until the first sync answers. */
  head: number | null = null;
  /** The highest number this window has heard of. */
  known = 0;
  syncedAt = 0;
  /** A live event's numbers. Returns true when a catch-up is needed. */
  live(seq?: number, head?: number): boolean {
    this.known = Math.max(this.known, seq ?? 0, head ?? 0);
    if (this.head === null) return false;
    if (seq !== undefined && seq === this.head + 1) this.head = seq;
    return this.known > this.head;
  }
  /** A catch-up (or first sync) answered with the room's head at its snapshot. */
  caughtUp(head: number, now: number) {
    this.head = Math.max(this.head ?? 0, head);
    this.known = Math.max(this.known, this.head);
    this.syncedAt = now;
  }
  behind() {
    return this.head !== null && this.known > this.head;
  }
  stale(now: number) {
    return this.head !== null && now - this.syncedAt > CHAT_EVENT_CURSOR_MAX_AGE_MS;
  }
}

export type ChatEventStreamDeps = {
  /** Reads one catch-up path; normally ChatUpdateCoordinator.read so it batches. */
  read: (path: string) => Promise<Response>;
  /** Apply caught-up rows/deletions exactly like live events. */
  apply: (room: ChatRoom, events: ChatStreamEvent[]) => void;
  /** Repair by one full history read (gap too long, cursor too old, or a fresh sync). */
  reconcile: (room: ChatRoom) => void;
  /** The room's stream is (or is no longer) in step. */
  ready: (room: ChatRoom, ready: boolean) => void;
  now: () => number;
  /** The server turned the stream off: stop asking for this page session. */
  disabled?: () => void;
};

type RoomState = {
  cursor: RoomEventCursor;
  running: boolean;
  failures: number;
  retry?: ReturnType<typeof setTimeout>;
  generation: number;
};

/**
 * Cursors for the rooms whose history this window shows. Not tied to the DOM or Ably, so the
 * ordering, dedup and catch-up rules are unit-tested. The hook tells it when the connection is
 * up and when each room's channel has attached; a catch-up only ever starts after the attach,
 * so its snapshot covers everything the channel did not deliver.
 */
export class ChatEventStream {
  private rooms = new Map<ChatRoom, RoomState>();
  private attachedRooms = new Set<ChatRoom>();
  private live = false;
  private off = false;
  private generation = 0;
  constructor(private deps: ChatEventStreamDeps) {}

  get enabled() {
    return !this.off;
  }
  /** Rooms whose history reader is mounted (from the coordinator). */
  setRooms(rooms: readonly ChatRoom[]) {
    const wanted = new Set(rooms);
    for (const [room, state] of [...this.rooms])
      if (!wanted.has(room)) {
        clearTimeout(state.retry);
        this.rooms.delete(room);
        this.deps.ready(room, false);
      }
    for (const room of wanted)
      if (!this.rooms.has(room)) {
        this.rooms.set(room, {
          cursor: new RoomEventCursor(),
          running: false,
          failures: 0,
          generation: this.generation,
        });
        if (this.live && this.attachedRooms.has(room)) this.sync(room);
      }
  }
  /**
   * The connection is (or is no longer) up. Down: every room leaves step (its timers come back)
   * and in-flight answers are ignored, but cursors are kept so the reconnect asks only for
   * "everything after N".
   */
  setLive(live: boolean) {
    if (this.live === live) return;
    this.live = live;
    this.generation++;
    if (live) return;
    this.attachedRooms.clear();
    for (const [room, state] of this.rooms) {
      clearTimeout(state.retry);
      state.retry = undefined;
      state.running = false;
      state.failures = 0;
      state.generation = this.generation;
      this.deps.ready(room, false);
    }
  }
  /**
   * A room channel attached (first time, after a reconnect, or re-attached without Ably's
   * continuity). Anything may have been missed before it, so catch up from the cursor.
   */
  attached(room: ChatRoom) {
    this.attachedRooms.add(room);
    const state = this.rooms.get(room);
    if (!state || !this.live || this.off) return;
    if (state.generation !== this.generation) {
      // Anything still in flight belongs to the previous connection and will be ignored.
      state.generation = this.generation;
      state.running = false;
    }
    if (state.cursor.head !== null) state.cursor.known = Math.max(state.cursor.known, state.cursor.head + 1);
    this.sync(room);
  }
  /** A live room event's payload. Call for every event of a shown room. */
  event(room: ChatRoom, data: unknown) {
    const state = this.rooms.get(room);
    if (!state || this.off) return;
    const { seq, head } = liveEventNumbers(data);
    if (state.cursor.live(seq, head) && this.live) this.sync(room);
  }
  /** Whether the room's stream is in step (its history reader may relax). */
  inStep(room: ChatRoom) {
    const state = this.rooms.get(room);
    return !!state && this.live && !this.off && state.cursor.head !== null && !state.cursor.behind();
  }
  head(room: ChatRoom) {
    return this.rooms.get(room)?.cursor.head ?? null;
  }
  stop() {
    this.generation++;
    for (const [room, state] of this.rooms) {
      clearTimeout(state.retry);
      this.deps.ready(room, false);
    }
    this.rooms.clear();
    this.attachedRooms.clear();
    this.live = false;
  }

  private sync(room: ChatRoom) {
    const state = this.rooms.get(room);
    if (!state || this.off || !this.live || !this.attachedRooms.has(room)) return;
    // One read at a time per room; when it ends it reads again if the cursor is still behind.
    // A scheduled retry likewise reads from the newest cursor.
    if (state.running || state.retry) return;
    state.running = true;
    const generation = state.generation;
    const cursor = state.cursor;
    const after = cursor.head === null || cursor.stale(this.deps.now()) ? null : cursor.head;
    const knownAtStart = cursor.known;
    const path = `/api/chat/events?room=${room}${after === null ? "" : `&after=${after}`}`;
    const current = () =>
      this.rooms.get(room) === state && state.generation === generation && this.live && !this.off;
    void this.deps
      .read(path)
      .then(async (response) => {
        if (!current()) return;
        if (response.status === 404) {
          this.off = true;
          for (const shown of this.rooms.keys()) this.deps.ready(shown, false);
          this.deps.disabled?.();
          return;
        }
        const result = response.ok ? parseCatchUp(await response.json().catch(() => null)) : null;
        if (!current()) return;
        if (!result) throw new Error("catch-up failed");
        if (after === null || !result.complete) {
          // A fresh cursor (or a gap too long to list): one full history read after this
          // snapshot covers every change up to its head.
          cursor.caughtUp(result.head, this.deps.now());
          this.deps.reconcile(room);
        } else {
          if (result.events.length) this.deps.apply(room, result.events);
          cursor.caughtUp(result.head, this.deps.now());
        }
        // The snapshot is newer than any number heard before the read started, so a claim it
        // does not reach was wrong; never loop on it.
        if (cursor.known <= knownAtStart) cursor.known = cursor.head ?? 0;
        state.failures = 0;
        this.deps.ready(room, !cursor.behind());
      })
      .catch(() => {
        if (!current()) return;
        this.deps.ready(room, false);
        const wait = Math.min(CHAT_EVENT_RETRY_MS * 2 ** state.failures++, CHAT_EVENT_RETRY_MAX_MS);
        state.retry = setTimeout(() => {
          state.retry = undefined;
          if (current()) this.sync(room);
        }, wait);
      })
      .finally(() => {
        if (state.generation !== generation) return;
        state.running = false;
        if (current() && !state.retry && (cursor.head === null || cursor.behind())) this.sync(room);
      });
  }
}
