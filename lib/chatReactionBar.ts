/**
 * #356: where the reaction bar lives while it is open, and what counts as a tap outside it.
 *
 * In the room's message list each row is a swipe-to-reply surface (`touch-action: pan-y` plus
 * pointer handlers) inside the list's scroll container. The bar used to be a descendant of that
 * row, so on iPad Safari (iPadOS 16) a touch on the bar belonged to the row and the scrolling list:
 * the bar closed and the reaction was never saved, while the replies column (plain rows, no
 * swipe) worked. While open, the bar is now placed in the room pane outside the list
 * (`data-reaction-bar-host`), so a touch on it is a touch on the bar alone.
 */
export const REACTION_BAR_HOST = "data-reaction-bar-host";
/** Set on the message row while its bar is open elsewhere, so the row keeps its actions shown. */
export const REACTION_BAR_OPEN = "data-reaction-open";

/**
 * #356 (third report): on iPad Safari the bar flashed open and closed at once. A tap reaches the
 * page as pointer and touch events first, then mouse events and a click up to a few hundred ms
 * later, and opening the bar moves focus into it, which Safari may answer by scrolling the chat
 * to show it. Nothing that belongs to the tap that opened the bar may close it: for a short
 * while after it opens, a press or a scroll anywhere only moves the bar, and the finger that
 * opened it never counts as a tap outside.
 */
export const OPEN_GRACE_MS = 500;
/** The opening finger's own events are recognised for at most this long after it went down. */
export const OPENING_POINTER_MS = 1500;

type PointerLike = { pointerId: number; pointerType: string };

export function openingGesture(now: () => number = () => Date.now()) {
  let openedAt = Number.NEGATIVE_INFINITY;
  let pointer: { id: number; type: string; at: number } | null = null;
  return {
    /** A pointer went down on the button that opens the bar. */
    press(event: PointerLike) {
      pointer = { id: event.pointerId, type: event.pointerType, at: now() };
    },
    /** The bar just opened. */
    opened() {
      openedAt = now();
    },
    /** The bar closed: later events are judged on their own. */
    reset() {
      openedAt = Number.NEGATIVE_INFINITY;
      pointer = null;
    },
    /**
     * True when an event may still belong to the tap that opened the bar, so it must not close it:
     * anything just after opening, or the same finger (a mouse keeps one id for every click, so
     * only touch and pen ids say which press it is).
     */
    owns(event?: PointerLike | null) {
      const t = now();
      if (t - openedAt < OPEN_GRACE_MS) return true;
      return (
        !!event &&
        !!pointer &&
        pointer.type !== "mouse" &&
        event.pointerType === pointer.type &&
        event.pointerId === pointer.id &&
        t - pointer.at < OPENING_POINTER_MS
      );
    },
  };
}

type Box = { left: number; top: number; right: number; bottom: number };
type Area = { contains: (node: Node | null) => boolean; getBoundingClientRect: () => Box };

type Bar = Pick<HTMLDialogElement, "open" | "setAttribute" | "contains" | "ownerDocument"> & {
  querySelector: (selector: string) => Pick<HTMLElement, "focus"> | null;
};

/**
 * Shows the bar without the focus jump of `dialog.show()`: show() focuses the first reaction
 * while the bar is still at its unplaced spot (the top of the room pane), and Safari may scroll
 * the chat (an overflow-hidden shell) to bring it into view. Here the bar opens, is placed, and
 * only then takes focus, without scrolling anything.
 */
export function openReactionBar(bar: Bar, place: () => void) {
  if (!bar.open) bar.setAttribute("open", "");
  place();
  const first = bar.querySelector("button:not(:disabled)");
  if (first && !bar.contains(bar.ownerDocument.activeElement)) first.focus({ preventScroll: true });
}

/**
 * True when a pointerdown is on the bar (or its button), so it must not close it. Besides the
 * event target, a point inside the bar's box counts: a browser whose hit test of a floating
 * element disagrees with where it is drawn must not turn a tap on a reaction into "outside".
 */
export function pointerOnReactionBar(
  event: { target: EventTarget | null; clientX: number; clientY: number },
  bar: Area,
  trigger?: { contains: (node: Node | null) => boolean } | null,
) {
  const target = event.target as Node | null;
  if (bar.contains(target) || trigger?.contains(target)) return true;
  const box = bar.getBoundingClientRect();
  if (box.right <= box.left || box.bottom <= box.top) return false;
  return (
    event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom
  );
}
