import { describe, expect, it } from "vitest";
import type { PublicChatMessage } from "@/lib/publicChat";
import {
  THREAD_TAIL_SEQ,
  appendThreadPage,
  threadNewRepliesPill,
  threadNewestSeq,
  threadRange,
  threadTakesLiveReply,
  threadWindowRead,
} from "@/lib/chatThreadWindow";

const reply = (seq: number, extra: Partial<PublicChatMessage> = {}): PublicChatMessage =>
  ({
    id: `r${seq}`,
    room_slug: "main",
    body: `Reply ${seq}`,
    author_label: "Bob",
    member_id: "bob",
    created_at: new Date(Date.UTC(2026, 10, 4, 12, 0, seq)).toISOString(),
    unread_seq: seq,
    ...extra,
  }) as PublicChatMessage;
const seqs = (rows: PublicChatMessage[]) => rows.map((row) => row.unread_seq);

describe("thread window reads (#363)", () => {
  it("parses only a range query", () => {
    expect(threadRange("range=4,9")).toEqual([4, 9]);
    expect(threadRange("")).toBeNull();
    expect(threadRange("around=abc")).toBeNull();
  });

  it("reads a window that reaches the newest reply open-ended, so new replies come with it", () => {
    expect(threadWindowRead("range=4,9", true)).toBe(`range=4,${THREAD_TAIL_SEQ}`);
    // The open bound still passes the window read's cursor check (16 digits, a safe integer).
    expect(String(THREAD_TAIL_SEQ)).toMatch(/^\d{1,16}$/);
    expect(Number.isSafeInteger(THREAD_TAIL_SEQ)).toBe(true);
  });

  it("reads an older window exactly, and leaves the latest page and openings alone", () => {
    expect(threadWindowRead("range=4,9", false)).toBe("range=4,9");
    expect(threadWindowRead("", true)).toBe("");
    expect(threadWindowRead("around=abc", true)).toBe("around=abc");
  });

  it("takes a live reply straight away on the latest page or a window at the newest reply", () => {
    expect(threadTakesLiveReply("", true)).toBe(true);
    expect(threadTakesLiveReply("range=4,9", true)).toBe(true);
    expect(threadTakesLiveReply("range=4,9", false)).toBe(false);
  });
});

describe("Newer replies adds below (#363)", () => {
  it("keeps the earlier replies and adds the newer page after them", () => {
    const shown = [reply(4), reply(5), reply(6)];
    const next = appendThreadPage(shown, [reply(7), reply(8)], "range=4,6");
    expect(seqs(next.replies)).toEqual([4, 5, 6, 7, 8]);
    expect(next.query).toBe("range=4,8");
    expect(next.trimmed).toBe(false);
  });

  it("does not repeat a reply it already shows, and keeps the newer copy", () => {
    const shown = [reply(4), reply(5)];
    const edited = reply(5, { body: "Edited", revision: 2 });
    const next = appendThreadPage(shown, [edited, reply(6)], "range=4,5");
    expect(seqs(next.replies)).toEqual([4, 5, 6]);
    expect(next.replies[1].body).toBe("Edited");
  });

  it("keeps a removed reply's tombstone where it was", () => {
    const shown = [reply(4), reply(5, { removed: true }), reply(6)];
    const next = appendThreadPage(shown, [reply(7)], "range=4,6");
    expect(seqs(next.replies)).toEqual([4, 5, 6, 7]);
    expect(next.query).toBe("range=4,7");
  });

  it("past the window size drops the oldest and says so", () => {
    const shown = [1, 2, 3, 4].map((seq) => reply(seq));
    const next = appendThreadPage(shown, [reply(5), reply(6)], "range=1,4", 4);
    expect(seqs(next.replies)).toEqual([3, 4, 5, 6]);
    expect(next.query).toBe("range=3,6");
    expect(next.trimmed).toBe(true);
  });
});

describe("new replies pill (#363)", () => {
  const shown = [reply(4), reply(5), reply(6, { member_id: "alice" }), reply(7)];
  it("is hidden while the reader follows the newest reply", () => {
    expect(threadNewRepliesPill(shown, 4, true, "alice")).toBeNull();
  });
  it("counts replies from others that came after what the reader saw", () => {
    expect(threadNewRepliesPill(shown, 4, false, "alice")).toEqual({ unseen: 2, label: "2 new replies" });
    expect(threadNewRepliesPill(shown, 6, false, "alice")).toEqual({ unseen: 1, label: "1 new reply" });
  });
  it("is hidden when nothing new came or before the thread loaded", () => {
    expect(threadNewRepliesPill(shown, 7, false, "alice")).toBeNull();
    expect(threadNewRepliesPill(shown, 0, false, "alice")).toBeNull();
  });
  it("skips deleted and removed replies", () => {
    const rows = [reply(4), reply(5, { deleted_at: "x" }), reply(6, { removed: true })];
    expect(threadNewRepliesPill(rows, 4, false, "alice")).toBeNull();
    expect(threadNewestSeq(rows)).toBe(6);
  });
});
