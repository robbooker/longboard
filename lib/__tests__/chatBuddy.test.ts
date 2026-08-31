import { describe, expect, it } from "vitest";
import { hasBuddyMention, limitBuddyReply, promptForBuddy } from "@/lib/chatBuddy";

describe("Longboard Chat Buddy mentions", () => {
  it("only recognizes an explicit @Buddy mention", () => {
    expect(hasBuddyMention("@Buddy what does a float mean?")).toBe(true);
    expect(hasBuddyMention("Hey, @buddy — can you explain this?")).toBe(true);
    expect(hasBuddyMention("Buddy should answer this")).toBe(false);
    expect(hasBuddyMention("email@buddy.com")).toBe(false);
    expect(hasBuddyMention("@buddybot hello")).toBe(false);
  });

  it("removes the mention without damaging the question", () => {
    expect(promptForBuddy("Hey @Buddy, what's a reverse split?")).toBe("Hey, what's a reverse split?");
    expect(promptForBuddy("@Buddy: hello there")).toBe("hello there");
  });

  it("keeps replies inside the public chat message limit", () => {
    const reply = limitBuddyReply("x".repeat(1800));
    expect(reply).toHaveLength(1400);
    expect(reply.endsWith("…")).toBe(true);
  });
});
