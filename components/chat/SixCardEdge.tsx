"use client";
// #470/#474: the draggable edge between two cards in one of Six view's rows (computers only; the CSS
// hides it below 1100px). Each row has its own two edges, so resizing a card never moves the card
// above or below it. An edge sits in its own 8px track of its row's grid, so it follows the cards
// with no measuring. A drag changes a CSS variable on the row and nothing else, so the cards don't
// render while it moves; the page hears about the row's new widths once, when the drag ends (or after
// each arrow key press). Double-click (or Enter) puts a card beside the edge back to its normal width.
import { memo, useCallback, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  SIX_COLUMNS,
  SIX_KEY_STEP_LARGE_PX,
  SIX_KEY_STEP_PX,
  moveSixEdge,
  resetSixCard,
  sixCardToReset,
  sixEdgeRange,
  sixRowFromPixels,
  sixRowTemplate,
  type SixRowWidths,
} from "@/lib/chatSixWidths";
import chatStyles from "./PublicChat.module.css";
import styles from "./SixChat.module.css";

/** The row's cards as drawn, in pixels. Null when the row isn't three cards across (narrower windows, phones). */
function drawnCards(row: HTMLElement) {
  const tracks = getComputedStyle(row).gridTemplateColumns.split(" ").map(parseFloat);
  if (tracks.length !== SIX_COLUMNS * 2 - 1 || !tracks.every(Number.isFinite)) return null;
  return tracks.filter((_, i) => i % 2 === 0);
}

/** Keeps every edge's announced values true. They live outside React so a drag renders nothing. */
function announce(row: HTMLElement) {
  const cards = drawnCards(row);
  if (!cards) return;
  const total = cards.reduce((sum, v) => sum + v, 0);
  const first = Number(row.dataset.sixRow ?? 1) * SIX_COLUMNS - SIX_COLUMNS + 1;
  row.querySelectorAll<HTMLElement>("[data-six-handle]").forEach((handle) => {
    const edge = Number(handle.dataset.sixHandle) - 1;
    const range = sixEdgeRange(cards, edge);
    const pct = (i: number) => Math.round(((cards[i] ?? 0) / total) * 100);
    handle.setAttribute("aria-valuenow", String(range.now));
    handle.setAttribute("aria-valuemin", String(range.min));
    handle.setAttribute("aria-valuemax", String(range.max));
    handle.setAttribute(
      "aria-valuetext",
      `Card ${first + edge} ${pct(edge)}%, card ${first + edge + 1} ${pct(edge + 1)}%`,
    );
  });
}

let holdFrame = 0;
/** Chat lists showing their newest message keep doing so while text re-wraps (as the single chat's columns do). */
function holdAtBottom(nodes: HTMLElement[], frames = 12) {
  cancelAnimationFrame(holdFrame);
  for (const node of nodes) node.scrollTop = node.scrollHeight;
  if (nodes.length && frames > 0) holdFrame = requestAnimationFrame(() => holdAtBottom(nodes, frames - 1));
}
const atBottom = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>(`.${chatStyles.messages}, .${chatStyles.replyContents}`)].filter(
    (node) => node.clientHeight > 0 && node.scrollHeight - node.scrollTop - node.clientHeight < 4,
  );

/** Draws a row's pixel widths and returns them as the shares the page keeps. */
function draw(row: HTMLElement, pixels: number[], pinned: HTMLElement[]): SixRowWidths {
  const shares = sixRowFromPixels(pixels);
  row.style.setProperty("--six-row", sixRowTemplate(shares));
  holdAtBottom(pinned);
  announce(row);
  return shares;
}

function SixCardEdge({
  row,
  edge,
  onChange,
}: {
  /** 0: the top row; 1: the bottom row. */
  row: 0 | 1;
  /** 1: between the row's first and second cards; 2: between its second and third. */
  edge: 1 | 2;
  /** The row's new widths, once a drag ends or a card is reset ("drag") or after a key press ("key"). */
  onChange: (row: number, shares: SixRowWidths, how: "drag" | "key") => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    row: HTMLElement;
    start: number[];
    startX: number;
    pointerX: number;
    frame: number;
    shares: SixRowWidths | undefined;
    pinned: HTMLElement[];
  } | null>(null);
  const first = row * SIX_COLUMNS + edge;

  useLayoutEffect(() => {
    const element = ref.current?.parentElement;
    if (!element) return;
    announce(element);
    const observer = new ResizeObserver(() => announce(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const step = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    current.frame = 0;
    const pixels = moveSixEdge(current.start, edge - 1, current.pointerX - current.startX);
    current.shares = draw(current.row, pixels, current.pinned);
  }, [edge]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const handle = event.currentTarget,
      element = handle.parentElement;
    const start = element && drawnCards(element);
    if (!element || !start) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute("data-dragging", "");
    drag.current = {
      row: element,
      start,
      startX: event.clientX,
      pointerX: event.clientX,
      frame: 0,
      shares: undefined,
      pinned: atBottom(element),
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    current.pointerX = event.clientX;
    if (!current.frame) current.frame = requestAnimationFrame(step);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    if (event.type === "pointerup") current.pointerX = event.clientX;
    if (current.frame) cancelAnimationFrame(current.frame);
    if (current.pointerX !== current.startX) step();
    drag.current = null;
    event.currentTarget.removeAttribute("data-dragging");
    if (current.shares !== undefined) onChange(row, current.shares, "drag");
  };

  /** Puts the card beside this edge that's out of line back to its normal width; the row re-balances. */
  const reset = (handle: HTMLElement) => {
    const element = handle.parentElement;
    const cards = element && drawnCards(element);
    if (!element || !cards) return;
    const card = sixCardToReset(cards, edge - 1);
    if (card === null) return;
    onChange(row, draw(element, resetSixCard(cards, card, edge - 1), atBottom(element)), "drag");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const element = event.currentTarget.parentElement;
    const cards = element && drawnCards(element);
    if (!element || !cards) return;
    if (event.key === "Enter") {
      event.preventDefault();
      return reset(event.currentTarget);
    }
    const size = event.shiftKey ? SIX_KEY_STEP_LARGE_PX : SIX_KEY_STEP_PX;
    const total = cards.reduce((sum, v) => sum + v, 0);
    let delta: number;
    if (event.key === "ArrowLeft") delta = -size;
    else if (event.key === "ArrowRight") delta = size;
    else if (event.key === "Home") delta = -total;
    else if (event.key === "End") delta = total;
    else return;
    event.preventDefault();
    onChange(row, draw(element, moveSixEdge(cards, edge - 1, delta), atBottom(element)), "key");
  };

  return (
    <div
      ref={ref}
      className={styles.edge}
      data-six-handle={edge}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize cards ${first} and ${first + 1}`}
      title="Drag to resize this card. Double-click to put it back to its normal width."
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={(event) => reset(event.currentTarget)}
      onKeyDown={onKeyDown}
    />
  );
}

export default memo(SixCardEdge);
