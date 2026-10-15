"use client";
import { useCallback, useRef, type KeyboardEvent, type SyntheticEvent } from "react";

type OpenMenus = { menus: Set<HTMLDetailsElement>; outside: (event: PointerEvent) => void };
const documents = new WeakMap<Document, OpenMenus>();

function unregister(menu: HTMLDetailsElement) {
  const doc = menu.ownerDocument,
    entry = documents.get(doc);
  if (!entry) return;
  entry.menus.delete(menu);
  if (!entry.menus.size) {
    doc.removeEventListener("pointerdown", entry.outside, true);
    documents.delete(doc);
  }
}
function register(menu: HTMLDetailsElement) {
  const doc = menu.ownerDocument;
  let entry = documents.get(doc);
  if (!entry) {
    entry = {
      menus: new Set(),
      outside: (event) => {
        const path = event.composedPath();
        for (const openMenu of [...(documents.get(doc)?.menus ?? [])]) {
          if (!openMenu.isConnected || !openMenu.open) {
            unregister(openMenu);
            continue;
          }
          if (!path.includes(openMenu)) {
            openMenu.open = false;
            unregister(openMenu);
          }
        }
      },
    };
    documents.set(doc, entry);
    doc.addEventListener("pointerdown", entry.outside, true);
  }
  entry.menus.add(menu);
}

/** The nearest ancestor that clips overflow, e.g. the replies panel or a quad pane. */
function clipRect(node: HTMLElement) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (style.overflowX !== "visible" || style.overflow !== "visible") return el.getBoundingClientRect();
  }
  return new DOMRect(0, 0, innerWidth, innerHeight);
}

/** Menus open below and to the left of ••• by default; each axis flips when its side would be cut off. */
function placeMenu(menu: HTMLDetailsElement) {
  const popup = menu.querySelector<HTMLElement>(":scope > div");
  if (!popup) return;
  delete menu.dataset.align;
  delete menu.dataset.side;
  const clip = clipRect(menu),
    box = popup.getBoundingClientRect(),
    trigger = menu.getBoundingClientRect();
  // POLISH-REST: below the last message the composer (or the phone keyboard) would hide Delete,
  // so open upward when the bottom is cut off and there is more room above.
  const view = window.visualViewport,
    top = Math.max(clip.top, view ? view.offsetTop : 0),
    bottom = Math.min(clip.bottom, view ? view.offsetTop + view.height : innerHeight);
  if (box.bottom > bottom && (trigger.top - top >= box.height || trigger.top - top > bottom - trigger.bottom))
    menu.dataset.side = "up";
  if (box.left >= clip.left) return;
  const width = box.width,
    start = trigger.left;
  // Only flip when the other side has more room.
  if (clip.right - start > box.right - clip.left || start + width <= clip.right) menu.dataset.align = "start";
}

/** Native disclosures share one outside listener per document, only while open. */
export function useMessageActionMenu() {
  const current = useRef<HTMLDetailsElement | null>(null);
  const menuRef = useCallback((node: HTMLDetailsElement | null) => {
    if (current.current) unregister(current.current);
    current.current = node;
    if (node?.open) register(node);
  }, []);
  const closeMenu = useCallback(() => {
    const menu = current.current;
    if (!menu) return;
    menu.open = false;
    unregister(menu);
  }, []);
  const onToggle = useCallback((event: SyntheticEvent<HTMLDetailsElement>) => {
    const menu = event.currentTarget;
    // A queued native toggle must not register a detached or replaced row.
    if (menu === current.current && menu.isConnected && menu.open) {
      register(menu);
      placeMenu(menu);
    } else unregister(menu);
  }, []);
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDetailsElement>) => {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      current.current?.querySelector("summary")?.focus({ preventScroll: true });
    },
    [closeMenu],
  );
  return { menuRef, onToggle, onKeyDown, closeMenu };
}
