import { describe, expect, it } from "vitest";
import { tokenizeChatMessage, tradingViewSnapshotFromText } from "@/lib/boardroomChatLinks";

describe("Boardroom chat links", () => {
  it("builds a TradingView snapshot from a shared chart URL", () => {
    expect(tradingViewSnapshotFromText("https://www.tradingview.com/x/G4bHTjTX/")).toEqual({
      chartId: "G4bHTjTX",
      href: "https://www.tradingview.com/x/G4bHTjTX/",
      imageUrl: "https://s3.tradingview.com/snapshots/g/G4bHTjTX.png",
    });
  });

  it("finds a chart link inside a message and ignores trailing punctuation", () => {
    expect(tradingViewSnapshotFromText(
      "IPST chart: https://tradingview.com/x/G4bHTjTX/. Thoughts?",
    )?.chartId).toBe("G4bHTjTX");
  });

  it("rejects lookalike hosts, insecure URLs, and malformed chart IDs", () => {
    expect(tradingViewSnapshotFromText("https://tradingview.com.evil/x/G4bHTjTX/")).toBeNull();
    expect(tradingViewSnapshotFromText("http://www.tradingview.com/x/G4bHTjTX/")).toBeNull();
    expect(tradingViewSnapshotFromText("https://www.tradingview.com/x/not-valid/")).toBeNull();
  });

  it("turns ordinary URLs into link parts while preserving surrounding copy", () => {
    expect(tokenizeChatMessage("See https://example.com/test, then reply.")).toEqual([
      { kind: "text", value: "See " },
      { kind: "link", href: "https://example.com/test", value: "https://example.com/test" },
      { kind: "text", value: "," },
      { kind: "text", value: " then reply." },
    ]);
  });
});
