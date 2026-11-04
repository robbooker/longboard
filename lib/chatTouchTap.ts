/**
 * #356: a finger tap on a reaction in the reaction bar is taken from the pointer events themselves,
 * not from the click the browser makes afterwards.
 *
 * iPad Safari (seen on iPadOS 16) can withhold that click: it decides on touchstart which element
 * the tap is for and drops the click if anything under the finger moved or changed before the
 * finger lifted (or if the tap looked like it was meant to reveal hover content). In the room list
 * a touch reaches the row's swipe-to-reply handlers and the list's scroll handlers, which the
 * replies column does not have, so there the click never came and the reaction was never saved.
 *
 * Pointer events reach the button whatever the click does. A touch that goes down and up on the
 * same button without moving is a tap; the click that may follow it is then cancelled (touchend)
 * or ignored, so the reaction is set once. Mouse, pen and keyboard keep using the click as before.
 */
export const TAP_SLOP_PX = 10;
/** A click this soon after a tap was handled is that tap's own click. */
export const TAP_CLICK_WINDOW_MS = 800;

type PointerLike = { pointerId: number; pointerType: string; isPrimary: boolean; clientX: number; clientY: number };

export function touchTapTracker(now: () => number = () => Date.now()) {
  let down: { id: number; key: string; x: number; y: number } | null = null;
  let handledAt = Number.NEGATIVE_INFINITY;
  return {
    /** A pointer went down on the button for `key`. */
    down(event: PointerLike, key: string) {
      // A tap's own click always comes before the next pointer goes down.
      handledAt = Number.NEGATIVE_INFINITY;
      down =
        event.pointerType === "touch" && event.isPrimary
          ? { id: event.pointerId, key, x: event.clientX, y: event.clientY }
          : null;
    },
    /** The pointer lifted on the button for `key`: true when that was a tap to act on now. */
    up(event: PointerLike, key: string) {
      const start = down;
      down = null;
      if (!start || start.id !== event.pointerId || start.key !== key) return false;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return false;
      handledAt = now();
      return true;
    },
    /** The touch became a scroll, left the button or was cancelled. */
    cancel() {
      down = null;
    },
    /** A tap was just handled and its click (if the browser sends one) has not come yet. */
    echoPending() {
      return now() - handledAt <= TAP_CLICK_WINDOW_MS;
    },
    /** True when a click is the echo of a tap already handled, so it must not act again. */
    clickIsEcho() {
      if (now() - handledAt > TAP_CLICK_WINDOW_MS) return false;
      handledAt = Number.NEGATIVE_INFINITY;
      return true;
    },
  };
}
