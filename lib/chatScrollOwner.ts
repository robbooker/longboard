/**
 * The one owner of a chat pane's scroll position (A1). Pure: no DOM, no timers, so every
 * transition is unit-tested. A hook feeds it events and applies the action it returns;
 * nothing else moves the scroll position or keeps scroll flags.
 *
 * Modes:
 * - following: stuck to the newest message. New content keeps the bottom in view.
 * - reading:   the person scrolled away from the bottom. Nothing moves them.
 * - jumping:   a requested move (unread opening, pin, search hit, page restore) is waiting
 *              for its target to render. A real scroll gesture cancels it.
 */
export type ScrollJump =
  | { kind: "message"; messageId: string; align: "top" | "center"; reason: "opening" | "pin" | "search" }
  | { kind: "edge-row"; edge: "first" | "last"; reason: "page" }
  | { kind: "bottom"; reason: "latest" | "send" };

export type ScrollMode = "following" | "reading" | "jumping";

export type ScrollState = {
  mode: ScrollMode;
  /** The pending jump while mode is "jumping". */
  jump: ScrollJump | null;
  /** Increments on every requested jump, so a late layout can't apply a replaced one. */
  request: number;
  /** True until the first move after opening (to the anchor or the bottom) has landed. */
  opening: boolean;
};

export type ScrollEvent =
  | { type: "open"; anchor: string | null }
  | { type: "jump"; jump: ScrollJump }
  | { type: "gesture"; atBottom: boolean }
  /** The reader returned to the newest message (scrolled down to it, sent, or pressed Latest). */
  | { type: "follow" }
  /** The reader left the bottom. A pending jump keeps waiting; its landing already means reading. */
  | { type: "read" }
  /** A jump target never rendered (deleted, or outside the loaded window): stop waiting. */
  | { type: "give-up"; request: number; atBottom: boolean }
  | { type: "reset" };

/** The one DOM move the hook should make. */
export type ScrollAction =
  | { type: "none" }
  | { type: "bottom" }
  | { type: "message"; messageId: string; align: "top" | "center" }
  | { type: "edge-row"; edge: "first" | "last" };

export const initialScrollState: ScrollState = { mode: "following", jump: null, request: 0, opening: true };

export function scrollReducer(state: ScrollState, event: ScrollEvent): ScrollState {
  switch (event.type) {
    case "open":
      // A room opens at its unread anchor when there is one, otherwise at the bottom.
      return event.anchor
        ? {
            mode: "jumping",
            jump: { kind: "message", messageId: event.anchor, align: "top", reason: "opening" },
            request: state.request + 1,
            opening: true,
          }
        : { mode: "following", jump: null, request: state.request + 1, opening: true };
    case "jump":
      return { ...state, mode: "jumping", jump: event.jump, request: state.request + 1 };
    case "gesture":
      // The person's own scrolling always wins: it cancels a pending jump, including the opening one.
      return {
        ...state,
        mode: event.atBottom ? "following" : "reading",
        jump: null,
        opening: false,
      };
    case "follow":
      return { ...state, mode: "following", jump: null, opening: false };
    case "read":
      return state.mode === "jumping" ? state : { ...state, mode: "reading" };
    case "give-up":
      // Only the jump it was raised for; a newer request keeps waiting.
      if (state.mode !== "jumping" || event.request !== state.request) return state;
      return { ...state, mode: event.atBottom ? "following" : "reading", jump: null, opening: false };
    case "reset":
      return { ...initialScrollState, request: state.request + 1 };
  }
}

/**
 * Called after every layout change (new rows, resize, images loading). `has` reports whether a
 * jump target is rendered yet. Returns the next state and the one DOM action to apply.
 */
export function scrollLayout(
  state: ScrollState,
  has: (target: { messageId: string } | { edge: "first" | "last" }) => boolean,
): { state: ScrollState; action: ScrollAction } {
  if (state.mode === "following")
    return { state: state.opening ? { ...state, opening: false } : state, action: { type: "bottom" } };
  if (state.mode === "reading" || !state.jump) return { state, action: { type: "none" } };
  const jump = state.jump;
  if (jump.kind === "bottom")
    return { state: { ...state, mode: "following", jump: null, opening: false }, action: { type: "bottom" } };
  const target = jump.kind === "message" ? { messageId: jump.messageId } : { edge: jump.edge };
  // The unread anchor arrives with its page, so a missing one is gone: open at the newest message.
  if (!has(target) && jump.kind === "message" && jump.reason === "opening")
    return { state: { ...state, mode: "following", jump: null, opening: false }, action: { type: "bottom" } };
  // Wait for the target to render; the next layout change tries again.
  if (!has(target)) return { state, action: { type: "none" } };
  return {
    state: { ...state, mode: "reading", jump: null, opening: false },
    action:
      jump.kind === "message"
        ? { type: "message", messageId: jump.messageId, align: jump.align }
        : { type: "edge-row", edge: jump.edge },
  };
}

/** Whether the room should treat the reader as live at the bottom (read receipts, "new messages" pill). */
export const scrollFollowing = (state: ScrollState) => state.mode === "following";
