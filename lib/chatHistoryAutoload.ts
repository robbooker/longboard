/**
 * Which history page to load as the reader scrolls (U4). Only a real scroll
 * gesture counts (`direction` comes from chatPaneFollowingScroll, which ignores
 * layout and programmatic moves), so opening a short room or jumping to a pin
 * never chains page loads. Loads start within one screen of the edge.
 */
export function historyAutoload(
  node: Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">,
  direction: "up" | "down" | null,
  page: { hasMore: boolean; hasNewer: boolean; busy: boolean },
): "before" | "after" | null {
  if (page.busy || !direction) return null;
  if (direction === "up" && page.hasMore && node.scrollTop <= node.clientHeight) return "before";
  if (
    direction === "down" &&
    page.hasNewer &&
    node.scrollHeight - node.scrollTop - node.clientHeight <= node.clientHeight
  )
    return "after";
  return null;
}
