import { describe, expect, it } from "vitest";
import {
  countChatters,
  isReservedChatName,
  mergeMessage,
  mergeReaction,
  reactionSummary,
  tokenizeChatMessage,
  tradingViewSnapshotFromText,
  type PublicChatMessage,
  type PublicChatReaction,
} from "@/lib/publicChat";

const message = (overrides: Partial<PublicChatMessage> = {}): PublicChatMessage => ({
  id: "message-1",
  guest_id: "guest-1",
  author_label: "Rob",
  body: "Hello",
  created_at: "2026-08-27T12:00:00.000Z",
  ...overrides,
});

const reaction = (overrides: Partial<PublicChatReaction> = {}): PublicChatReaction => ({
  message_id: "message-1",
  guest_id: "guest-1",
  active: true,
  created_at: "2026-08-27T12:00:00.000Z",
  updated_at: "2026-08-27T12:00:00.000Z",
  ...overrides,
});

describe("public chat helpers", () => {
  it("deduplicates realtime messages and keeps chronological order", () => {
    const merged = mergeMessage(
      [message({ id: "message-2", created_at: "2026-08-27T12:02:00.000Z" })],
      message(),
    );
    expect(merged.map((item) => item.id)).toEqual(["message-1", "message-2"]);
    expect(mergeMessage(merged, message())).toHaveLength(2);
  });

  it("summarizes active palm reactions and replaces realtime updates", () => {
    const reactions = mergeReaction(
      [reaction(), reaction({ guest_id: "guest-2" })],
      reaction({ active: false, updated_at: "2026-08-27T12:01:00.000Z" }),
    );
    expect(reactionSummary(reactions, "message-1", "guest-1")).toEqual({ count: 1, reacted: false });
  });

  it("counts one chatter per presence key", () => {
    expect(countChatters({ "guest-1": [{ onlineAt: "now" }, { onlineAt: "now" }], "guest-2": [{}] })).toBe(2);
  });

  it("reserves trusted chat identities against impersonation", () => {
    expect(isReservedChatName("Buddy")).toBe(true);
    expect(isReservedChatName("  LONGBOARD   ADMIN ")).toBe(true);
    expect(isReservedChatName("Rob Booker")).toBe(false);
  });

  it("tokenizes safe links and recognizes exact TradingView snapshots", () => {
    expect(tokenizeChatMessage("Chart https://example.com/a.")).toEqual([
      { kind: "text", value: "Chart " },
      { kind: "link", href: "https://example.com/a", value: "https://example.com/a" },
      { kind: "text", value: "." },
    ]);
    expect(tradingViewSnapshotFromText("https://www.tradingview.com/x/Ab12Cd34/")).toEqual({
      chartId: "Ab12Cd34",
      href: "https://www.tradingview.com/x/Ab12Cd34/",
      imageUrl: "https://s3.tradingview.com/snapshots/a/Ab12Cd34.png",
    });
    expect(tradingViewSnapshotFromText("https://evil.example/x/Ab12Cd34/")).toBeNull();
  });
});
