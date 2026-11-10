import { describe, expect, it } from "vitest";
import {
  radioEventKey,
  radioEventLabel,
  radioEventsInOrder,
  radioLineBlocked,
  radioNewEvents,
  radioStartQueue,
  type RadioEvent,
} from "@/lib/chatRadio";

const NOW = Date.parse("2026-11-10T14:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const squawk = (minutes: number, extra: Partial<RadioEvent> = {}): RadioEvent => ({
  at: ago(minutes),
  type: "alert",
  line: `line ${minutes}`,
  audioUrl: `/clip/${minutes}`,
  sourceId: `id-${minutes}`,
  ...extra,
});

describe("Trader Radio listening rules", () => {
  it("plays oldest first, and same-instant squawks in playlist order", () => {
    const events = [squawk(1), squawk(9), squawk(5, { sequenceIndex: 1, sourceId: "b" }), squawk(5, { sequenceIndex: 0, sourceId: "a" })];
    expect(radioEventsInOrder(events).map((event) => event.sourceId)).toEqual(["id-9", "a", "b", "id-1"]);
  });
  it("starts at the live point: the newest squawk only, and none of the backlog", () => {
    const { queue, heard } = radioStartQueue([squawk(1), squawk(4), squawk(20), squawk(50)], NOW);
    expect(queue.map((event) => event.sourceId)).toEqual(["id-1"]);
    expect(heard.size).toBe(4);
  });
  it("starts silent when the newest squawk is over 30 minutes old", () => {
    const { queue, heard } = radioStartQueue([squawk(31), squawk(90)], NOW);
    expect(queue).toEqual([]);
    expect(heard.size).toBe(2);
  });
  it("starts with the whole playlist of the newest squawk, in order", () => {
    const list = { type: "episode" as const, playlistId: "evening" };
    const events = [squawk(2, { ...list, sequenceIndex: 2, sourceId: "c" }), squawk(2, { ...list, sequenceIndex: 0, sourceId: "a" }), squawk(2, { ...list, sequenceIndex: 1, sourceId: "b" }), squawk(10)];
    expect(radioStartQueue(events, NOW).queue.map((event) => event.sourceId)).toEqual(["a", "b", "c"]);
  });
  it("queues each later squawk once, and never one from before play was pressed", () => {
    const first = [squawk(1), squawk(4)];
    const { heard } = radioStartQueue(first, NOW);
    const late = squawk(-1);
    const backfilled = squawk(8, { sourceId: "old-but-new-to-us" });
    expect(radioNewEvents([...first, late, backfilled], NOW, heard)).toEqual([late]);
    expect(radioNewEvents([...first, late, backfilled], NOW, heard)).toEqual([]);
  });
  it("tells squawks apart the way TraderRadio does", () => {
    expect(radioEventKey(squawk(1))).toBe("alert|id-1");
    expect(radioEventKey(squawk(1, { sourceId: undefined, sourceTime: "t", symbol: "ABC" }))).toBe("alert|t|ABC|line 1");
    expect(radioEventKey(squawk(1, { type: "station" }))).toBe(`${ago(1)}-station-event-/clip/1`);
    expect(radioEventKey(squawk(1, { type: "session", session: "Premarket" }))).toBe(`${ago(1)}-session-Premarket-/clip/1`);
  });
  it("drops the lines TraderRadio's site never plays", () => {
    expect(radioLineBlocked("TraderRadio, live from the desk.", "station")).toBe(true);
    expect(radioLineBlocked("This is TraderRadio After Dark.", "station")).toBe(false);
    expect(radioLineBlocked("A B C live on the tape.", "alert")).toBe(false);
    expect(radioLineBlocked("Markets are closed today for the holiday.", "overview")).toBe(true);
    expect(radioLineBlocked("Premarket session is open.", "session")).toBe(false);
  });
  it("names what is playing", () => {
    expect(radioEventLabel(squawk(1, { symbol: "PXLW" }))).toBe("PXLW");
    expect(radioEventLabel(squawk(1, { type: "station" }))).toBe("Station ID");
    expect(radioEventLabel(squawk(1, { type: "overview" }))).toBe("Market overview");
    expect(radioEventLabel(squawk(1, { type: "episode" }))).toBe("Evening episode");
    expect(radioEventLabel(squawk(1, { type: "session", line: "Premarket session is open." }))).toBe("Premarket session is open.");
  });
});
