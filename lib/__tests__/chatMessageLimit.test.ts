import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  appendToDraft,
  CHAT_MESSAGE_MAX_LENGTH,
  isOverMessageLimit,
  mayFoldMessage,
  messageLengthNotice,
} from "@/lib/chatMessageLimit";
import ChatMessageBody from "@/components/chat/ChatMessageBody";
import MessageLengthNotice from "@/components/chat/MessageLengthNotice";
import { readChatDraft, saveChatDraft } from "@/lib/chatRefreshDrafts";

// #367: room messages, thread replies and private messages share one 10,000-character limit.
describe("message length limit", () => {
  it("is 10,000 characters, counted after trimming like the server", () => {
    expect(CHAT_MESSAGE_MAX_LENGTH).toBe(10_000);
    expect(isOverMessageLimit("x".repeat(10_000))).toBe(false);
    expect(isOverMessageLimit("x".repeat(10_001))).toBe(true);
    expect(isOverMessageLimit(`  ${"x".repeat(10_000)}\n\n`)).toBe(false);
  });

  it("says nothing for short drafts, as today", () => {
    for (const body of ["", "hi", "x".repeat(600), "x".repeat(8_999)]) expect(messageLengthNotice(body)).toEqual({ over: false, text: "" });
  });

  it("counts down the room left near the limit", () => {
    expect(messageLengthNotice("x".repeat(9_000))).toEqual({ over: false, text: "1,000 characters left" });
    expect(messageLengthNotice("x".repeat(9_999))).toEqual({ over: false, text: "1 character left" });
    expect(messageLengthNotice("x".repeat(10_000))).toEqual({ over: false, text: "0 characters left" });
  });

  it("says how much to cut once over, and blocks sending", () => {
    expect(messageLengthNotice("x".repeat(10_001))).toEqual({
      over: true,
      text: "1 character over the 10,000 limit. Shorten it to send.",
    });
    expect(messageLengthNotice("x".repeat(12_345)).text).toBe("2,345 characters over the 10,000 limit. Shorten it to send.");
  });

  it("adds a GIF link only when it fits", () => {
    expect(appendToDraft(" hello ", "https://giphy.com/gifs/x")).toBe("hello\nhttps://giphy.com/gifs/x");
    expect(appendToDraft("", "https://giphy.com/gifs/x")).toBe("https://giphy.com/gifs/x");
    expect(appendToDraft("x".repeat(9_990), "https://giphy.com/gifs/x")).toBeNull();
  });

  it("keeps an over-long draft across a refresh so nothing typed is lost", () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    };
    const text = "y".repeat(10_500);
    expect(saveChatDraft(store, "alice", "room:main", text, 100)).toBe(true);
    expect(readChatDraft(store, "alice", "room:main", 200)).toBe(text);
  });
});

describe("length notice", () => {
  const html = (body: string) => renderToStaticMarkup(createElement(MessageLengthNotice, { body }));
  it("renders nothing for a short draft", () => expect(html("hello")).toBe(""));
  it("is a polite status near the limit and an alert over it", () => {
    expect(html("x".repeat(9_500))).toMatch(/role="status"[^>]*>500 characters left<\/p>$/);
    const over = html("x".repeat(10_002));
    expect(over).toContain('data-over="true"');
    expect(over).toContain('role="alert"');
    expect(over).toContain("2 characters over the 10,000 limit");
  });
});

describe("Show more", () => {
  it("only messages past 600 characters may fold", () => {
    expect(mayFoldMessage("x".repeat(600))).toBe(false);
    expect(mayFoldMessage("x".repeat(601))).toBe(true);
  });

  it("renders a short message exactly as before: one plain paragraph, no toggle", () => {
    const out = renderToStaticMarkup(createElement(ChatMessageBody, { body: "short and sweet", plain: true }));
    expect(out).toMatch(/^<div class="[^"]*"><p class="[^"]*">short and sweet<\/p><\/div>$/);
    expect(out).not.toContain("Show more");
  });

  it("puts a long message in a folding paragraph that keeps the whole text", () => {
    const body = "word ".repeat(400).trim();
    const out = renderToStaticMarkup(createElement(ChatMessageBody, { body }));
    expect(out).toContain(body);
    expect(out).toMatch(/<p id="[^"]+" class="[^"]+ [^"]+">/);
  });
});
