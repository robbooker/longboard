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

describe("D-366 clickable links", () => {
  const links = (body: string) =>
    tokenizeChatMessage(body).flatMap((part) => (part.kind === "link" ? [{ href: part.href, value: part.value }] : []));
  const text = (body: string) => tokenizeChatMessage(body).map((part) => part.value).join("");

  it("links a full https address and keeps the rest of the text", () => {
    expect(tokenizeChatMessage("Check https://robbooker.com for details")).toEqual([
      { kind: "text", value: "Check " },
      { kind: "link", href: "https://robbooker.com", value: "https://robbooker.com" },
      { kind: "text", value: " for details" },
    ]);
  });

  it("links the long Google Docs address from the reply in one piece", () => {
    const url = "https://docs.google.com/document/d/1CnAJCTnQ5J32ZyCSNkWGdk4BbUAKen9p_vGRf8fxhos/edit?usp=sharing";
    expect(links(`Here it is ${url}`)).toEqual([{ href: url, value: url }]);
  });

  it("links http and www. addresses without the final dot", () => {
    expect(tokenizeChatMessage("see www.example.com.")).toEqual([
      { kind: "text", value: "see " },
      { kind: "link", href: "https://www.example.com", value: "www.example.com" },
      { kind: "text", value: "." },
    ]);
    expect(links("old http://example.org/a?b=1, ok")).toEqual([{ href: "http://example.org/a?b=1", value: "http://example.org/a?b=1" }]);
  });

  it("links bare domains, with paths and subdomains", () => {
    expect(tokenizeChatMessage("robbooker.com")).toEqual([
      { kind: "link", href: "https://robbooker.com", value: "robbooker.com" },
    ]);
    expect(links("Go to club.robbooker.com/join! and bbc.co.uk")).toEqual([
      { href: "https://club.robbooker.com/join", value: "club.robbooker.com/join" },
      { href: "https://bbc.co.uk", value: "bbc.co.uk" },
    ]);
  });

  it("leaves trailing punctuation and brackets outside the link", () => {
    expect(links("(robbooker.com), robbooker.com; robbooker.com? robbooker.com!")).toEqual(
      Array(4).fill({ href: "https://robbooker.com", value: "robbooker.com" }),
    );
    expect(text("(see https://example.com/a).")).toBe("(see https://example.com/a).");
  });

  it("does not link ordinary text that only looks a bit like an address", () => {
    for (const body of [
      "e.g. this, i.e. that",
      "up 3.5% today, v1.2.3",
      "attached report.pdf and notes.txt",
      "I like node.js and main.py",
      "$AAPL and SHOP.TO and SAP.DE",
      "done.Then I left",
      "email rob@robbooker.com",
      "path /home/robbooker.com/file",
      "robbooker.community",
    ]) {
      expect(links(body), body).toEqual([]);
      expect(text(body), body).toBe(body);
    }
  });

  it("never links unsafe schemes and always gives bare addresses https", () => {
    for (const body of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:msgbox(1)", "file:///etc/passwd", "//example.com"]) {
      expect(links(body), body).toEqual([]);
    }
    expect(links("javascript:robbooker.com")).toEqual([]);
    for (const { href } of links("a.com www.b.net https://c.org http://d.io"))
      expect(href).toMatch(/^https?:\/\//);
  });
});
