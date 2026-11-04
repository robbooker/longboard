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

type Box = { left: number; top: number; right: number; bottom: number };
type Area = { contains: (node: Node | null) => boolean; getBoundingClientRect: () => Box };

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
