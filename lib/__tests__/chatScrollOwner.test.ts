import { describe, expect, it } from "vitest";
import { initialScrollState, scrollFollowing, scrollLayout, scrollReducer, type ScrollState } from "../chatScrollOwner";

const rendered = (ids: string[], edges = true) => (t: { messageId: string } | { edge: "first" | "last" }) =>
  "messageId" in t ? ids.includes(t.messageId) : edges;

describe("chat scroll owner", () => {
  it("opens at the bottom and keeps following new content", () => {
    let s = scrollReducer(initialScrollState, { type: "open", anchor: null });
    expect(s.mode).toBe("following");
    const step = scrollLayout(s, rendered([]));
    expect(step.action).toEqual({ type: "bottom" });
    expect(step.state.opening).toBe(false);
    s = step.state;
    expect(scrollLayout(s, rendered([])).action).toEqual({ type: "bottom" });
    expect(scrollFollowing(s)).toBe(true);
  });

  it("opens at the unread anchor once it renders, then leaves the reader in place", () => {
    let s = scrollReducer(initialScrollState, { type: "open", anchor: "m7" });
    expect(s.mode).toBe("jumping");
    const step = scrollLayout(s, rendered(["m7"]));
    expect(step.action).toEqual({ type: "message", messageId: "m7", align: "top" });
    s = step.state;
    expect(s.mode).toBe("reading");
    expect(s.opening).toBe(false);
    // New messages arriving while reading never move the reader.
    expect(scrollLayout(s, rendered(["m7", "m8"])).action).toEqual({ type: "none" });
  });

  it("opens at the newest message when the unread anchor is no longer there", () => {
    const s = scrollReducer(initialScrollState, { type: "open", anchor: "deleted" });
    const step = scrollLayout(s, rendered(["m8"]));
    expect(step.action).toEqual({ type: "bottom" });
    expect(step.state).toMatchObject({ mode: "following", jump: null, opening: false });
  });

  it("follow and read move between following and reading; read never cancels a pending jump", () => {
    let s = scrollReducer(initialScrollState, { type: "read" });
    expect(s.mode).toBe("reading");
    s = scrollReducer(s, { type: "follow" });
    expect(s).toMatchObject({ mode: "following", jump: null });
    const page = scrollReducer(s, { type: "jump", jump: { kind: "edge-row", edge: "last", reason: "page" } });
    expect(scrollReducer(page, { type: "read" })).toBe(page);
    expect(scrollReducer(page, { type: "follow" })).toMatchObject({ mode: "following", jump: null });
  });

  it("lets the person's own scrolling cancel any pending jump, including the opening", () => {
    const opening = scrollReducer(initialScrollState, { type: "open", anchor: "m7" });
    const cancelled = scrollReducer(opening, { type: "gesture", atBottom: false });
    expect(cancelled).toMatchObject({ mode: "reading", jump: null, opening: false });
    expect(scrollLayout(cancelled, rendered(["m7"])).action).toEqual({ type: "none" });
    const pin = scrollReducer(cancelled, {
      type: "jump",
      jump: { kind: "message", messageId: "p1", align: "center", reason: "pin" },
    });
    expect(scrollReducer(pin, { type: "gesture", atBottom: true }).mode).toBe("following");
  });

  it("switches between following and reading only on real gestures", () => {
    let s: ScrollState = scrollLayout(scrollReducer(initialScrollState, { type: "open", anchor: null }), rendered([])).state;
    s = scrollReducer(s, { type: "gesture", atBottom: false });
    expect(s.mode).toBe("reading");
    s = scrollReducer(s, { type: "gesture", atBottom: true });
    expect(s.mode).toBe("following");
  });

  it("restores the reader's place after a history page and jumps to pins centered", () => {
    let s = scrollReducer({ ...initialScrollState, mode: "reading", opening: false }, {
      type: "jump",
      jump: { kind: "edge-row", edge: "last", reason: "page" },
    });
    let step = scrollLayout(s, rendered([]));
    expect(step.action).toEqual({ type: "edge-row", edge: "last" });
    s = scrollReducer(step.state, { type: "jump", jump: { kind: "message", messageId: "p1", align: "center", reason: "pin" } });
    step = scrollLayout(s, rendered(["p1"]));
    expect(step.action).toEqual({ type: "message", messageId: "p1", align: "center" });
    expect(step.state.mode).toBe("reading");
  });

  it("a Latest or send jump returns to following", () => {
    const s = scrollReducer({ ...initialScrollState, mode: "reading", opening: false }, { type: "jump", jump: { kind: "bottom", reason: "send" } });
    const step = scrollLayout(s, rendered([]));
    expect(step.action).toEqual({ type: "bottom" });
    expect(step.state.mode).toBe("following");
  });

  it("gives up on a jump whose target never renders, but only for that request", () => {
    const first = scrollReducer({ ...initialScrollState, opening: false }, { type: "jump", jump: { kind: "message", messageId: "gone", align: "center", reason: "pin" } });
    const second = scrollReducer(first, { type: "jump", jump: { kind: "message", messageId: "p2", align: "center", reason: "pin" } });
    expect(scrollReducer(second, { type: "give-up", request: first.request, atBottom: false })).toBe(second);
    expect(scrollReducer(second, { type: "give-up", request: second.request, atBottom: false })).toMatchObject({ mode: "reading", jump: null });
    expect(scrollReducer(second, { type: "give-up", request: second.request, atBottom: true }).mode).toBe("following");
  });

  it("a newer jump replaces an older one before it lands", () => {
    const a = scrollReducer(initialScrollState, { type: "jump", jump: { kind: "message", messageId: "a", align: "center", reason: "search" } });
    const b = scrollReducer(a, { type: "jump", jump: { kind: "message", messageId: "b", align: "center", reason: "pin" } });
    expect(b.request).toBe(a.request + 1);
    expect(scrollLayout(b, rendered(["a"])).action).toEqual({ type: "none" });
    expect(scrollLayout(b, rendered(["a", "b"])).action).toMatchObject({ messageId: "b" });
  });

  it("reset returns to a fresh opening state", () => {
    const s = scrollReducer({ mode: "reading", jump: null, request: 4, opening: false }, { type: "reset" });
    expect(s).toEqual({ mode: "following", jump: null, request: 5, opening: true });
  });
});
