import type { ReaderTheme } from "@/lib/readerProgress";

// #385 Reader: what the reading screen needs from a book, whatever its format. epubEngine.ts and
// pdfEngine.ts each make one; both are loaded only when a book of that kind is opened.

export type TocItem = { label: string; target: string; depth: number };
export type EnginePlace = {
  /** What to save: an EPUB CFI or a PDF page number. */
  location: string;
  /** 0 to 1, or null while an EPUB's page map is still being worked out. */
  percent: number | null;
  chapter: string | null;
  /** Minutes left in this chapter, when it can be estimated. */
  minutesLeft: number | null;
  /** "Page 3 of 12" for PDFs. */
  pageLabel: string | null;
  atStart: boolean;
  atEnd: boolean;
};
export type EngineEvents = {
  onPlace: (place: EnginePlace) => void;
  onToc: (items: TocItem[]) => void;
  /** A tap in the middle of the page (not on an edge). */
  onTap?: (side: "left" | "right" | "middle") => void;
  onKey?: (event: KeyboardEvent) => void;
  onSwipe?: (direction: "next" | "prev") => void;
};
export interface ReaderEngine {
  next(): void;
  prev(): void;
  goTo(target: string): void;
  setTheme(theme: ReaderTheme): void;
  setFontSize(percent: number): void;
  resize(): void;
  destroy(): void;
}
export type EngineOptions = {
  host: HTMLElement;
  data: ArrayBuffer;
  bookId: string;
  start?: string;
  theme: ReaderTheme;
  fontSize: number;
  events: EngineEvents;
};

/** A horizontal swipe of at least 40px that is more sideways than up and down, within a second. */
export function swipeDirection(start: { x: number; y: number; t: number }, end: { x: number; y: number; t: number }): "next" | "prev" | null {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  if (end.t - start.t > 1000 || Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "prev";
}
