import { describe, expect, it } from "vitest";
import {
  OPEN_GRACE_MS,
  OPENING_POINTER_MS,
  openingGesture,
  openReactionBar,
  optionAtPoint,
  pointerOnReactionBar,
  pointInBox,
  REACTION_OPTION,
  reactionUnderPointer,
  reactionBarShift,
  reactionBarSpot,
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

describe("reactionBarSpot and reactionBarShift (#356 fourth report)", () => {
  const view = { width: 1024, height: 1366 },
    size = { width: 192, height: 54 };
  const button = (left: number, top: number) => ({ left, top, right: left + 44, bottom: top + 44 });
  it("puts the bar above its button, right-aligned, never over the button", () => {
    const from = button(812, 635);
    const spot = reactionBarSpot(from, size, view);
    expect(spot).toEqual({ left: 856 - 192, top: 635 - 54 - 8 });
    expect(spot.top + size.height).toBeLessThanOrEqual(from.top);
  });
  it("goes below the button when there is no room above, and stays on screen", () => {
    const spot = reactionBarSpot(button(1000, 20), size, view);
    expect(spot.top).toBe(20 + 44 + 8);
    expect(spot.left).toBe(1024 - 192 - 8);
  });
  it("no shift when the bar is drawn where it was put, even mid pop-in scale", () => {
    const spot = { left: 664, top: 573 },
      s = 0.92;
    const drawn = {
      left: 664 + (192 * (1 - s)) / 2,
      right: 664 + 192 - (192 * (1 - s)) / 2,
      top: 573 + (54 * (1 - s)) / 2,
      bottom: 573 + 54 - (54 * (1 - s)) / 2,
    };
    const shift = reactionBarShift(spot, size, drawn);
    expect(Math.abs(shift.x)).toBeLessThan(1e-9);
    expect(Math.abs(shift.y)).toBeLessThan(1e-9);
  });
  it("measures the offset an ancestor containing block adds, so it can be taken back out", () => {
    const spot = { left: 664, top: 573 };
    const drawn = { left: 664 + 240, top: 573 + 64, right: 664 + 240 + 192, bottom: 573 + 64 + 54 };
    expect(reactionBarShift(spot, size, drawn)).toEqual({ x: 240, y: 64 });
  });
});

describe("reactionUnderPointer: a tap on the bar picks the reaction under the finger (#370)", () => {
  type Box = { left: number; top: number; right: number; bottom: number };
  type FakeOption = {
    disabled?: boolean;
    box: Box;
    closest?: (selector: string) => unknown;
    getAttribute: (name: string) => string | null;
    getBoundingClientRect: () => Box;
  };
  // A bar at x 100..288, y 200..248 with four 44px buttons (2px apart) starting at x 104.
  const make = (disabled = false) => {
    const options: FakeOption[] = ["like", "heart", "laugh", "rob"].map((emoji, i) => {
      const left = 104 + i * 46;
      const option: FakeOption = {
        disabled,
        box: { left, top: 202, right: left + 44, bottom: 246 },
        getAttribute: (name) => (name === REACTION_OPTION ? emoji : null),
        getBoundingClientRect: () => option.box,
      };
      option.closest = (selector) => (selector === `[${REACTION_OPTION}]` ? option : null);
      return option;
    });
    const box = { left: 100, top: 200, right: 288, bottom: 248 };
    const bar = {
      contains: (n: Node | null) => options.includes(n as unknown as FakeOption),
      getBoundingClientRect: () => box,
      querySelectorAll: (selector: string) => (selector === `[${REACTION_OPTION}]` ? options : []),
    };
    // The heart's icon inside its button.
    const icon = { closest: (selector: string) => (selector === `[${REACTION_OPTION}]` ? options[1] : null) };
    return { bar, options, icon };
  };
  const as = (x: unknown) => x as EventTarget;
  const beneath = as({ closest: () => null }); // the message row under the bar

  it("a press aimed at a reaction button (or its icon) is for that reaction", () => {
    const { bar, options, icon } = make();
    expect(reactionUnderPointer(bar, { target: as(options[2]), clientX: 0, clientY: 0 })).toBe("laugh");
    expect(reactionUnderPointer(bar, { target: as(icon), clientX: 172, clientY: 224 })).toBe("heart");
  });
  it("a press aimed at the row beneath but drawn over a reaction is for that reaction", () => {
    const { bar } = make();
    expect(reactionUnderPointer(bar, { target: beneath, clientX: 126, clientY: 224 })).toBe("like");
    expect(reactionUnderPointer(bar, { target: beneath, clientX: 172, clientY: 210 })).toBe("heart");
    expect(reactionUnderPointer(bar, { target: beneath, clientX: 264, clientY: 240 })).toBe("rob");
  });
  it("a press on the bar between reactions, or off the bar, is for none", () => {
    const { bar } = make();
    expect(reactionUnderPointer(bar, { target: beneath, clientX: 101, clientY: 224 })).toBeNull();
    expect(reactionUnderPointer(bar, { target: beneath, clientX: 150, clientY: 201 })).toBeNull();
    expect(reactionUnderPointer(bar, { target: beneath, clientX: 400, clientY: 224 })).toBeNull();
    expect(reactionUnderPointer(bar, { target: null, clientX: 126, clientY: 300 })).toBeNull();
  });
  it("a disabled reaction (a save in flight) is none", () => {
    const { bar, options } = make(true);
    expect(reactionUnderPointer(bar, { target: beneath, clientX: 126, clientY: 224 })).toBeNull();
    expect(reactionUnderPointer(bar, { target: as(options[0]), clientX: 126, clientY: 224 })).toBeNull();
  });
  it("optionAtPoint and pointInBox", () => {
    const { options } = make();
    expect(optionAtPoint(options, 150, 246)).toBe("heart"); // edges count
    expect(optionAtPoint(options, 149, 224)).toBeNull(); // the 2px gap
    expect(optionAtPoint([], 150, 224)).toBeNull();
    expect(pointInBox(null, 0, 0)).toBe(false);
    expect(pointInBox({ left: 10, top: 10, right: 10, bottom: 20 }, 10, 15)).toBe(false); // no width
    expect(pointInBox({ left: 10, top: 10, right: 20, bottom: 20 }, 15, 15)).toBe(true);
  });
});

describe("openingGesture.ownsPointer (#370)", () => {
  it("names only the touch or pen press that opened the bar, and only for a while", () => {
    let time = 1000;
    const g = openingGesture(() => time);
    g.press({ pointerId: 7, pointerType: "touch" });
    g.opened();
    expect(g.ownsPointer({ pointerId: 7, pointerType: "touch" })).toBe(true);
    expect(g.ownsPointer({ pointerId: 8, pointerType: "touch" })).toBe(false);
    time += OPENING_POINTER_MS;
    expect(g.ownsPointer({ pointerId: 7, pointerType: "touch" })).toBe(false);
    g.press({ pointerId: 1, pointerType: "mouse" });
    expect(g.ownsPointer({ pointerId: 1, pointerType: "mouse" })).toBe(false);
  });
});
