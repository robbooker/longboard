import { expect, it } from "vitest";
import { realtimeRoomEventChangesThreads, realtimeRoomMessage } from "@/lib/chatRealtimeRoom";
import type { PublicChatMessage } from "@/lib/publicChat";

const shown = (extra: Partial<PublicChatMessage>) =>
  ({ id: "a", guest_id: null, author_label: "Ann", body: "hi", created_at: "2026-10-07T10:00:00Z", member_id: "ann", memberships: ["LB"], ...extra }) as PublicChatMessage;
const row = (extra: Record<string, unknown> = {}) => ({
  id: "new",
  room_slug: "main",
  guest_id: null,
  member_id: "ann",
  author_label: "Ann",
  body: "hello",
  created_at: "2026-10-07T10:01:00Z",
  unread_seq: 9,
  revision: 0,
  search_document: "'hello':1",
  ...extra,
});

it("borrows badges from the same author already on screen without a history reload", () => {
  const result = realtimeRoomMessage([shown({ memberships: ["LB", "SS"] })], row());
  expect(result.needsProjection).toBe(false);
  expect(result.message.memberships).toEqual(["LB", "SS"]);
  expect(result.message).not.toHaveProperty("search_document");
});

it("asks for a reload only when no message by that author is loaded", () => {
  expect(realtimeRoomMessage([shown({ member_id: "bob" })], row()).needsProjection).toBe(true);
  expect(realtimeRoomMessage([shown({ memberships: undefined })], row()).needsProjection).toBe(true);
  expect(realtimeRoomMessage([shown({ pending: true })], row()).needsProjection).toBe(true);
});

it("keeps badges and the projected name when an existing message is edited", () => {
  const result = realtimeRoomMessage([shown({ id: "new", author_label: "Ann Renamed", memberships: ["SS"] })], row({ body: "edited", revision: 1 }));
  expect(result).toEqual({ message: expect.objectContaining({ body: "edited", author_label: "Ann Renamed", memberships: ["SS"] }), needsProjection: false });
});

it("never needs a reload for bot or guest rows", () => {
  expect(realtimeRoomMessage([], row({ bot_slug: "buddy", member_id: null })).needsProjection).toBe(false);
  expect(realtimeRoomMessage([], row({ member_id: null })).message.memberships).toEqual([]);
});

it("refreshes thread data only for replies, edits and deletes", () => {
  expect(realtimeRoomEventChangesThreads({ eventType: "INSERT", new: { reply_to_id: null } })).toBe(false);
  expect(realtimeRoomEventChangesThreads({ eventType: "INSERT", new: { reply_to_id: "p" } })).toBe(true);
  expect(realtimeRoomEventChangesThreads({ eventType: "UPDATE", new: {} })).toBe(true);
  expect(realtimeRoomEventChangesThreads({ eventType: "DELETE", old: { id: "a" } })).toBe(true);
});
