/** Scroll-follow is a property of a visible pane, never of keyboard focus. */
export function chatPaneVisible(node: HTMLElement): boolean {
  if (
    document.hidden ||
    !node.isConnected ||
    !node.clientHeight ||
    !node.clientWidth ||
    !node.getClientRects().length
  )
    return false;
  const rect = node.getBoundingClientRect();
  return (
    getComputedStyle(node).visibility !== "hidden" &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth
  );
}

/** Laid out and not hidden, though maybe off-screen (a phone's conversation at the start of its slide). */
export function chatPaneLaidOut(node: HTMLElement): boolean {
  return (
    !document.hidden &&
    node.isConnected &&
    node.clientHeight > 0 &&
    node.clientWidth > 0 &&
    getComputedStyle(node).visibility !== "hidden"
  );
}

export function chatPaneAtBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= 2;
}

/** Observe late media/layout changes and visibility returns without acquiring focus. */
export function watchChatPaneLayout(node: HTMLElement, update: () => void): () => void {
  const visibleUpdate = () => {
    if (chatPaneVisible(node)) update();
  };
  visibleUpdate();
  const resize = new ResizeObserver(visibleUpdate);
  resize.observe(node);
  for (const child of Array.from(node.children)) resize.observe(child);
  // P7: rows added later are observed as they arrive (observing reports their first size, which
  // runs the update), so callers need not rebuild this watcher for every message change.
  const rows = new MutationObserver((changes) => {
    for (const change of changes) {
      change.addedNodes.forEach((added) => {
        if (added instanceof Element && added.parentNode === node) resize.observe(added);
      });
      change.removedNodes.forEach((removed) => {
        if (removed instanceof Element) resize.unobserve(removed);
      });
    }
  });
  rows.observe(node, { childList: true });
  const intersection = new IntersectionObserver(visibleUpdate);
  intersection.observe(node);
  document.addEventListener("visibilitychange", visibleUpdate);
  return () => {
    rows.disconnect();
    resize.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", visibleUpdate);
  };
}

export type ChatScrollIntent = {
  top: number;
  height: number;
  viewport: number;
  expires: number;
  gesture?: { until: number; kind: "touch" | "pointer" };
};
export function chatPaneScrollIntent(
  node: HTMLElement,
  held: false | "touch" | "pointer" = false,
): ChatScrollIntent {
  return {
    top: node.scrollTop,
    height: node.scrollHeight,
    viewport: node.clientHeight,
    expires: Date.now() + 1000,
    ...(held ? { gesture: { until: Infinity, kind: held } } : {}),
  };
}
/** Focus and control activation are not scroll intent; native scrollbar presses are. */
export function chatScrollPointer(target: EventTarget | null, touch = false): boolean {
  return !(
    typeof Element !== "undefined" &&
    target instanceof Element &&
    target.closest(
      touch
        ? 'input,textarea,select,[contenteditable="true"]'
        : 'input,textarea,select,button,a,[role="button"],[contenteditable="true"]',
    )
  );
}
export function chatScrollKey(key: string, target: EventTarget | null): boolean {
  return (
    ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(key) &&
    !(
      typeof Element !== "undefined" &&
      target instanceof Element &&
      target.closest('input,textarea,select,[contenteditable="true"]')
    )
  );
}
/** Intent alone is not motion. Layout/anchoring changes cannot resume a paused reader. */
export function chatPaneFollowingScroll(
  node: HTMLElement,
  following: boolean,
  intent: ChatScrollIntent | null,
): { following: boolean; intent: ChatScrollIntent | null; direction: "up" | "down" | null } {
  if (
    !intent ||
    Math.max(intent.expires, intent.gesture?.until ?? 0) < Date.now() ||
    intent.height !== node.scrollHeight ||
    intent.viewport !== node.clientHeight
  )
    return { following, intent: null, direction: null };
  const next = { ...chatPaneScrollIntent(node), gesture: intent.gesture },
    delta = next.top - intent.top;
  if (delta < -0.5) return { following: false, intent: next, direction: "up" };
  if (delta > 0.5)
    return {
      following: node.scrollHeight - node.scrollTop - node.clientHeight <= 48,
      intent: next,
      direction: "down",
    };
  return { following, intent: next, direction: null };
}
