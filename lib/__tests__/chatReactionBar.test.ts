import { describe, expect, it } from "vitest";
import { pointerOnReactionBar } from "../chatReactionBar";

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
