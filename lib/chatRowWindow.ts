/**
 * LIST-ANCHOR step 2: in a long conversation, renders only the message rows near the screen.
 * A DM keeps every page it loads, so it can reach 1,000+ rows; a room holds at most 80
 * (lib/publicChat mergeMessage), below MIN_ROWS, so a room renders whole as before.
 *
 * Every row stays in the DOM (find-in-page, hash links, pin and search jumps, screen readers and
 * the scroll owner's row lookups keep working), but rows outside a window of a few screens around
 * the view are marked `data-far` and CSS gives them `content-visibility: auto`, so the browser
 * skips their style, layout and paint. A far row keeps its measured height as its placeholder
 * size, so marking it moves nothing; if it changed while far (an edit, a reaction), the real size
 * arrives when it comes near and scroll anchoring (the room's scroll owner, the browser's in a DM)
 * holds the reader through it, as for any row above. Jumps call `resetChatRowWindow` first so they land on exact positions.
 *
 * The window moves only after the view has scrolled a whole screen, and then only the rows that
 * crossed its edges change, so a long scroll restyles a handful of rows once per screen instead
 * of on every frame. Rows near the screen are never contained, so menus, pickers and highlights
 * that overflow a row are not clipped. Browsers without `content-visibility` render every row.
 */
export const CHAT_ROW_FAR = "data-far";
const RESET = "chat-row-window-reset";

/**
 * Renders every row for real right now, so a jump (the unread opening, a pin, search or deep
 * link, a history page edge) measures exact positions: a far row whose content changed while it
 * was far (hydration, fonts, edits) still has its old size. The window marks rows again after.
 */
export function resetChatRowWindow(node: HTMLElement) {
  node.dispatchEvent(new Event(RESET));
}

/**
 * Lists shorter than MIN_ROWS render whole. MARGIN screens of rows stay rendered above and below
 * the view, and the window moves after STEP screens of scrolling.
 */
const MIN_ROWS = 150,
  MARGIN = 3,
  STEP = 1,
  SETTLE_MS = 1500,
  RESETTLE_MS = 1000;

export function watchChatRowWindow(node: HTMLElement, selector = "article"): () => void {
  if (typeof CSS === "undefined" || !CSS.supports?.("content-visibility", "auto")) return () => undefined;
  let rows: HTMLElement[] = [],
    near: [number, number] = [0, -1],
    at = Number.NaN,
    // Read by the resize observer, which first runs once layout is done: reading clientWidth here
    // forced a style and layout pass while the room was still mounting.
    width = Number.NaN,
    frame = 0,
    forced = false;
  const collect = () => {
    rows = Array.prototype.filter.call(node.children, (child: Element) =>
      child.matches(selector),
    ) as HTMLElement[];
  };
  // The first row that ends below `y` (or rows.length), by binary search: rows are in order.
  const firstBelow = (y: number) => {
    let low = 0,
      high = rows.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (rows[middle].getBoundingClientRect().bottom > y) high = middle;
      else low = middle + 1;
    }
    return low;
  };
  const update = () => {
    const force = forced;
    frame = 0;
    const height = node.clientHeight;
    // A hidden pane (or one kept mounted under the phone's list) shows rows as nobody sees them:
    // measure nothing until it shows again.
    if (!height || !node.getClientRects().length || getComputedStyle(node).visibility === "hidden") return;
    // A short list costs little to render whole, so it stays whole: a room holds at most 80 rows.
    if (rows.length < MIN_ROWS) {
      if (near[1] >= 0 || force) release();
      forced = false;
      return;
    }
    const top = node.scrollTop;
    if (!force && Math.abs(top - at) < height * STEP) return;
    forced = false;
    at = top;
    const view = node.getBoundingClientRect();
    const next: [number, number] = [
      firstBelow(view.top - height * MARGIN),
      Math.min(firstBelow(view.bottom + height * MARGIN), rows.length - 1),
    ];
    // Only rows inside the old or the new window can change, unless every row is rechecked.
    const start = force ? 0 : Math.min(near[0], next[0]),
      end = force ? rows.length - 1 : Math.max(near[1], next[1]);
    // Read every size first, then write, so a batch of rows costs one layout.
    const far: [HTMLElement, number, number][] = [],
      shown: HTMLElement[] = [];
    for (let index = start; index <= end; index++) {
      const row = rows[index],
        inside = index >= next[0] && index <= next[1],
        marked = row.hasAttribute(CHAT_ROW_FAR);
      if (inside && marked) shown.push(row);
      else if (!inside && !marked) {
        const box = row.getBoundingClientRect();
        if (!box.height || !box.width) continue;
        // The placeholder sizes the content box; padding and borders still apply around it.
        const style = getComputedStyle(row),
          px = (value: string) => parseFloat(value) || 0;
        far.push([
          row,
          box.width -
            px(style.paddingLeft) -
            px(style.paddingRight) -
            px(style.borderLeftWidth) -
            px(style.borderRightWidth),
          box.height -
            px(style.paddingTop) -
            px(style.paddingBottom) -
            px(style.borderTopWidth) -
            px(style.borderBottomWidth),
        ]);
      }
    }
    near = next;
    for (const row of shown) row.removeAttribute(CHAT_ROW_FAR);
    for (const [row, w, h] of far) {
      row.style.setProperty("contain-intrinsic-size", `${Math.max(0, w)}px ${Math.max(0, h)}px`);
      row.setAttribute(CHAT_ROW_FAR, "");
    }
  };
  // Rows settle first (hydration, fonts, the first reactions and images), so their measured
  // sizes are the ones they keep; until then every row renders as it would without the window.
  // After a reset they settle again: shown reactions, for one, fill in a render later.
  let readyAt = performance.now() + SETTLE_MS,
    fontsReady = !document.fonts,
    timer: ReturnType<typeof setTimeout> | undefined,
    stopped = false;
  const settle = (ms: number) => {
    readyAt = Math.max(readyAt, performance.now() + ms);
  };
  const schedule = (force: boolean) => {
    forced ||= force;
    if (stopped || frame || timer || !fontsReady) return;
    const wait = readyAt - performance.now();
    if (wait > 0)
      timer = setTimeout(() => {
        timer = undefined;
        schedule(false);
      }, wait);
    else frame = requestAnimationFrame(update);
  };
  // Asked a frame later: reading `document.fonts.ready` forces a style pass, which while the
  // list is mounting lands in the tap that opened it.
  const fontsFrame = requestAnimationFrame(
    () =>
      void document.fonts?.ready.then(() => {
        fontsReady = true;
        schedule(false);
      }),
  );
  const release = () => {
    for (const row of Array.from(node.querySelectorAll<HTMLElement>(`:scope > [${CHAT_ROW_FAR}]`)))
      row.removeAttribute(CHAT_ROW_FAR);
    near = [0, -1];
  };
  const scrolled = () => schedule(false);
  const reset = () => {
    release();
    settle(RESETTLE_MS);
    schedule(true);
  };
  // Rows added or removed shift every index: take the list again and recheck every row.
  const children = new MutationObserver(() => {
    collect();
    schedule(true);
  });
  // A new width (rotation, a resized pane) rewraps every row: let them all lay out for real at
  // once, as without the window, then measure again. A new height only moves the window.
  const resize = new ResizeObserver(() => {
    if (node.clientWidth !== width) {
      width = node.clientWidth;
      release();
      settle(RESETTLE_MS);
    }
    schedule(true);
  });
  collect();
  children.observe(node, { childList: true });
  resize.observe(node);
  node.addEventListener("scroll", scrolled, { passive: true });
  node.addEventListener(RESET, reset);
  schedule(true);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(fontsFrame);
    clearTimeout(timer);
    children.disconnect();
    resize.disconnect();
    node.removeEventListener("scroll", scrolled);
    node.removeEventListener(RESET, reset);
    release();
  };
}
