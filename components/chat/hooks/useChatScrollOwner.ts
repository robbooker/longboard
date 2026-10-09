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
    if (state.current.mode === "reading") return false;
    const jump = state.current.jump;
    const step = scrollLayout(state.current, (t) =>
      "messageId" in t ? !!message(node, t.messageId) : rows(node).length > 0,
    );
    state.current = step.state;
    if (step.action.type === "none") return false;
    if (step.action.type === "bottom") {
      node.scrollTop = node.scrollHeight;
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
    return true;
  }, []);
  return useMemo(
    () => ({
      dispatch,
      layout,
      /** The id of the latest requested jump, for give-up checks. */
      request: () => state.current.request,
      jumping: () => state.current.mode === "jumping",
      /** Stuck to the newest message: read receipts count and new content keeps the bottom in view. */
      following: () => scrollFollowing(state.current),
    }),
    [dispatch, layout],
  );
}
