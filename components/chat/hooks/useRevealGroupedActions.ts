"use client";
import { useEffect } from "react";

const INTERACTIVE = "a,button,summary,details,input,textarea,audio,video,dialog,label,[role='button']";

/**
 * #331: on touch screens a later message in a group has no room for its ••• and copy buttons, so
 * they stay out of the way until the message is tapped (they show over its top-right corner). One
 * tap shows them, a tap on the same message or anywhere else hides them. Keyboards and screen
 * readers reach them as usual; on computers they show on hover (CSS).
 */
function onClick(event: MouseEvent) {
  if (!window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
  const target = event.target as Element | null;
  if (!target?.closest || target.closest(INTERACTIVE)) return;
  if (window.getSelection()?.toString()) return;
  const row = target.closest<HTMLElement>("article[data-continued]");
  const wasShown = row?.hasAttribute("data-actions-shown");
  document
    .querySelectorAll("article[data-actions-shown]")
    .forEach((shown) => shown.removeAttribute("data-actions-shown"));
  if (row && !wasShown) row.setAttribute("data-actions-shown", "");
}
// Several chat lists can be mounted at once; they share one listener.
let users = 0;
export function useRevealGroupedActions() {
  useEffect(() => {
    if (users++ === 0) document.addEventListener("click", onClick);
    return () => {
      if (--users === 0) document.removeEventListener("click", onClick);
    };
  }, []);
}
