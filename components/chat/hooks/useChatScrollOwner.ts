"use client";
import { useCallback, useMemo, useRef } from "react";
import {
  initialScrollState,
  scrollLayout,
  scrollFollowing,
  scrollReducer,
  type ScrollEvent,
  type ScrollJump,
} from "@/lib/chatScrollOwner";

const rows = (node: HTMLElement) => node.querySelectorAll<HTMLElement>('article[id^="chat-message-"]');
const message = (node: HTMLElement, id: string) =>
  node.querySelector<HTMLElement>(`[id="chat-message-${CSS.escape(id)}"]`);

const offset = (node: HTMLElement, row: HTMLElement) =>
  row.getBoundingClientRect().top - node.getBoundingClientRect().top;

/** The first row still in view: its position is what the reader is looking at. */
function firstVisible(node: HTMLElement) {
  const all = rows(node),
    top = node.getBoundingClientRect().top;
  let low = 0,
    high = all.length - 1,
    found: HTMLElement | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (all[middle].getBoundingClientRect().bottom > top) {
      found = all[middle];
      high = middle - 1;
    } else low = middle + 1;
  }
  return found;
}

/** Moves `target` to the top of the pane, or to its middle. */
function moveTo(node: HTMLElement, target: HTMLElement, align: "top" | "center") {
  const offset = target.getBoundingClientRect().top - node.getBoundingClientRect().top;
  node.scrollTop += align === "top" ? offset : offset - (node.clientHeight - target.offsetHeight) / 2;
}

/**
 * The room's scroll owner (A1). The only thing that moves the room's list: it holds the bottom
 * while following, leaves a reader alone, and applies requested jumps (the unread opening, pins,
 * search and deep-link hits, history page restores) once their targets render. The room calls
 * `layout()` after every layout change. `onLand` lets the caller take over a landed jump (pins add
 * their highlight); `onBottom` runs after each move to the bottom.
 */
export function useChatScrollOwner(
  onLand?: (jump: ScrollJump, target: HTMLElement, node: HTMLElement) => boolean,
  onBottom?: (node: HTMLElement) => void,
) {
  const state = useRef(initialScrollState);
  // The row a reader sees and where, so rows added or dropped above it can't move them.
  const anchor = useRef<{ row: HTMLElement; offset: number } | null>(null);
  /** Records the reader's visible row; the room calls this on every scroll. */
  const remember = useCallback((node: HTMLElement) => {
    const row = firstVisible(node);
    anchor.current = row ? { row, offset: offset(node, row) } : null;
  }, []);
  const land = useRef(onLand),
    bottom = useRef(onBottom);
  land.current = onLand;
  bottom.current = onBottom;
  const dispatch = useCallback((event: ScrollEvent) => {
    state.current = scrollReducer(state.current, event);
    return state.current.request;
  }, []);
  /** Holds the bottom while following and applies a pending jump once its target renders. */
  const layout = useCallback((node: HTMLElement) => {
    if (state.current.mode === "reading") {
      // Native scroll anchoring does not hold the list when the server window drops its oldest
      // row (or rows above grow), so the reader's row would slide; put it back where it was.
      const held = anchor.current;
      if (held?.row.isConnected) {
        const shift = offset(node, held.row) - held.offset;
        if (Math.abs(shift) >= 0.5) node.scrollTop += shift;
      }
      remember(node);
      return false;
    }
    const jump = state.current.jump;
    const step = scrollLayout(state.current, (t) =>
      "messageId" in t ? !!message(node, t.messageId) : rows(node).length > 0,
    );
    state.current = step.state;
    if (step.action.type === "none") return false;
    if (step.action.type === "bottom") {
      node.scrollTop = node.scrollHeight;
      remember(node);
      bottom.current?.(node);
      return true;
    }
    if (!jump) return false;
    const all = rows(node);
    const target =
      step.action.type === "message"
        ? message(node, step.action.messageId)
        : step.action.edge === "first"
          ? all[0]
          : all[all.length - 1];
    if (!target) return false;
    if (!land.current?.(jump, target, node))
      moveTo(node, target, step.action.type === "message" ? step.action.align : "top");
    remember(node);
    return true;
  }, [remember]);
  return useMemo(
    () => ({
      dispatch,
      layout,
      remember,
      /** The id of the latest requested jump, for give-up checks. */
      request: () => state.current.request,
      jumping: () => state.current.mode === "jumping",
      /** Stuck to the newest message: read receipts count and new content keeps the bottom in view. */
      following: () => scrollFollowing(state.current),
    }),
    [dispatch, layout, remember],
  );
}
