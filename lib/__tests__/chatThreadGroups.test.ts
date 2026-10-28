import { describe, expect, it } from "vitest";
import { threadReplyGroups } from "@/lib/chatThreadGroups";

const at = (h: number, min: number, d = 14) => new Date(2026, 9, d, h, min).toISOString();
const reply = (id: string, who: string, h: number, min: number, d = 14) => ({
  id,
  created_at: at(h, min, d),
  member_id: who,
  author_label: who,
});

describe("threadReplyGroups", () => {
  it("tucks the same person's back-to-back replies under the first", () => {
    const rows = [reply("a", "ann", 9, 0), reply("b", "bob", 9, 1), reply("c", "bob", 9, 2), reply("d", "bob", 9, 4)];
    expect(threadReplyGroups(rows)).toEqual([false, false, true, true]);
  });
  it("starts a new group for another person, a gap over 5 minutes, or a new day", () => {
    const rows = [
      reply("a", "bob", 9, 0),
      reply("b", "ann", 9, 1),
      reply("c", "bob", 9, 2),
      reply("d", "bob", 9, 9),
      reply("e", "bob", 0, 1, 15),
    ];
    expect(threadReplyGroups(rows)).toEqual([false, false, false, false, false]);
  });
  it("starts a new group at the unread marker", () => {
    const rows = [reply("a", "bob", 9, 0), reply("b", "bob", 9, 1), reply("c", "bob", 9, 2)];
    expect(threadReplyGroups(rows, { unreadStart: "b" })).toEqual([false, false, true]);
  });
  it("keeps a reply that answers another reply on its own name line", () => {
    const rows = [reply("a", "bob", 9, 0), reply("b", "bob", 9, 1), reply("c", "bob", 9, 2)];
    expect(threadReplyGroups(rows, { startsGroup: (row) => row.id === "b" })).toEqual([false, false, true]);
  });
  it("treats a guest and a bot by their own identity", () => {
    const guest = (id: string, min: number) => ({ id, created_at: at(9, min), guest_id: "g1", author_label: "Guest" });
    const buddy = (id: string, min: number) => ({ id, created_at: at(9, min), bot_slug: "buddy", author_label: "Buddy" });
    expect(threadReplyGroups([guest("a", 0), guest("b", 1), buddy("c", 2), buddy("d", 3)])).toEqual([false, true, false, true]);
  });
  it("handles an empty conversation", () => expect(threadReplyGroups([])).toEqual([]));
});
