import { validChatMember } from "./chatMemberName";
import type { ChatMember } from "./chatDirectMessages";
import { CHAT_ROOMS, type ChatRoom } from "./publicChat";
import { ChatReadCancelled, ChatReadTimeout } from "./chatReadRecovery";
export type UpdateTopic = "room" | "inbox" | "activity" | "features" | "status" | "history" | "reactions";
/** Why a watch ran: diagnostics only, never an input to what is read. */
export type WatchReason = string;
type Watch = {
  load: (why: WatchReason) => Promise<unknown>;
  againWhy?: WatchReason;
  topics: UpdateTopic[];
  fast: boolean;
  reconcileMs: number;
  liveReconcileMs?: number;
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
  private stopped = false;
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
  foreground(why: WatchReason = "foreground") {
    if (!this.env.active() || this.stopped) return;
    this.watches.forEach((w) => this.run(w, why));
    this.scheduleFlush();
  }
  private interval(w: Watch) {
    // A live connection pushes changes, so optional reconciles can relax.
    if (w.liveReconcileMs && this.healthy && !this.pollingRoom) return w.liveReconcileMs;
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
  ) {
    const w: Watch = {
      load,
      topics,
      fast,
      reconcileMs,
      liveReconcileMs,
      due: 0,
      running: false,
      again: false,
      run: 0,
    };
    this.watches.add(w);
    this.run(w, "start");
    return () => {
      this.watches.delete(w);
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
    w.due = (Math.floor(this.env.now() / this.interval(w)) + 1) * this.interval(w);
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
        w.due = (Math.floor(this.env.now() / this.interval(w)) + 1) * this.interval(w);
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
   */
  invalidateAtMost(topic: UpdateTopic, gapMs: number) {
    if (this.stopped) return;
    const state = this.throttled.get(topic) ?? { last: -Infinity };
    this.throttled.set(topic, state);
    if (state.timer) return;
    const wait = state.last + gapMs - this.env.now();
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
      .catch((error) =>
        batch.forEach(([, p]) =>
          p.reject(
            this.stopped || generation !== this.generation
              ? new ChatReadCancelled()
              : timedOut
                ? new ChatReadTimeout()
                : error,
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
