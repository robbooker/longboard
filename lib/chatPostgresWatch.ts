// #496: which Supabase Postgres change channels a Longboard chat window keeps open.
//
// Supabase Realtime runs a privacy check per open channel for every row change on the tables it
// watches, which made its change-check query a third of the database's time. Ably now carries
// every room's events (each readable room is on the token, so other rooms' unread badges move
// too), so the room tables are watched over Postgres only while Ably is not live:
//
// - "rooms" (longboard_chat_messages, longboard_chat_reactions): only while Ably is down or not
//   offered to this window. While the first Ably connection is still being set up ("pending") it
//   waits, up to CHAT_ABLY_PENDING_MS, so a normal page load never joins and leaves at once.
// - "direct" (longboard_chat_direct_messages, longboard_chat_conversations): always, because
//   Ably does not carry DMs yet (EVENT-STREAM step 4 moves them to a per-person channel).
// - Both close after the tab has been hidden for CHAT_POSTGRES_HIDDEN_DROP_MS and reopen when it
//   is shown again. Coming back re-reads what may have been missed (the coordinator's "visible"
//   run, the "live" runs when each channel subscribes, and `resumed` for the bell).

/** How this window's Ably connection stands, as far as the Postgres channels care. */
export type AblyRoomLink =
  /** Token asked for, or the first connection still being made. */
  | "pending"
  /** Not offered to this window (rollout off, no key, refused) or failed to start. */
  | "off"
  | "live"
  /** Was set up but is not connected now (dropped, reconnecting, suspended, failed). */
  | "down";

export type ChatPostgresChannel = "rooms" | "direct";
export const CHAT_POSTGRES_CHANNELS: readonly ChatPostgresChannel[] = ["rooms", "direct"];
export type ChatPostgresLive = Record<ChatPostgresChannel, boolean>;

/** A tab hidden this long drops its Postgres channels until it is shown again. */
export const CHAT_POSTGRES_HIDDEN_DROP_MS = 60_000;
/** The longest the room tables wait for a first Ably connection before watching Postgres instead. */
export const CHAT_ABLY_PENDING_MS = 10_000;

/** Which channels a window wants open. Pure; `parked` is "hidden for the drop delay". */
export function chatPostgresWanted(ably: AblyRoomLink, parked: boolean): ChatPostgresLive {
  if (parked) return { rooms: false, direct: false };
  return { rooms: ably === "off" || ably === "down", direct: true };
}

export type ChatPostgresWatchEnv = {
  /**
   * Open one channel; `status` reports whether it is subscribed. Returns its close. A close must
   * be safe before the channel has finished opening (the Supabase library loads lazily).
   */
  open: (channel: ChatPostgresChannel, status: (subscribed: boolean) => void) => () => void;
  hidden: () => boolean;
  /** Which channels are subscribed now, on every change. */
  live: (live: ChatPostgresLive) => void;
  /** The DM channel is subscribed again after the tab dropped it: re-read what it may have missed. */
  resumed?: () => void;
  hiddenDropMs?: number;
  pendingMs?: number;
  setTimeout?: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout?: (timer: ReturnType<typeof setTimeout> | undefined) => void;
};

/** Opens and closes this window's Postgres channels as Ably and the tab's visibility change. */
export class ChatPostgresWatch {
  private ably: AblyRoomLink = "pending";
  private pendingTooLong = false;
  private parked = false;
  private resuming = false;
  private stopped = true;
  private parkTimer?: ReturnType<typeof setTimeout>;
  private pendingTimer?: ReturnType<typeof setTimeout>;
  private channels = new Map<ChatPostgresChannel, () => void>();
  private current: ChatPostgresLive = { rooms: false, direct: false };
  constructor(private env: ChatPostgresWatchEnv) {}

  start(ably: AblyRoomLink = this.ably) {
    this.stopped = false;
    this.ably = ably;
    this.timePending();
    this.visibility();
    this.apply();
  }

  stop() {
    this.stopped = true;
    this.clear(this.parkTimer);
    this.clear(this.pendingTimer);
    this.parkTimer = this.pendingTimer = undefined;
    for (const close of this.channels.values()) close();
    this.channels.clear();
    this.current = { rooms: false, direct: false };
  }

  setAbly(ably: AblyRoomLink) {
    if (this.ably === ably) return;
    this.ably = ably;
    if (this.stopped) return;
    this.timePending();
    this.apply();
  }

  /** Call on every visibilitychange. */
  visibility() {
    if (this.stopped) return;
    this.clear(this.parkTimer);
    this.parkTimer = undefined;
    if (this.env.hidden()) {
      if (!this.parked)
        this.parkTimer = this.later(() => {
          this.parkTimer = undefined;
          this.parked = true;
          this.apply();
        }, this.env.hiddenDropMs ?? CHAT_POSTGRES_HIDDEN_DROP_MS);
    } else if (this.parked) {
      this.parked = false;
      this.resuming = true;
      this.apply();
    }
  }

  /** What is subscribed now (for tests and diagnostics). */
  live(): ChatPostgresLive {
    return { ...this.current };
  }

  /** What the window wants open now. */
  wanted(): ChatPostgresLive {
    return chatPostgresWanted(this.effectiveAbly(), this.parked);
  }

  private effectiveAbly(): AblyRoomLink {
    return this.ably === "pending" && this.pendingTooLong ? "down" : this.ably;
  }

  private timePending() {
    if (this.ably !== "pending") {
      this.clear(this.pendingTimer);
      this.pendingTimer = undefined;
      this.pendingTooLong = false;
      return;
    }
    if (this.pendingTimer || this.pendingTooLong) return;
    this.pendingTimer = this.later(() => {
      this.pendingTimer = undefined;
      this.pendingTooLong = true;
      this.apply();
    }, this.env.pendingMs ?? CHAT_ABLY_PENDING_MS);
  }

  private apply() {
    if (this.stopped) return;
    const want = this.wanted();
    for (const channel of CHAT_POSTGRES_CHANNELS) {
      const close = this.channels.get(channel);
      if (want[channel] && !close) {
        let open = true;
        let stop: (() => void) | undefined;
        // Registered before opening: a status may arrive synchronously.
        this.channels.set(channel, () => {
          open = false;
          stop?.();
        });
        stop = this.env.open(channel, (subscribed) => {
          if (open && !this.stopped) this.report(channel, subscribed);
        });
        if (!open) stop();
      } else if (!want[channel] && close) {
        this.channels.delete(channel);
        close();
        this.report(channel, false);
      }
    }
  }

  private report(channel: ChatPostgresChannel, subscribed: boolean) {
    if (this.current[channel] === subscribed) return;
    this.current = { ...this.current, [channel]: subscribed };
    this.env.live(this.live());
    if (channel === "direct" && subscribed && this.resuming) {
      this.resuming = false;
      this.env.resumed?.();
    }
  }

  private later(run: () => void, ms: number) {
    return (this.env.setTimeout ?? setTimeout)(run, ms);
  }
  private clear(timer: ReturnType<typeof setTimeout> | undefined) {
    if (timer !== undefined) (this.env.clearTimeout ?? clearTimeout)(timer);
  }
}
