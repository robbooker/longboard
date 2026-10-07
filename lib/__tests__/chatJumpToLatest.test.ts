import { expect, it } from "vitest";
import { jumpToLatestState, type JumpToLatestInput } from "@/lib/chatJumpToLatest";
import type { PublicChatMessage } from "@/lib/publicChat";

const row = (seq: number, extra: Partial<PublicChatMessage> = {}) =>
  ({ id: `m${seq}`, unread_seq: seq, member_id: "other", author_label: "Other", body: "hi", created_at: "", ...extra }) as PublicChatMessage;
const base: JumpToLatestInput = {
  messages: [row(1), row(2), row(3)],
  awaySeq: Infinity,
  memberId: "me",
  following: false,
  atBottom: false,
  farFromBottom: false,
  hasNewer: false,
};

it("stays hidden while following or already at the bottom", () => {
  expect(jumpToLatestState({ ...base, following: true, awaySeq: 1 })).toBeNull();
  expect(jumpToLatestState({ ...base, atBottom: true, awaySeq: 1 })).toBeNull();
});

it("counts only other people's confirmed messages after the reader left", () => {
  const messages = [row(1), row(2), row(3, { member_id: "me" }), row(4, { pending: true }), row(5, { removed: true }), row(6, { deleted_at: "x" }), row(7)];
  expect(jumpToLatestState({ ...base, messages, awaySeq: 1 })).toEqual({ unseen: 2, label: "2 new messages" });
  expect(jumpToLatestState({ ...base, messages: [row(1), row(2)], awaySeq: 1 })?.label).toBe("1 new message");
});

it("offers a plain jump when far up with nothing new, and hides when close with nothing new", () => {
  expect(jumpToLatestState({ ...base, awaySeq: 3, farFromBottom: true })).toEqual({ unseen: 0, label: "Jump to latest" });
  expect(jumpToLatestState({ ...base, awaySeq: 3 })).toBeNull();
});

it("always offers a jump from an older page, even at its bottom", () => {
  expect(jumpToLatestState({ ...base, atBottom: true, following: true, hasNewer: true })?.label).toBe("Jump to latest");
});

it("counts unread below an opening anchor", () => {
  // Opening sets awaySeq to the first unread sequence minus one.
  expect(jumpToLatestState({ ...base, awaySeq: 1 })?.unseen).toBe(2);
});
