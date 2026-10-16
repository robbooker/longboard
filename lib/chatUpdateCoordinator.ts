import { validChatMember } from "./chatMemberName";
import type { ChatMember } from "./chatDirectMessages";
import { CHAT_ROOMS, type ChatRoom } from "./publicChat";
import { ChatReadCancelled, ChatReadTimeout, ChatReadUnavailable } from "./chatReadRecovery";
import { CHAT_STREAM_RECONCILE_MS } from "./chatEventStream";
export type UpdateTopic =
  | "room"
  | "inbox"
  | "activity"
  | "features"
  | "status"
  | "history"
  | "reactions"
  /** EVENT-STREAM step 2: the room's pinned messages changed. */
  | "pins";
/** Reasons a reader re-reads after a gap in live delivery; a resumable event cursor covers them. */
const RESUME_REASONS = new Set<WatchReason>(["live", "visible", "online"]);
/** Why a watch ran: diagnostics only, never an input to what is read. */
export type WatchReason = string;
export type LivePath = "rooms" | "direct";
type Watch = {
  load: (why: WatchReason) => Promise<unknown>;
  againWhy?: WatchReason;
  topics: UpdateTopic[];
  fast: boolean;
  reconcileMs: number;
  liveReconcileMs?: number;
  /** Which live path pushes this watch's changes: room events, or direct messages. */
  live: LivePath;
  /** EVENT-STREAM: the room whose numbered events can stand in for this reader's timer. */
  streamRoom?: string;
  /** "pins": the stream stands in only once the room's pin changes are numbered. */
  streamNeed?: "pins";
  due: number;
  running: boolean;
  again: boolean;
  run: number;
};
type Result = { path: string; status: number; data: unknown };
type Pending = {
  promise: Promise<Result>;
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
};
export type ChatAccessUpdate = {
  accountId: string;
  rooms: ChatRoom[];
  canLinkShortScout: boolean;
  member?: ChatMember | null;
};
export type CoordinatorEnvironment = {
  fetch: typeof fetch;
  active: () => boolean;
  now: () => number;
  /**
   * This window's fixed offset into every timer cycle, 0–1 (default 0). Timers were
   * aligned to the wall clock, so every open window reloaded the bell at :00 and :30 and
   * the database fell behind (Oct 8: 84% of slow bell reads started there). A random
   * phase per window spreads windows out; one window's own watches still share a
   * boundary, so they keep landing in one batched request. The same phase also delays
   * the first reload after a background signal (see invalidateAtMost).
   */
  phase?: number;
  unauthorized?: () => void;
  access?: (value: ChatAccessUpdate) => void;
};

/** One scheduler and batched transport per mounted, authenticated chat shell. */
export class ChatUpdateCoordinator {
  private watches = new Set<Watch>();
  private queued = new Map<string, Pending>();
  private inflight = new Map<string, Pending>();
  private controllers = new Set<AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private invalidationTimer?: ReturnType<typeof setTimeout>;
  private invalidated = new Set<UpdateTopic>();
  private throttled = new Map<UpdateTopic, { last: number; timer?: ReturnType<typeof setTimeout> }>();
  private healthy = false;
  // Direct messages are pushed only by the Postgres channel; Ably carries room events only.
  private directLive = false;
  private stopped = false;
  // EVENT-STREAM: rooms whose event cursor is in step, and who wants to know which rooms are watched.
  private streamRooms = new Map<string, { pins: boolean }>();
  private streamCover?: (room: string, need?: "pins") => boolean;
  private streamListeners = new Set<(rooms: string[]) => void>();
  private generation = 0;
  private batchSequence = 0;
  private accessSequence = 0;
  constructor(
    private env: CoordinatorEnvironment,
    private pollingRoom = false,
  ) {}
  start() {
    this.stopped = false;
    this.healthy = false;
    this.timer = setInterval(() => this.tick(), 1000);
    this.flush();
  }
  stop() {
    this.stopped = true;
    this.generation++;
    clearInterval(this.timer);
    clearTimeout(this.flushTimer);
    clearTimeout(this.invalidationTimer);
    this.throttled.forEach((state) => clearTimeout(state.timer));
    this.throttled.clear();
    this.timer = undefined;
    this.flushTimer = undefined;
    this.invalidationTimer = undefined;
    this.controllers.forEach((c) => c.abort());
    this.controllers.clear();
    const error = new ChatReadCancelled();
    [...this.queued.values(), ...this.inflight.values()].forEach((p) => p.reject(error));
    this.queued.clear();
    this.inflight.clear();
    this.invalidated.clear();
    this.watches.forEach((w) => {
      w.run++;
      w.running = false;
      w.again = false;
    });
  }
  refreshIdentity() {
    const healthy = this.healthy;
    this.stop();
    this.start();
    this.healthy = healthy;
    this.foreground("identity");
  }
  setPollingRoom(value: boolean) {
    if (this.pollingRoom !== value) {
      this.pollingRoom = value;
      this.foreground("polling");
    }
  }
  setHealthy(healthy: boolean) {
    if (this.healthy === healthy) return;
    this.healthy = healthy;
    // Reconcile the gap on subscribe/reconnect or transport failure.
    this.foreground(healthy ? "live" : "offline");
  }
  setDirectLive(live: boolean) {
    if (this.directLive === live) return;
    this.directLive = live;
    if (!this.env.active() || this.stopped) return;
    // Reconcile the DM gap on subscribe/reconnect or channel failure.
    this.watches.forEach((w) => {
      if (w.live === "direct") this.run(w, live ? "live" : "offline");
    });
    this.scheduleFlush();
  }
  /**
   * EVENT-STREAM: the room's numbered events are (or are no longer) in step, so its history
   * reader may relax to CHAT_STREAM_RECONCILE_MS (or must go back to its own timer).
   */
  setStreamRoom(room: string, inStep: boolean, pins = false) {
    const current = this.streamRooms.get(room);
    if (!!current === inStep && (!inStep || current?.pins === pins)) return;
    if (inStep) this.streamRooms.set(room, { pins });
    else this.streamRooms.delete(room);
    this.watches.forEach((w) => {
      if (w.streamRoom === room && !w.running) w.due = this.nextDue(w);
    });
  }
  /**
   * EVENT-STREAM step 2: whether a room's event cursor will catch up whatever a reconnect or a
   * tab coming back may have missed. Those readers then skip the "re-read everything" run; the
   * catch-up delivers the changed rows (or asks for a full read when it cannot).
   */
  setStreamCover(cover: ((room: string, need?: "pins") => boolean) | undefined) {
    this.streamCover = cover;
  }
  private covered(w: Watch, why: WatchReason) {
    return (
      !!w.streamRoom &&
      RESUME_REASONS.has(why) &&
      this.healthy &&
      !this.pollingRoom &&
      !!this.streamCover?.(w.streamRoom, w.streamNeed)
    );
  }
  /** The room's numbered events are in step and live (its stream-aware readers rely on them). */
  streamInStep(room: string) {
    return this.healthy && !this.pollingRoom && this.streamRooms.has(room);
  }
  /** Run one reader now (deduplicated like a signal), e.g. when a live row concerns only it. */
  refresh(load: Watch["load"], why: WatchReason = "refresh") {
    if (!this.env.active() || this.stopped) return;
    for (const w of this.watches) if (w.load === load) this.run(w, why);
    this.scheduleFlush();
  }
  /** Rooms with a mounted stream-aware reader. */
  streamRoomsWatched(): string[] {
    return [...new Set([...this.watches].flatMap((w) => (w.streamRoom ? [w.streamRoom] : [])))];
  }
  onStreamRooms(listener: (rooms: string[]) => void) {
    this.streamListeners.add(listener);
    return () => {
      this.streamListeners.delete(listener);
    };
  }
  private streamRoomsChanged() {
    const rooms = this.streamRoomsWatched();
    this.streamListeners.forEach((listener) => listener(rooms));
  }
  foreground(why: WatchReason = "foreground") {
    if (!this.env.active() || this.stopped) return;
    this.watches.forEach((w) => {
      // The room's cursor catches up instead; only re-time the reader (it may still be on the
      // 2-second offline cadence).
      if (this.covered(w, why)) {
        if (!w.running) w.due = this.nextDue(w);
      } else this.run(w, why);
    });
    this.scheduleFlush();
  }
  private nextDue(w: Watch) {
    const interval = this.interval(w),
      offset = (this.env.phase ?? 0) * interval;
    return (Math.floor((this.env.now() - offset) / interval) + 1) * interval + offset;
  }
  private interval(w: Watch) {
    // The room's numbered events are in step: they deliver every change, and a gap is caught
    // up from the cursor, so the full read only confirms (Ably up, no room polling).
    const stream = w.streamRoom ? this.streamRooms.get(w.streamRoom) : undefined;
    if (stream && this.healthy && !this.pollingRoom && (w.streamNeed !== "pins" || stream.pins))
      return CHAT_STREAM_RECONCILE_MS;
    // A live connection pushes changes, so optional reconciles can relax.
    if (w.liveReconcileMs && (w.live === "direct" ? this.directLive : this.healthy && !this.pollingRoom))
      return w.liveReconcileMs;
    return w.fast &&
      (!this.healthy || (this.pollingRoom && (w.topics.includes("room") || w.topics.includes("history"))))
      ? 2000
      : w.reconcileMs;
  }
  private tick() {
    if (!this.env.active() || this.stopped) return;
    this.watches.forEach((w) => {
      if (!w.running && w.due <= this.env.now()) this.run(w, "timer");
    });
  }
  watch(
    load: (why: WatchReason) => Promise<unknown>,
    topics: UpdateTopic[],
    fast = false,
    reconcileMs = 10000,
    liveReconcileMs?: number,
    live: LivePath = "rooms",
    streamRoom?: string,
    streamNeed?: "pins",
  ) {
    const w: Watch = {
      load,
      topics,
      fast,
      reconcileMs,
      liveReconcileMs,
      live,
      streamRoom,
      streamNeed,
      due: 0,
      running: false,
      again: false,
      run: 0,
    };
    this.watches.add(w);
    if (streamRoom) this.streamRoomsChanged();
    this.run(w, "start");
    return () => {
      this.watches.delete(w);
      if (streamRoom) this.streamRoomsChanged();
    };
  }
  private run(w: Watch, why: WatchReason) {
    if (this.stopped || !this.env.active() || !this.watches.has(w)) return;
    if (w.running) {
      w.again = true;
      w.againWhy = why;
      return;
    }
    w.running = true;
    w.due = this.nextDue(w);
    const generation = this.generation,
      run = ++w.run;
    void Promise.resolve()
      .then(() => w.load(why))
      .catch(() => {
        /* Consumers present their own errors. */
      })
      .finally(() => {
        if (run !== w.run) return;
        w.running = false;
        // A slow request must not create an endless immediate catch-up loop.
        w.due = this.nextDue(w);
        if (generation !== this.generation) return;
        if (w.again) {
          w.again = false;
          this.run(w, `again:${w.againWhy ?? ""}`);
        }
      });
  }
  invalidate(...topics: UpdateTopic[]) {
    if (this.stopped) return;
    topics.forEach((topic) => this.invalidated.add(topic));
    if (this.invalidationTimer) return;
    this.invalidationTimer = setTimeout(() => {
      this.invalidationTimer = undefined;
      const topics = this.invalidated;
      this.invalidated = new Set();
      const why = `signal:${[...topics].sort().join("+")}`;
      this.watches.forEach((w) => {
        if (w.topics.some((t) => topics.has(t))) this.run(w, why);
      });
    }, 100);
  }
  /**
   * Invalidate at most once per `gapMs` for this topic, with one trailing run so the
   * last event in a burst is never lost. For background signals such as other rooms'
   * messages; direct user actions should keep using invalidate().
   *
   * Every open window receives the same signal at the same moment, so the first run
   * waits this window's phase share of up to 3 s. Without it one message made every
   * window reload the bell in the same second (Oct 9: 85% of slow bell reads).
   */
  invalidateAtMost(topic: UpdateTopic, gapMs: number) {
    if (this.stopped) return;
    const state = this.throttled.get(topic) ?? { last: -Infinity };
    this.throttled.set(topic, state);
    if (state.timer) return;
    const spread = Math.round((this.env.phase ?? 0) * Math.min(gapMs, 3000));
    const wait = Math.max(state.last + gapMs - this.env.now(), spread);
    if (wait <= 0) {
      state.last = this.env.now();
      this.invalidate(topic);
      return;
    }
    state.timer = setTimeout(() => {
      state.timer = undefined;
      state.last = this.env.now();
      this.invalidate(topic);
    }, wait);
  }
  async read(path: string): Promise<Response> {
    if (this.stopped) throw new ChatReadCancelled();
    let pending = this.queued.get(path) ?? this.inflight.get(path);
    if (!pending) {
      let resolve!: Pending["resolve"], reject!: Pending["reject"];
      const promise = new Promise<Result>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      pending = { promise, resolve, reject };
      this.queued.set(path, pending);
      this.scheduleFlush();
    }
    const result = await pending.promise;
    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  private scheduleFlush() {
    if (this.flushTimer || this.stopped) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, 20);
  }
  private flush() {
    if (this.stopped || !this.env.active() || !this.queued.size) return;
    const batch: Array<[string, Pending]> = [];
    // Quad panes can carry long known-ID lists. Stay within the endpoint's body
    // budget as well as its eight-resource limit, then flush the remainder.
    for (const entry of this.queued.entries()) {
      const paths = [...batch.map(([path]) => path), entry[0]];
      if (batch.length && new TextEncoder().encode(JSON.stringify({ paths })).byteLength > 32768) break;
      batch.push(entry);
      if (batch.length === 8) break;
    }
    batch.forEach(([path, p]) => {
      this.queued.delete(path);
      this.inflight.set(path, p);
    });
    if (this.queued.size) this.scheduleFlush();
    const generation = this.generation;
    const sequence = ++this.batchSequence;
    const controller = new AbortController();
    this.controllers.add(controller);
    // Bound hung requests so reconnection cannot be held hostage indefinitely.
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      console.info("[chat-updates] batch-timeout");
      controller.abort();
    }, 15000);
    void this.env
      .fetch("/api/chat/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths: batch.map(([path]) => path) }),
        cache: "no-store",
        signal: controller.signal,
      })
      .then(async (response) => {
        if (this.stopped || generation !== this.generation) return;
        if (response.status === 401 || response.status === 403) this.env.unauthorized?.();
        const body = await response.json();
        if (this.stopped || generation !== this.generation) return;
        // Old servers may omit access. Ignore malformed, late, or cancelled data.
        const access = body.access;
        if (
          response.ok &&
          sequence > this.accessSequence &&
          access &&
          typeof access.accountId === "string" &&
          typeof access.canLinkShortScout === "boolean" &&
          Array.isArray(access.rooms) &&
          access.rooms.every((r: unknown) => CHAT_ROOMS.some((room) => room.slug === r))
        ) {
          this.accessSequence = sequence;
          const { member, ...safe } = access;
          this.env.access?.({ ...safe, ...(member === null || validChatMember(member) ? { member } : {}) });
        }
        for (const [path, p] of batch) {
          const result: Result | undefined = response.ok
            ? body.results?.find((r: Result) => r.path === path)
            : { path, status: response.status, data: body };
          if (result) p.resolve(result);
          else p.reject(new Error("Incomplete chat update."));
        }
      })
      .catch(() =>
        batch.forEach(([, p]) =>
          p.reject(
            this.stopped || generation !== this.generation
              ? new ChatReadCancelled()
              : timedOut
                ? new ChatReadTimeout()
                : new ChatReadUnavailable(),
          ),
        ),
      )
      .finally(() => {
        clearTimeout(timeout);
        this.controllers.delete(controller);
        batch.forEach(([path, p]) => {
          if (this.inflight.get(path) === p) this.inflight.delete(path);
        });
      });
  }
}
