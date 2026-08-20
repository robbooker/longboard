import { describe, expect, it } from "vitest";
import {
  mergeReaction,
  reactionSummary,
  restoreReaction,
  type BoardroomChatReaction,
} from "@/lib/boardroomChatReactions";

function reaction(overrides: Partial<BoardroomChatReaction> = {}): BoardroomChatReaction {
  return {
    message_id: "message-1",
    user_id: "user-1",
    cohort: "cohort-a",
    active: true,
    created_at: "2026-08-20T12:00:00.000Z",
    updated_at: "2026-08-20T12:00:00.000Z",
    ...overrides,
  };
}

describe("Boardroom chat reactions", () => {
  it("counts active palms and reports the current member's reaction", () => {
    const reactions = [reaction(), reaction({ user_id: "user-2" })];

    expect(reactionSummary(reactions, "message-1", "user-1"))
      .toEqual({ count: 2, reacted: true });
  });

  it("replaces a member's durable reaction when realtime updates it", () => {
    const updated = reaction({ active: false, updated_at: "2026-08-20T12:01:00.000Z" });
    const reactions = mergeReaction([reaction(), reaction({ user_id: "user-2" })], updated);

    expect(reactionSummary(reactions, "message-1", "user-1"))
      .toEqual({ count: 1, reacted: false });
  });

  it("restores only the failed optimistic reaction", () => {
    const previous = reaction({ active: false });
    const optimistic = mergeReaction([previous, reaction({ user_id: "user-2" })], reaction());
    const restored = restoreReaction(optimistic, "message-1", "user-1", previous);

    expect(reactionSummary(restored, "message-1", "user-1"))
      .toEqual({ count: 1, reacted: false });
  });
});
