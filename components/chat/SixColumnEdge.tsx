"use client";
// #470: the draggable edge between two of Six view's columns (computers only; the CSS hides it below
// 1100px). It sits in its own 8px grid track, so it follows the columns with no measuring. A drag
// changes a CSS variable on the grid and nothing else, so the cards don't render while it moves; the
// page hears about the new widths once, when the drag ends (or after each arrow key press).
import { memo, useCallback, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  SIX_COLUMNS,
  SIX_KEY_STEP_LARGE_PX,
  SIX_KEY_STEP_PX,
  moveSixEdge,
  sixColumnsTemplate,
  sixEdgeRange,
  sixWidthsFromPixels,
  type SixWidths,
} from "@/lib/chatSixWidths";
import chatStyles from "./PublicChat.module.css";
import styles from "./SixChat.module.css";

/** The card columns as drawn, in pixels. Null when the grid isn't three columns (narrower windows, phones). */
function drawnColumns(grid: HTMLElement) {
  const tracks = getComputedStyle(grid).gridTemplateColumns.split(" ").map(parseFloat);
  if (tracks.length !== SIX_COLUMNS * 2 - 1 || !tracks.every(Number.isFinite)) return null;
  return tracks.filter((_, i) => i % 2 === 0);
}

/** Keeps every edge's announced values true. They live outside React so a drag renders nothing. */
function announce(grid: HTMLElement) {
  const columns = drawnColumns(grid);
  if (!columns) return;
  const total = columns.reduce((sum, v) => sum + v, 0);
  grid.querySelectorAll<HTMLElement>("[data-six-handle]").forEach((handle) => {
    const edge = Number(handle.dataset.sixHandle) - 1;
    const range = sixEdgeRange(columns, edge);
    const pct = (i: number) => Math.round(((columns[i] ?? 0) / total) * 100);
    handle.setAttribute("aria-valuenow", String(range.now));
    handle.setAttribute("aria-valuemin", String(range.min));
    handle.setAttribute("aria-valuemax", String(range.max));
    handle.setAttribute(
      "aria-valuetext",
      `Column ${edge + 1} ${pct(edge)}%, column ${edge + 2} ${pct(edge + 1)}%`,
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
const atBottom = (grid: HTMLElement) =>
  [...grid.querySelectorAll<HTMLElement>(`.${chatStyles.messages}, .${chatStyles.replyContents}`)].filter(
    (node) => node.clientHeight > 0 && node.scrollHeight - node.scrollTop - node.clientHeight < 4,
  );

/** Draws pixel widths and returns them as the fractions the page keeps. */
function draw(grid: HTMLElement, pixels: number[], pinned: HTMLElement[]): SixWidths | null {
  const widths = sixWidthsFromPixels(pixels);
  grid.style.setProperty("--six-columns", sixColumnsTemplate(widths));
  holdAtBottom(pinned);
  announce(grid);
  return widths;
}

function SixColumnEdge({
  edge,
  onChange,
}: {
  /** 1: between the first and second columns; 2: between the second and third. */
  edge: 1 | 2;
  /** New widths, once a drag ends ("drag") or after a key press ("key"). */
  onChange: (widths: SixWidths | null, how: "drag" | "key") => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    grid: HTMLElement;
    start: number[];
    startX: number;
    pointerX: number;
    frame: number;
    widths: SixWidths | null | undefined;
    pinned: HTMLElement[];
  } | null>(null);

  useLayoutEffect(() => {
    const grid = ref.current?.parentElement;
    if (!grid) return;
    announce(grid);
    const observer = new ResizeObserver(() => announce(grid));
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

  const step = useCallback(() => {
    const current = drag.current;
    if (!current) return;
    current.frame = 0;
    const pixels = moveSixEdge(current.start, edge - 1, current.pointerX - current.startX);
    current.widths = draw(current.grid, pixels, current.pinned);
  }, [edge]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const handle = event.currentTarget,
      grid = handle.parentElement;
    const start = grid && drawnColumns(grid);
    if (!grid || !start) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.setAttribute("data-dragging", "");
    drag.current = {
      grid,
      start,
      startX: event.clientX,
      pointerX: event.clientX,
      frame: 0,
      widths: undefined,
      pinned: atBottom(grid),
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
    if (current.widths !== undefined) onChange(current.widths, "drag");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grid = event.currentTarget.parentElement;
    const columns = grid && drawnColumns(grid);
    if (!grid || !columns) return;
    const size = event.shiftKey ? SIX_KEY_STEP_LARGE_PX : SIX_KEY_STEP_PX;
    const pair = columns[edge - 1] + columns[edge];
    let delta: number;
    if (event.key === "ArrowLeft") delta = -size;
    else if (event.key === "ArrowRight") delta = size;
    else if (event.key === "Home") delta = -pair;
    else if (event.key === "End") delta = pair;
    else return;
    event.preventDefault();
    onChange(draw(grid, moveSixEdge(columns, edge - 1, delta), atBottom(grid)), "key");
  };

  return (
    <div
      ref={ref}
      className={styles.edge}
      data-six-handle={edge}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize columns ${edge} and ${edge + 1}`}
      title="Drag to resize columns"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
    />
  );
}

export default memo(SixColumnEdge);
