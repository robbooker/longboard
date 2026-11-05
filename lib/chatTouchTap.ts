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
 *
 * #356 (fourth report, iPad): "the lemon is selected" — the bar flashed open and a reaction was
 * picked by itself. A tap's mouse events and click arrive after the touch, aimed at whatever is
 * under the finger by then. A click from a press that began before the bar opened (the tap on
 * the smiley, or anything else in flight) is not a choice made from the bar, so a pointer's click
 * on a reaction counts only when a pointer went down on that same reaction after the bar opened
 * (Safari's late mouse events are not pointer events, so they cannot stand in for that press).
 * A keyboard's click (detail 0: Enter, Space, a screen reader) always counts.
 */
export const TAP_SLOP_PX = 10;
/** A click this soon after a tap was handled is that tap's own click. */
export const TAP_CLICK_WINDOW_MS = 800;

type PointerLike = { pointerId: number; pointerType: string; isPrimary: boolean; clientX: number; clientY: number };

export function touchTapTracker(now: () => number = () => Date.now()) {
  let down: { id: number; key: string; x: number; y: number } | null = null;
  let handledAt = Number.NEGATIVE_INFINITY;
  /** The reaction a press began on since the bar opened, if any. */
  let pressed: string | null = null;
  const clickIsEcho = () => {
    if (now() - handledAt > TAP_CLICK_WINDOW_MS) return false;
    handledAt = Number.NEGATIVE_INFINITY;
    return true;
  };
  return {
    /** The bar just opened (or was shown again): no press has begun on it yet. */
    opened() {
      down = null;
      pressed = null;
      handledAt = Number.NEGATIVE_INFINITY;
    },
    /** A pointer went down on the button for `key`. */
    down(event: PointerLike, key: string) {
      // A tap's own click always comes before the next pointer goes down.
      handledAt = Number.NEGATIVE_INFINITY;
      pressed = key;
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
    clickIsEcho,
    /**
     * True when a click on the button for `key` is a choice to act on: not the echo of a tap
     * already handled, and either from a keyboard (detail 0) or from a press that began on this
     * same button after the bar opened.
     */
    clickActs(event: { detail: number }, key: string) {
      if (clickIsEcho()) return false;
      const ok = event.detail === 0 || pressed === key;
      pressed = null;
      return ok;
    },
  };
}
