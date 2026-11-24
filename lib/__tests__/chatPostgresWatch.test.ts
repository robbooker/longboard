import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_ABLY_PENDING_MS,
  CHAT_POSTGRES_HIDDEN_DROP_MS,
  ChatPostgresWatch,
  chatPostgresWanted,
  type AblyRoomLink,
  type ChatPostgresChannel,
} from "@/lib/chatPostgresWatch";

describe("chatPostgresWanted", () => {
  it("watches the room tables only while Ably is not live, and DMs always", () => {
    const cases: Array<[AblyRoomLink, boolean]> = [
      ["live", false],
      ["pending", false],
      ["off", true],
      ["down", true],
    ];
    for (const [ably, rooms] of cases) expect(chatPostgresWanted(ably, false)).toEqual({ rooms, direct: true });
  });
  it("watches nothing while the tab is parked", () => {
    for (const ably of ["live", "pending", "off", "down"] as const)
      expect(chatPostgresWanted(ably, true)).toEqual({ rooms: false, direct: false });
  });
});

describe("ChatPostgresWatch", () => {
  let hidden = false;
  let opened: Array<{ channel: ChatPostgresChannel; status: (s: boolean) => void; closed: boolean }>;
  let lives: Array<{ rooms: boolean; direct: boolean }>;
  let resumed: number;
  let subscribeAtOnce = true;
  const make = () =>
    new ChatPostgresWatch({
      hidden: () => hidden,
      open: (channel, status) => {
        const entry = { channel, status, closed: false };
        opened.push(entry);
        if (subscribeAtOnce) status(true);
        return () => {
          entry.closed = true;
        };
      },
      live: (live) => lives.push(live),
      resumed: () => resumed++,
    });
  const openNow = () => opened.filter((c) => !c.closed).map((c) => c.channel).sort();
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    opened = [];
    lives = [];
    resumed = 0;
    subscribeAtOnce = true;
  });
  afterEach(() => vi.useRealTimers());

  it("with Ably live, holds only the DM channel", () => {
    const watch = make();
    watch.start("live");
    expect(openNow()).toEqual(["direct"]);
    expect(watch.live()).toEqual({ rooms: false, direct: true });
  });

  it("without Ably for this window, watches the rooms at once", () => {
    const watch = make();
    watch.start("off");
    expect(openNow()).toEqual(["direct", "rooms"]);
    expect(watch.live()).toEqual({ rooms: true, direct: true });
  });

  it("waits for a first Ably connection, then never joins the room tables", () => {
    const watch = make();
    watch.start("pending");
    expect(openNow()).toEqual(["direct"]);
    vi.advanceTimersByTime(CHAT_ABLY_PENDING_MS - 1);
    watch.setAbly("live");
    vi.advanceTimersByTime(CHAT_ABLY_PENDING_MS * 2);
    expect(opened.map((c) => c.channel)).toEqual(["direct"]);
  });

  it("watches the rooms when the first Ably connection takes too long, and stops once it is up", () => {
    const watch = make();
    watch.start("pending");
    vi.advanceTimersByTime(CHAT_ABLY_PENDING_MS);
    expect(openNow()).toEqual(["direct", "rooms"]);
    watch.setAbly("live");
    expect(openNow()).toEqual(["direct"]);
    expect(watch.live()).toEqual({ rooms: false, direct: true });
  });

  it("re-attaches the room tables as soon as Ably drops, and detaches when it is back", () => {
    const watch = make();
    watch.start("live");
    watch.setAbly("down");
    expect(openNow()).toEqual(["direct", "rooms"]);
    expect(lives.at(-1)).toEqual({ rooms: true, direct: true });
    watch.setAbly("live");
    expect(openNow()).toEqual(["direct"]);
    expect(lives.at(-1)).toEqual({ rooms: false, direct: true });
    // The DM channel stayed open through it all.
    expect(opened.filter((c) => c.channel === "direct")).toHaveLength(1);
  });

  it("reports a room channel live only once it has subscribed", () => {
    subscribeAtOnce = false;
    const watch = make();
    watch.start("down");
    expect(watch.live()).toEqual({ rooms: false, direct: false });
    opened.find((c) => c.channel === "rooms")!.status(true);
    expect(watch.live()).toEqual({ rooms: true, direct: false });
    opened.find((c) => c.channel === "rooms")!.status(false);
    expect(watch.live()).toEqual({ rooms: false, direct: false });
  });

  it("drops every channel after the tab has been hidden a minute, and reopens it on return", () => {
    const watch = make();
    watch.start("down");
    hidden = true;
    watch.visibility();
    vi.advanceTimersByTime(CHAT_POSTGRES_HIDDEN_DROP_MS - 1);
    expect(openNow()).toEqual(["direct", "rooms"]);
    vi.advanceTimersByTime(1);
    expect(openNow()).toEqual([]);
    expect(watch.live()).toEqual({ rooms: false, direct: false });
    // Ably changing while parked opens nothing.
    watch.setAbly("live");
    expect(openNow()).toEqual([]);
    hidden = false;
    watch.visibility();
    expect(openNow()).toEqual(["direct"]);
    expect(resumed).toBe(1);
  });

  it("keeps the channels when the tab comes back within the minute", () => {
    const watch = make();
    watch.start("live");
    hidden = true;
    watch.visibility();
    vi.advanceTimersByTime(CHAT_POSTGRES_HIDDEN_DROP_MS / 2);
    hidden = false;
    watch.visibility();
    vi.advanceTimersByTime(CHAT_POSTGRES_HIDDEN_DROP_MS * 2);
    expect(opened).toHaveLength(1);
    expect(openNow()).toEqual(["direct"]);
    expect(resumed).toBe(0);
  });

  it("catches up only once the DM channel has subscribed again", () => {
    const watch = make();
    watch.start("live");
    hidden = true;
    watch.visibility();
    vi.advanceTimersByTime(CHAT_POSTGRES_HIDDEN_DROP_MS);
    subscribeAtOnce = false;
    hidden = false;
    watch.visibility();
    expect(resumed).toBe(0);
    opened.at(-1)!.status(true);
    expect(resumed).toBe(1);
    // A later resubscribe (a network blip) is not a return from hidden.
    opened.at(-1)!.status(false);
    opened.at(-1)!.status(true);
    expect(resumed).toBe(1);
  });

  it("a tab opened hidden parks too", () => {
    hidden = true;
    const watch = make();
    watch.start("off");
    vi.advanceTimersByTime(CHAT_POSTGRES_HIDDEN_DROP_MS);
    expect(openNow()).toEqual([]);
  });

  it("stop closes everything and ignores late statuses and timers", () => {
    subscribeAtOnce = false;
    const watch = make();
    watch.start("pending");
    const direct = opened[0];
    watch.stop();
    expect(openNow()).toEqual([]);
    direct.status(true);
    vi.advanceTimersByTime(CHAT_ABLY_PENDING_MS * 2);
    watch.setAbly("down");
    expect(openNow()).toEqual([]);
    expect(lives).toEqual([]);
  });

  it("a channel closed while it is still opening is closed when its open returns", () => {
    let close = 0;
    const watch = new ChatPostgresWatch({
      hidden: () => false,
      live: () => undefined,
      open: (channel) => {
        // Ably comes up while the room channel is being opened.
        if (channel === "rooms") watch.setAbly("live");
        return () => {
          if (channel === "rooms") close++;
        };
      },
    });
    watch.start("down");
    expect(close).toBe(1);
  });
});
