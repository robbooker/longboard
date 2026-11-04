import { describe, expect, it } from "vitest";
import {
  OPEN_GRACE_MS,
  OPENING_POINTER_MS,
  openingGesture,
  openReactionBar,
  pointerOnReactionBar,
} from "../chatReactionBar";

const node = (name: string) => ({ name }) as unknown as Node;
const emoji = node("emoji"),
  addButton = node("add"),
  otherRow = node("row");
const bar = (box = { left: 100, top: 200, right: 300, bottom: 248 }) => ({
  contains: (n: Node | null) => n === emoji,
  getBoundingClientRect: () => box,
});
const trigger = { contains: (n: Node | null) => n === addButton };

describe("pointerOnReactionBar (#356)", () => {
  it("a press on a reaction in the bar is on the bar", () => {
    expect(pointerOnReactionBar({ target: emoji, clientX: 150, clientY: 220 }, bar(), trigger)).toBe(true);
  });
  it("a press on the bar's own button is not outside (the button toggles it)", () => {
    expect(pointerOnReactionBar({ target: addButton, clientX: 10, clientY: 10 }, bar(), trigger)).toBe(true);
  });
  it("a press drawn over the bar counts even when the browser reports another element", () => {
    // iPad Safari: the hit test of the floating bar can name the row under it.
    expect(pointerOnReactionBar({ target: otherRow, clientX: 299, clientY: 247 }, bar(), trigger)).toBe(true);
  });
  it("a press elsewhere is outside", () => {
    expect(pointerOnReactionBar({ target: otherRow, clientX: 99, clientY: 220 }, bar(), trigger)).toBe(false);
    expect(pointerOnReactionBar({ target: otherRow, clientX: 150, clientY: 260 }, bar(), null)).toBe(false);
  });
  it("a bar with no size yet claims no area", () => {
    const empty = bar({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(pointerOnReactionBar({ target: otherRow, clientX: 0, clientY: 0 }, empty, trigger)).toBe(false);
  });
});

describe("openingGesture (#356: the bar flashed open and shut on iPad)", () => {
  const clock = () => {
    let t = 10_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };
  const touch = (pointerId: number) => ({ pointerId, pointerType: "touch" });
  const mouse = { pointerId: 1, pointerType: "mouse" };

  it("nothing closes the bar until it has opened", () => {
    const c = clock(),
      g = openingGesture(c.now);
    expect(g.owns(touch(7))).toBe(false);
    expect(g.owns()).toBe(false);
  });
  it("a late event of the opening tap, or a scroll, just after opening does not close it", () => {
    const c = clock(),
      g = openingGesture(c.now);
    g.press(touch(7));
    c.advance(40);
    g.opened();
    // Safari's compatibility events and its scroll to the focused bar arrive up to ~350 ms later.
    c.advance(350);
    expect(g.owns(touch(8))).toBe(true);
    expect(g.owns()).toBe(true);
    c.advance(OPEN_GRACE_MS - 350 - 1);
    expect(g.owns(mouse)).toBe(true);
  });
  it("after the grace period a new tap or a scroll counts again", () => {
    const c = clock(),
      g = openingGesture(c.now);
    g.press(touch(7));
    g.opened();
    c.advance(OPEN_GRACE_MS);
    expect(g.owns(touch(8))).toBe(false);
    expect(g.owns()).toBe(false);
  });
  it("the finger that opened the bar never counts as a tap outside, for a while", () => {
    const c = clock(),
      g = openingGesture(c.now);
    g.press(touch(7));
    g.opened();
    c.advance(OPEN_GRACE_MS + 100);
    expect(g.owns(touch(7))).toBe(true);
    expect(g.owns({ pointerId: 7, pointerType: "pen" })).toBe(false);
    c.advance(OPENING_POINTER_MS);
    expect(g.owns(touch(7))).toBe(false);
  });
  it("a mouse uses one id for every click, so its id never says which click it was", () => {
    const c = clock(),
      g = openingGesture(c.now);
    g.press(mouse);
    g.opened();
    c.advance(OPEN_GRACE_MS);
    expect(g.owns(mouse)).toBe(false);
  });
  it("closing forgets the opening tap", () => {
    const c = clock(),
      g = openingGesture(c.now);
    g.press(touch(7));
    g.opened();
    g.reset();
    expect(g.owns(touch(7))).toBe(false);
    expect(g.owns()).toBe(false);
  });
});

describe("openReactionBar (#356)", () => {
  const fake = (active: unknown = null) => {
    const calls: string[] = [];
    const button = { focus: (options?: FocusOptions) => calls.push(`focus ${JSON.stringify(options)}`) };
    const doc = { activeElement: active };
    const dialog = {
      open: false,
      ownerDocument: doc,
      setAttribute: (name: string) => {
        calls.push(`attr ${name}`);
        dialog.open = true;
      },
      contains: (n: unknown) => n === button,
      querySelector: () => button,
    };
    return { calls, button, dialog, doc };
  };
  it("opens, places, then focuses the first reaction without scrolling", () => {
    const { calls, dialog } = fake();
    openReactionBar(dialog as never, () => calls.push("place"));
    expect(calls).toEqual(["attr open", "place", 'focus {"preventScroll":true}']);
  });
  it("leaves focus alone when it is already in the bar", () => {
    const f = fake();
    f.doc.activeElement = f.button;
    f.dialog.open = true;
    openReactionBar(f.dialog as never, () => f.calls.push("place"));
    expect(f.calls).toEqual(["place"]);
  });
});
