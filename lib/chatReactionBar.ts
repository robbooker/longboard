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
/**
 * #370: where a host's bar is actually put: the chat page itself, outside the conversation column.
 * At 1100px and wider (an iPad held sideways) that column is a size container (`container-type`),
 * which makes it the containing block of a fixed bar inside it: the bar was drawn offset (put back
 * by reactionBarShift) and Safari's hit test of it could disagree with where it was drawn. The page
 * carries the theme's colours and makes no containing block of its own.
 */
export const REACTION_BAR_LAYER = "data-reaction-bar-layer";
/** Marks each reaction button in the bar with its reaction. */
export const REACTION_OPTION = "data-reaction-option";
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
  const ownsPointer = (event?: PointerLike | null) =>
    !!event &&
    !!pointer &&
    pointer.type !== "mouse" &&
    event.pointerType === pointer.type &&
    event.pointerId === pointer.id &&
    now() - pointer.at < OPENING_POINTER_MS;
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
    /** True when an event is from the touch or pen press that opened the bar. */
    ownsPointer,
    /**
     * True when an event may still belong to the tap that opened the bar, so it must not close it:
     * anything just after opening, or the same finger (a mouse keeps one id for every click, so
     * only touch and pen ids say which press it is).
     */
    owns(event?: PointerLike | null) {
      if (now() - openedAt < OPEN_GRACE_MS) return true;
      return ownsPointer(event);
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
  return pointInBox(bar.getBoundingClientRect(), event.clientX, event.clientY);
}

/** True when a point is inside a box that has a size. */
export function pointInBox(box: Box | null | undefined, x: number, y: number) {
  if (!box || box.right <= box.left || box.bottom <= box.top) return false;
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

type Option = { getAttribute: (name: string) => string | null; getBoundingClientRect: () => Box; disabled?: boolean };

/** The reaction whose button is drawn under a point, if any (a disabled button is none). */
export function optionAtPoint(options: Iterable<Option>, x: number, y: number) {
  for (const option of options)
    if (!option.disabled && pointInBox(option.getBoundingClientRect(), x, y))
      return option.getAttribute(REACTION_OPTION);
  return null;
}

type OptionBar = Area & { querySelectorAll: (selector: string) => Iterable<Option> };
type ElementLike = { closest?: (selector: string) => unknown };

/**
 * #370: the reaction a pointer event is for: the reaction button it was aimed at, or else the one
 * drawn under the point while the point is on the bar (Safari may aim a touch on the floating bar
 * at whatever lies beneath it). Null when it is on no reaction.
 */
export function reactionUnderPointer(
  bar: OptionBar,
  event: { target: EventTarget | null; clientX: number; clientY: number },
) {
  const hit = (event.target as ElementLike | null)?.closest?.(`[${REACTION_OPTION}]`) as (Option & Node) | null;
  if (hit && bar.contains(hit)) return hit.disabled ? null : hit.getAttribute(REACTION_OPTION);
  if (!pointInBox(bar.getBoundingClientRect(), event.clientX, event.clientY)) return null;
  return optionAtPoint(bar.querySelectorAll(`[${REACTION_OPTION}]`), event.clientX, event.clientY);
}

type Size = { width: number; height: number };

/** Where the bar goes beside its button: right-aligned with it, above it, or below when no room. */
export function reactionBarSpot(from: Box, size: Size, view: Size, gap = 8) {
  const left = Math.min(Math.max(gap, from.right - size.width), view.width - size.width - gap);
  const above = from.top - size.height - gap;
  const top = above >= gap ? above : Math.min(from.bottom + gap, view.height - size.height - gap);
  return { left, top };
}

/**
 * #356 (fourth report): how far the bar is drawn from where its left/top asked for. A fixed
 * element is placed against the screen only while no ancestor makes itself the bar's containing
 * block; the chat's container query (container-type) or a transform does, and then the bar lands
 * offset by that ancestor's position (possibly over its own button, under the finger). Centres are
 * compared, so the bar's opening scale animation does not count as a shift.
 */
export function reactionBarShift(spot: { left: number; top: number }, size: Size, drawn: Box) {
  return {
    x: (drawn.left + drawn.right) / 2 - (spot.left + size.width / 2),
    y: (drawn.top + drawn.bottom) / 2 - (spot.top + size.height / 2),
  };
}
