"use client";
import { useCallback, useMemo, useRef } from "react";
import {
  initialScrollState,
  scrollLayout,
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
 * The room's scroll owner (A1). Jumps (pins, search and deep-link hits, history page restores)
 * are requested here and applied only by `layout()`, which the room calls after every layout
 * change. `onLand` lets the caller take over a landed move (pins add their highlight).
 * Following and the unread opening still use the room's own flags until A1-3.
 */
export function useChatScrollOwner(
  onLand?: (jump: ScrollJump, target: HTMLElement, node: HTMLElement) => boolean,
) {
  const state = useRef(initialScrollState);
  const land = useRef(onLand);
  land.current = onLand;
  const dispatch = useCallback((event: ScrollEvent) => {
    state.current = scrollReducer(state.current, event);
    return state.current.request;
  }, []);
  /** Applies a pending jump once its target has rendered. Returns true when it moved. */
  const layout = useCallback((node: HTMLElement) => {
    if (state.current.mode !== "jumping") return false;
    const jump = state.current.jump;
    const step = scrollLayout(state.current, (t) =>
      "messageId" in t ? !!message(node, t.messageId) : rows(node).length > 0,
    );
    state.current = step.state;
    if (!jump || step.action.type === "none") return false;
    if (step.action.type === "bottom") {
      node.scrollTop = node.scrollHeight;
      return true;
    }
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
    }),
    [dispatch, layout],
  );
}
