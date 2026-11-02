"use client";
import { memo, useCallback, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  CHAT_COLUMN_LIMITS,
  CHAT_COLUMN_STORAGE_KEY,
  chatColumnDefault,
  chatColumnMax,
  chatColumnVariable,
  parseChatColumnWidths,
  type ChatColumnSide,
  type ChatColumnWidths,
} from "@/lib/chatColumnWidths";
import handleStyles from "./ChatColumnHandle.module.css";
import chatStyles from "./PublicChat.module.css";

const KEY_STEP = 16;
const KEY_STEP_LARGE = 64;
const other = (side: ChatColumnSide): ChatColumnSide => (side === "left" ? "right" : "left");

function readSaved(): ChatColumnWidths {
  try {
    return parseChatColumnWidths(localStorage.getItem(CHAT_COLUMN_STORAGE_KEY));
  } catch {
    return {};
  }
}

function setWidth(side: ChatColumnSide, width: number) {
  document.documentElement.style.setProperty(chatColumnVariable(side), `${width}px`);
}

/** The columns as drawn: [rooms, chat, replies?]. Null when the shell isn't in its column layout. */
function drawnColumns(shell: HTMLElement) {
  const tracks = getComputedStyle(shell).gridTemplateColumns.split(" ").map(parseFloat);
  return tracks.length >= 2 && tracks.every(Number.isFinite) ? tracks : null;
}

/** Keeps both dividers' announced values true. They live outside React so a drag renders nothing. */
function announce(shell: HTMLElement) {
  const tracks = drawnColumns(shell);
  if (!tracks) return;
  const total = tracks.reduce((sum, width) => sum + width, 0);
  shell.querySelectorAll<HTMLElement>("[data-chat-column-handle]").forEach((handle) => {
    const side = handle.dataset.chatColumnHandle as ChatColumnSide;
    const width = side === "left" ? tracks[0] : tracks[2];
    if (width === undefined) return;
    const beside = side === "left" ? (tracks[2] ?? 0) : tracks[0];
    handle.setAttribute("aria-valuenow", String(Math.round(width)));
    handle.setAttribute("aria-valuemin", String(CHAT_COLUMN_LIMITS[side].min));
    handle.setAttribute("aria-valuemax", String(Math.round(chatColumnMax(side, total, beside))));
  });
}

type Move = {
  width: number;
  max: number;
  /** The other column, when the window has squeezed it under its chosen width. See begin(). */
  held: number | null;
  /** Lists showing their newest message, which must still do so once text has re-wrapped. */
  atBottom: HTMLElement[];
  shell: HTMLElement;
};

/**
 * Starts a change of one column. If the window has squeezed the other column, that column is held
 * at the width it has now: otherwise the grid would share the space between the two and the dragged
 * edge wouldn't follow the pointer.
 */
function begin(shell: HTMLElement, side: ChatColumnSide, replyOpen: boolean): Move | null {
  const tracks = drawnColumns(shell);
  if (!tracks) return null;
  const width = side === "left" ? tracks[0] : tracks[2];
  if (width === undefined) return null;
  const beside = side === "left" ? tracks[2] : tracks[0];
  const chosen = readSaved()[other(side)] ?? chatColumnDefault(other(side), replyOpen);
  const scrollers = shell.querySelectorAll<HTMLElement>(
    `.${chatStyles.messages}, .${chatStyles.replyContents}`,
  );
  return {
    shell,
    width,
    max: chatColumnMax(
      side,
      tracks.reduce((sum, track) => sum + track, 0),
      beside ?? 0,
    ),
    held: beside !== undefined && Math.abs(beside - chosen) > 0.5 ? beside : null,
    atBottom: [...scrollers].filter(
      (node) => node.clientHeight > 0 && node.scrollHeight - node.scrollTop - node.clientHeight < 4,
    ),
  };
}

function apply(move: Move, side: ChatColumnSide, width: number) {
  if (move.held !== null) setWidth(other(side), move.held);
  setWidth(side, width);
  holdAtBottom(move.atBottom);
  announce(move.shell);
}

let holdFrame = 0;
/** Rows off screen only learn their new height as the browser reaches them, so keep at it briefly. */
function holdAtBottom(nodes: HTMLElement[], frames = 12) {
  cancelAnimationFrame(holdFrame);
  for (const node of nodes) node.scrollTop = node.scrollHeight;
  if (nodes.length && frames > 0) holdFrame = requestAnimationFrame(() => holdAtBottom(nodes, frames - 1));
}

function save(move: Move, side: ChatColumnSide, width: number) {
  const saved = readSaved();
  saved[side] = width;
  if (move.held !== null) saved[other(side)] = Math.round(move.held);
  try {
    localStorage.setItem(CHAT_COLUMN_STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Storage blocked or full: the width still holds for this visit.
  }
}

/**
 * The divider on the left edge of the chat column (side "left") or of the replies column (side
 * "right"). It sets CSS variables and never touches React state, so moving it doesn't render the
 * chat. It takes no focus from a mouse or finger, so the composer keeps its caret during a drag.
 */
function ChatColumnHandle({ side, replyOpen }: { side: ChatColumnSide; replyOpen: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    move: Move;
    startX: number;
    width: number | null;
    frame: number;
    pointerX: number;
  } | null>(null);

  useLayoutEffect(() => {
    // Reaching the chat from another page draws it here without the page's early script.
    const saved = readSaved();
    if (saved[side] !== undefined) setWidth(side, saved[side]);
    const shell = ref.current?.parentElement;
    if (!shell) return;
    announce(shell);
    const observer = new ResizeObserver(() => announce(shell));
    observer.observe(shell);
    return () => observer.disconnect();
  }, [side, replyOpen]);

  const draw = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    current.frame = 0;
    const moved = current.pointerX - current.startX;
    const wanted = current.move.width + (side === "left" ? moved : -moved);
    const width = Math.round(Math.min(current.move.max, Math.max(CHAT_COLUMN_LIMITS[side].min, wanted)));
    if (width === current.width) return;
    current.width = width;
    apply(current.move, side, width);
  }, [side]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const handle = event.currentTarget;
    const move = handle.parentElement && begin(handle.parentElement, side, replyOpen);
    if (!move) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute("data-dragging", "");
    drag.current = { move, startX: event.clientX, width: null, frame: 0, pointerX: event.clientX };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    current.pointerX = event.clientX;
    if (!current.frame) current.frame = requestAnimationFrame(draw);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    if (event.type === "pointerup") current.pointerX = event.clientX;
    if (current.frame) cancelAnimationFrame(current.frame);
    draw();
    drag.current = null;
    event.currentTarget.removeAttribute("data-dragging");
    if (current.width !== null) save(current.move, side, current.width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const shell = event.currentTarget.parentElement;
    const move = shell && begin(shell, side, replyOpen);
    if (!move) return;
    const { min } = CHAT_COLUMN_LIMITS[side];
    let wanted: number;
    if (event.key === "ArrowLeft") wanted = move.width + (side === "left" ? -step : step);
    else if (event.key === "ArrowRight") wanted = move.width + (side === "left" ? step : -step);
    else if (event.key === "Home") wanted = min;
    else if (event.key === "End") wanted = move.max;
    else return;
    event.preventDefault();
    const width = Math.round(Math.min(move.max, Math.max(min, wanted)));
    apply(move, side, width);
    save(move, side, width);
  };

  return (
    <div
      ref={ref}
      className={handleStyles.handle}
      data-chat-column-handle={side}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "left" ? "Resize the rooms column" : "Resize the replies column"}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
    />
  );
}

export default memo(ChatColumnHandle);
