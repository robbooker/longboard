import { describe, expect, it } from "vitest";
import { TAP_CLICK_WINDOW_MS, touchTapTracker } from "../chatTouchTap";

const touch = (x = 100, y = 100, pointerId = 1) => ({ pointerId, pointerType: "touch", isPrimary: true, clientX: x, clientY: y });

function tracker() {
  let time = 1000;
  const t = touchTapTracker(() => time);
  return { t, wait: (ms: number) => (time += ms) };
}

describe("touchTapTracker (#356 reactions on iPad)", () => {
  it("acts on a finger tap without waiting for a click (iPad Safari may never send it)", () => {
    const { t } = tracker();
    t.down(touch(), "heart");
    expect(t.up(touch(103, 98), "heart")).toBe(true);
  });

  it("cancels and ignores the click that follows a handled tap, so the reaction is set once", () => {
    const { t, wait } = tracker();
    t.down(touch(), "heart");
    t.up(touch(), "heart");
    expect(t.echoPending()).toBe(true);
    wait(40);
    expect(t.clickIsEcho()).toBe(true);
    // The next click is a real one.
    expect(t.clickIsEcho()).toBe(false);
  });

  it("keeps mouse, pen and keyboard on the click", () => {
    const { t } = tracker();
    for (const pointerType of ["mouse", "pen"]) {
      t.down({ ...touch(), pointerType }, "heart");
      expect(t.up({ ...touch(), pointerType }, "heart")).toBe(false);
    }
    expect(t.echoPending()).toBe(false);
    expect(t.clickIsEcho()).toBe(false); // keyboard: a click with no pointer at all
  });

  it("is not a tap when the finger moved, changed button, was cancelled or was a second finger", () => {
    const { t } = tracker();
    t.down(touch(), "heart");
    expect(t.up(touch(100, 112), "heart")).toBe(false);
    t.down(touch(), "heart");
    expect(t.up(touch(), "laugh")).toBe(false);
    t.down(touch(), "heart");
    t.cancel();
    expect(t.up(touch(), "heart")).toBe(false);
    t.down({ ...touch(), isPrimary: false }, "heart");
    expect(t.up({ ...touch(), isPrimary: false }, "heart")).toBe(false);
    t.down(touch(100, 100, 1), "heart");
    expect(t.up(touch(100, 100, 2), "heart")).toBe(false);
    expect(t.clickIsEcho()).toBe(false);
  });

  it("does not swallow a later click once the tap's own click never came", () => {
    const { t, wait } = tracker();
    t.down(touch(), "heart");
    t.up(touch(), "heart");
    wait(TAP_CLICK_WINDOW_MS + 1);
    expect(t.echoPending()).toBe(false);
    expect(t.clickIsEcho()).toBe(false);
  });

  it("a new touch clears the last tap, so a scroll's touchend is not cancelled", () => {
    const { t } = tracker();
    t.down(touch(), "heart");
    t.up(touch(), "heart");
    t.down(touch(), "laugh");
    expect(t.echoPending()).toBe(false);
    t.cancel();
    expect(t.clickIsEcho()).toBe(false);
  });

  describe("clickActs: only a press made on the open bar picks a reaction (#356 fourth report)", () => {
    const click = { detail: 1 },
      keyboard = { detail: 0 };
    it("the late click of the tap that opened the bar does not pick the reaction it lands on", () => {
      const { t } = tracker();
      // The smiley was pressed before the bar existed; the bar opens; Safari's click for that same
      // tap then arrives over the first reaction (the lemon).
      t.opened();
      expect(t.clickActs(click, "like")).toBe(false);
    });
    it("a press that began on another reaction, or before the bar opened, does not count", () => {
      const { t } = tracker();
      t.down({ ...touch(), pointerType: "mouse" }, "like");
      t.opened();
      expect(t.clickActs(click, "like")).toBe(false);
      t.down({ ...touch(), pointerType: "mouse" }, "heart");
      expect(t.clickActs(click, "like")).toBe(false);
    });
    it("a mouse or pen press and click on the same reaction picks it, once per press", () => {
      const { t } = tracker();
      t.opened();
      for (const pointerType of ["mouse", "pen"]) {
        t.down({ ...touch(), pointerType }, "heart");
        expect(t.up({ ...touch(), pointerType }, "heart")).toBe(false);
        expect(t.clickActs(click, "heart")).toBe(true);
        expect(t.clickActs(click, "heart")).toBe(false);
      }
    });
    it("a keyboard click (Enter, Space, screen reader) always picks", () => {
      const { t } = tracker();
      t.opened();
      expect(t.clickActs(keyboard, "like")).toBe(true);
    });
    it("a finger tap acts on lifting, and its own click is not a second pick", () => {
      const { t, wait } = tracker();
      t.opened();
      t.down(touch(), "heart");
      expect(t.up(touch(), "heart")).toBe(true);
      wait(300);
      expect(t.clickActs(click, "heart")).toBe(false);
    });
    it("a second tap on a different reaction after the bar opened picks that one", () => {
      const { t } = tracker();
      t.opened();
      expect(t.clickActs(click, "like")).toBe(false);
      t.down(touch(), "heart");
      expect(t.up(touch(), "heart")).toBe(true);
    });
    it("opening the bar again forgets a press made on the earlier showing", () => {
      const { t } = tracker();
      t.opened();
      t.down({ ...touch(), pointerType: "mouse" }, "heart");
      t.opened();
      expect(t.clickActs(click, "heart")).toBe(false);
    });
  });
});
