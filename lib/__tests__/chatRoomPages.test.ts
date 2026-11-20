import { describe, expect, it } from "vitest";
import type { PublicChatMessage } from "@/lib/publicChat";
import { mergeRoomPage } from "@/lib/chatRoomPages";

const row = (seq: number, extra: Partial<PublicChatMessage> = {}): PublicChatMessage =>
  ({
    id: `m${seq}`,
    room_slug: "main",
    body: `Message ${seq}`,
    author_label: "Bob",
    member_id: "bob",
    created_at: new Date(Date.UTC(2026, 10, 20, 12, 0, seq)).toISOString(),
    unread_seq: seq,
    ...extra,
  }) as PublicChatMessage;
const rows = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i));
const seqs = (list: PublicChatMessage[]) => list.map((message) => message.unread_seq ?? null);

describe("room history pages (#473)", () => {
  it("Earlier messages go above the messages shown, which stay (same objects)", () => {
    const shown = rows(11, 20);
    const next = mergeRoomPage(shown, rows(1, 10), "before");
    expect(seqs(next.messages)).toEqual(seqs(rows(1, 20)));
    expect(next.messages[10]).toBe(shown[0]);
    expect(next.range).toBe("1,20");
    expect([next.droppedOlder, next.droppedNewer]).toEqual([false, false]);
  });

  it("Newer messages go below", () => {
    const next = mergeRoomPage(rows(1, 10), rows(11, 20), "after");
    expect(seqs(next.messages)).toEqual(seqs(rows(1, 20)));
    expect(next.range).toBe("1,20");
  });

  it("past the window size drop the far end: the newest for Earlier, the oldest for Newer", () => {
    const before = mergeRoomPage(rows(11, 20), rows(1, 10), "before", { max: 15 });
    expect(seqs(before.messages)).toEqual(seqs(rows(1, 15)));
    expect([before.droppedOlder, before.droppedNewer]).toEqual([false, true]);
    expect(before.range).toBe("1,15");
    const after = mergeRoomPage(rows(1, 10), rows(11, 20), "after", { max: 15 });
    expect(seqs(after.messages)).toEqual(seqs(rows(6, 20)));
    expect([after.droppedOlder, after.droppedNewer]).toEqual([true, false]);
  });

  it("keeps the rows on screen too, up to the limit; the new page always joins whole", () => {
    // The reader is at messages 18-19 (a scroll had already loaded a page above them).
    const before = mergeRoomPage(rows(11, 20), rows(1, 10), "before", { max: 15, limit: 19, keep: [18, 19] });
    expect(seqs(before.messages)).toEqual(seqs(rows(1, 19)));
    expect([before.droppedOlder, before.droppedNewer]).toEqual([false, true]);
    const after = mergeRoomPage(rows(1, 10), rows(11, 20), "after", { max: 15, limit: 19, keep: [2, 3] });
    expect(seqs(after.messages)).toEqual(seqs(rows(2, 20)));
    expect([after.droppedOlder, after.droppedNewer]).toEqual([true, false]);
    // Past the limit the window still moves on (paging always makes progress).
    const far = mergeRoomPage(rows(1, 10), rows(11, 20), "after", { max: 12, limit: 15, keep: [1, 2] });
    expect(seqs(far.messages)).toEqual(seqs(rows(6, 20)));
  });

  it("keeps a send still going at the end and takes the page's copy of a deleted row", () => {
    const sending = row(0, { id: "local", unread_seq: undefined, pending: true } as Partial<PublicChatMessage>);
    const next = mergeRoomPage([...rows(11, 20), sending], [...rows(1, 10), row(12, { removed: true })], "before");
    expect(next.messages.at(-1)?.id).toBe("local");
    expect(next.messages.find((message) => message.id === "m12")?.removed).toBe(true);
    expect(next.range).toBe("1,20");
  });
});
