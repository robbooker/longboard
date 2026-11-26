// #505 Stage mode: "Watch live" opens the stage in a browser tab of its own, so the tab the member
// was on (their room, Dual, Quad or Six view) stays exactly as it was. One tab per room: pressing
// Watch live again brings that tab forward instead of opening another.
import type { MouseEvent } from "react";
import { stageWatchPath } from "./chatStageNotice";

/** The stage tab's window name: one per room. */
export const stageWindowName = (room: string) => `stage-${room}`;

/** What every Watch live link carries: a real link to the stage, aimed at the room's stage tab. */
export const stageWatchLink = (room: string) => ({ href: stageWatchPath(room), target: stageWindowName(room) });

const showsStage = (view: Window, room: string) => !!view.document.querySelector(`[data-stage-root="${room}"]`);

/**
 * The click on a Watch live link. Returns true when the stage tab was opened or brought forward
 * here, so the caller cancels the link itself.
 *  - A tab of this room's name that is already showing the stage is only brought forward: the
 *    video is not loaded again.
 *  - A new tab, or the stage tab after "Back to the room", is sent to the stage.
 *  - The new tab is not left with a handle on this one (its `opener` is cleared). A plain
 *    rel="noopener" would do that too, but a browser then opens a fresh tab on every click.
 *  - If the browser refuses to open a tab from script, the link itself is followed (same name).
 * Called from the click itself, so popup blockers see the member's own action.
 */
export function openStageWindow(room: string): boolean {
  // This tab is already showing that stage (the message's Watch live, read from the stage's chat).
  if (showsStage(window, room)) return true;
  let tab: Window | null = null;
  try {
    // An empty address first: an existing tab of this name is found, not reloaded.
    tab = window.open("", stageWindowName(room));
  } catch {}
  if (!tab) return false;
  let watching = false;
  try {
    watching = showsStage(tab, room);
  } catch {
    // Another site is in that tab now: put the stage back in it.
  }
  if (!watching) tab.location.replace(new URL(stageWatchPath(room), window.location.origin).toString());
  if (tab !== window) {
    try {
      tab.opener = null;
    } catch {}
    tab.focus();
  }
  return true;
}

/** onClick for a Watch live link: a plain click opens the stage tab; ctrl/shift/middle clicks are the browser's. */
export function stageWatchClick(event: MouseEvent<HTMLAnchorElement>, room: string) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (openStageWindow(room)) event.preventDefault();
}
