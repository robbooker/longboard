// #511 Stage mode: when a viewer's player holds its LiveKit connection and when it lets go (the
// grace after the broadcast stops, an admin's waiting cap, the hidden-tab rule), and that a
// connection attempt can be let go of at any point. No LiveKit and no browser: plain values.
import { describe, expect, it, vi } from "vitest";
import {
  STAGE_GRACE_MS,
  STAGE_HIDDEN_MS,
  STAGE_LINK_IDLE,
  STAGE_WAITING_CAP_MS,
  holdStageConnection,
  stageLinkStep,
  type StageLinkInput,
  type StageLinkMemory,
} from "@/lib/chatStageLink";

const member: StageLinkInput = { video: true, admin: false, state: "live", picture: false, dead: false, hidden: false, watching: false };
const admin: StageLinkInput = { ...member, admin: true };

/** Feeds steps in order, carrying the memory along; returns the last answer. */
function run(steps: [number, StageLinkInput][], from: StageLinkMemory = STAGE_LINK_IDLE) {
  let memory = from;
  let wake: number | null = null;
  for (const [at, input] of steps) ({ memory, wake } = stageLinkStep(memory, input, at));
  return { memory, wake };
}

describe("the timings", () => {
  it("are the ones the ticket asks for", () => {
    expect(STAGE_GRACE_MS).toBe(25_000);
    expect(STAGE_WAITING_CAP_MS).toBe(600_000);
    expect(STAGE_HIDDEN_MS).toBe(300_000);
  });
});

describe("who connects", () => {
  it("nobody while live video is off or not set up", () => {
    expect(run([[0, { ...admin, state: "off" }]]).memory).toEqual(STAGE_LINK_IDLE);
    expect(run([[0, { ...admin, video: false }]]).memory).toEqual(STAGE_LINK_IDLE);
  });
  it("a member never connects while the room is only waiting", () => {
    const { memory, wake } = run([
      [0, { ...member, state: "waiting" }],
      [60_000, { ...member, state: "waiting", signal: true }],
    ]);
    expect(memory.open).toBe(false);
    expect(memory.closed).toBe(null);
    expect(wake).toBe(null);
  });
  it("a member connects when the room is live; an admin also while it waits", () => {
    expect(run([[0, member]]).memory.open).toBe(true);
    expect(run([[0, { ...admin, state: "waiting" }]]).memory.open).toBe(true);
  });
});

describe("the broadcast stops", () => {
  const playing: [number, StageLinkInput][] = [
    [0, member],
    [1_000, { ...member, picture: true }],
  ];
  it("nothing is timed while the picture plays", () => {
    expect(run(playing)).toEqual({ memory: { ...STAGE_LINK_IDLE, open: true }, wake: null });
  });
  it("a member rides out a short drop, even if the status says waiting meanwhile", () => {
    const { memory, wake } = run([...playing, [10_000, member], [12_000, { ...member, state: "waiting" }], [10_000 + STAGE_GRACE_MS - 1, { ...member, state: "waiting" }]]);
    expect(memory.open).toBe(true);
    expect(wake).toBe(10_000 + STAGE_GRACE_MS);
    // It came back inside the grace: the clock is cleared.
    expect(stageLinkStep(memory, { ...member, picture: true }, 30_000)).toEqual({ memory: { ...STAGE_LINK_IDLE, open: true }, wake: null });
  });
  it("after the grace the member is disconnected, and stays so while the room is not live", () => {
    const gone = run([...playing, [10_000, member], [12_000, { ...member, state: "waiting" }], [10_000 + STAGE_GRACE_MS, { ...member, state: "waiting" }]]);
    expect(gone.memory).toMatchObject({ open: false, closed: "gone" });
    expect(gone.wake).toBe(null);
    const later = stageLinkStep(gone.memory, { ...member, state: "waiting", signal: true }, 3_600_000);
    expect(later.memory).toMatchObject({ open: false, closed: "gone" });
    // Live again: connects by itself, with a fresh grace.
    const back = stageLinkStep(later.memory, member, 3_700_000);
    expect(back.memory).toMatchObject({ open: true, closed: null, idleSince: 3_700_000 });
    expect(back.wake).toBe(3_700_000 + STAGE_GRACE_MS);
  });
  it("a picture that never arrives in a room reported live does not reconnect in a loop", () => {
    const gone = run([[0, member], [STAGE_GRACE_MS, member]]);
    expect(gone.memory).toMatchObject({ open: false, closed: "gone", closedLive: true });
    // Still reported live, nothing new: stays disconnected.
    expect(stageLinkStep(gone.memory, member, 500_000).memory.open).toBe(false);
    // A new signal for the room: one more try.
    expect(stageLinkStep(gone.memory, { ...member, signal: true }, 500_000).memory.open).toBe(true);
    // Or the status going not-live and then live.
    const waiting = stageLinkStep(gone.memory, { ...member, state: "waiting" }, 500_000);
    expect(waiting.memory.open).toBe(false);
    expect(stageLinkStep(waiting.memory, member, 501_000).memory.open).toBe(true);
  });
  it("the room going off forgets everything", () => {
    const gone = run([[0, member], [STAGE_GRACE_MS, member]]);
    expect(stageLinkStep(gone.memory, { ...member, state: "off" }, 99_000).memory).toEqual(STAGE_LINK_IDLE);
  });
  it("a connection that already failed or was closed by the server is not timed", () => {
    const { memory, wake } = run([[0, member], [5_000, { ...member, dead: true }], [900_000, { ...member, dead: true }]]);
    expect(memory).toMatchObject({ open: true, closed: null });
    expect(wake).toBe(null);
  });
});

describe("an admin waiting for the broadcast", () => {
  const waiting = { ...admin, state: "waiting" as const };
  it("holds one connection up to the cap, then lets go", () => {
    const held = run([[0, waiting], [STAGE_WAITING_CAP_MS - 1, waiting]]);
    expect(held.memory.open).toBe(true);
    expect(held.wake).toBe(STAGE_WAITING_CAP_MS);
    const gone = stageLinkStep(held.memory, waiting, STAGE_WAITING_CAP_MS);
    expect(gone.memory).toMatchObject({ open: false, closed: "gone" });
    // More signals while it is still only waiting do not reconnect it.
    expect(stageLinkStep(gone.memory, { ...waiting, signal: true }, STAGE_WAITING_CAP_MS + 1).memory.open).toBe(false);
    // The broadcast arrives (the status says live): connected again.
    expect(stageLinkStep(gone.memory, admin, STAGE_WAITING_CAP_MS + 2).memory.open).toBe(true);
  });
  it("the cap counts from when the picture stopped", () => {
    const { memory, wake } = run([[0, waiting], [300_000, { ...admin, picture: true }], [400_000, waiting]]);
    expect(memory.open).toBe(true);
    expect(wake).toBe(400_000 + STAGE_WAITING_CAP_MS);
  });
});

describe("a hidden tab", () => {
  const playing = { ...member, picture: true };
  const hidden = { ...playing, hidden: true };
  it("is disconnected after five minutes, and connects again when it is back and the room is live", () => {
    const held = run([[0, playing], [1_000, hidden], [1_000 + STAGE_HIDDEN_MS - 1, hidden]]);
    expect(held.memory.open).toBe(true);
    expect(held.wake).toBe(1_000 + STAGE_HIDDEN_MS);
    const gone = stageLinkStep(held.memory, hidden, 1_000 + STAGE_HIDDEN_MS);
    expect(gone.memory).toMatchObject({ open: false, closed: "hidden" });
    // The connection closing takes the picture with it; still hidden: still disconnected.
    expect(stageLinkStep(gone.memory, { ...hidden, picture: false }, 900_000).memory.open).toBe(false);
    expect(stageLinkStep(gone.memory, member, 900_001).memory).toMatchObject({ open: true, closed: null });
  });
  it("stays disconnected on return if the room is no longer live (a member)", () => {
    const gone = run([[0, playing], [1_000, hidden], [1_000 + STAGE_HIDDEN_MS, hidden]]);
    expect(stageLinkStep(gone.memory, { ...member, state: "waiting" }, 900_000).memory).toMatchObject({ open: false, closed: null });
  });
  it("is left alone while it is being watched: picture-in-picture, or sound playing", () => {
    const watching = { ...hidden, watching: true };
    const { memory, wake } = run([[0, playing], [1_000, watching], [3_600_000, watching]]);
    expect(memory.open).toBe(true);
    expect(wake).toBe(null);
    // Muted or paused from then on: five minutes from that moment.
    const muted = stageLinkStep(memory, hidden, 3_600_000);
    expect(muted.wake).toBe(3_600_000 + STAGE_HIDDEN_MS);
    expect(stageLinkStep(muted.memory, hidden, 3_600_000 + STAGE_HIDDEN_MS).memory.closed).toBe("hidden");
  });
  it("coming back before the five minutes clears the clock", () => {
    const { memory, wake } = run([[0, playing], [1_000, hidden], [200_000, playing], [250_000, hidden]]);
    expect(memory.open).toBe(true);
    expect(wake).toBe(250_000 + STAGE_HIDDEN_MS);
  });
  it("the earlier of the two clocks is the one waited for", () => {
    const { wake } = run([[0, member], [1_000, { ...member, hidden: true }]]);
    expect(wake).toBe(STAGE_GRACE_MS);
  });
});

describe("letting go of a connection attempt", () => {
  const connection = () => ({ close: vi.fn() });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("closes a connection that is up, once", async () => {
    const made = connection();
    const ready = vi.fn();
    const close = holdStageConnection(async () => made, ready, vi.fn());
    await settle();
    expect(ready).toHaveBeenCalledWith(made);
    close();
    close();
    expect(made.close).toHaveBeenCalledTimes(1);
  });
  it("let go of while still connecting: the signal is aborted and the late connection is closed, unreported", async () => {
    const made = connection();
    const ready = vi.fn();
    let arrive!: (value: typeof made) => void;
    let seen!: AbortSignal;
    const close = holdStageConnection(
      (signal) => {
        seen = signal;
        return new Promise<typeof made>((resolve) => (arrive = resolve));
      },
      ready,
      vi.fn(),
    );
    close();
    expect(seen.aborted).toBe(true);
    arrive(made);
    await settle();
    expect(made.close).toHaveBeenCalledTimes(1);
    expect(ready).not.toHaveBeenCalled();
  });
  it("a failure is reported, but not after it was let go of", async () => {
    const failed = vi.fn();
    holdStageConnection(async () => Promise.reject(new Error("x")), vi.fn(), failed);
    await settle();
    expect(failed).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    const close = holdStageConnection(async () => Promise.reject(new Error("x")), vi.fn(), late);
    close();
    await settle();
    expect(late).not.toHaveBeenCalled();
  });
  it("nothing to connect to is neither ready nor a failure", async () => {
    const ready = vi.fn();
    const failed = vi.fn();
    holdStageConnection(async () => null, ready, failed);
    await settle();
    expect(ready).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
});
