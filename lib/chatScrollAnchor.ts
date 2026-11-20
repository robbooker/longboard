// #473: keeps the message being read in the same spot on screen while a page of messages loads
// above or below it (a DM's and a reply thread's Earlier/Newer buttons; the room's scroll owner
// does the same for the room).
//
// The browser's own scroll anchoring can't be relied on: it anchors to the first thing in view,
// which at the top of a conversation is the "Load earlier" button itself, so the rows loaded under
// it pushed the reader's message down and the reader landed at the top of the new page. iOS
// Safari has no scroll anchoring at all. So the pane notes the message in view and where it sits
// before the page goes in, and puts it back there after every
// layout change (the new rows, then pictures in them that finish loading) until the reader
// scrolls again.

export type ChatScrollAnchor = { row: HTMLElement; offset: number };

// The row's bottom edge (its message text) is what stays put: older messages from the same person
// joining above can take the name line off the top of the row being read.
const bottom = (node: HTMLElement, row: HTMLElement) =>
  row.getBoundingClientRect().bottom - node.getBoundingClientRect().top;

/** The first `selector` row still in view in `node`, and where its bottom edge sits in the pane. */
export function captureChatScrollAnchor(node: HTMLElement, selector: string): ChatScrollAnchor | null {
  const edge = node.getBoundingClientRect().top;
  for (const row of Array.from(node.querySelectorAll<HTMLElement>(selector))) {
    const box = row.getBoundingClientRect();
    if (box.height && box.bottom > edge) return { row, offset: box.bottom - edge };
  }
  return null;
}

/** Moves the pane so the anchored row is back where it was. False when the row is gone. */
export function restoreChatScrollAnchor(node: HTMLElement, anchor: ChatScrollAnchor): boolean {
  if (!anchor.row.isConnected) return false;
  const shift = bottom(node, anchor.row) - anchor.offset;
  if (Math.abs(shift) >= 0.5) node.scrollTop += shift;
  return true;
}
