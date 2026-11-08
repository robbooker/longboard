import ePub, { type Book, type Location, type NavItem, type Rendition } from "epubjs";
import { minutesLeft } from "@/lib/reader";
import { THEME_COLORS, type ReaderTheme } from "@/lib/readerProgress";
import { sanitizeEpubDocument } from "@/lib/readerSanitize";
import { swipeDirection, type EngineOptions, type ReaderEngine, type TocItem } from "./engine";

// #385 EPUB books, drawn by epub.js (https://github.com/futurepress/epub.js). Each chapter goes into
// an iframe sandboxed with allow-same-origin only, so the book's own scripts never run (we never set
// allowScriptedContent), and lib/readerSanitize.ts also strips scripts, frames and event handlers
// from every chapter before it is drawn. The book comes in as one downloaded file; its pictures and
// styles are served to the iframe from blob: links, never from the internet.

const LOCATION_CHARS = 1200;
const locationsKey = (id: string) => `longboard-reader-locations-v1:${id}`;
const BOOK_FONT: Record<ReaderTheme, string> = {
  light: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif',
  sepia: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif',
  dark: 'Georgia, "Iowan Old Style", "Palatino Linotype", Palatino, serif',
  terminal: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
};

function flattenToc(items: NavItem[], depth = 0, out: TocItem[] = []): TocItem[] {
  for (const item of items) {
    out.push({ label: item.label.trim() || "Untitled", target: item.href, depth });
    if (item.subitems?.length && depth < 3) flattenToc(item.subitems, depth + 1, out);
  }
  return out;
}

export async function createEpubEngine(options: EngineOptions): Promise<ReaderEngine> {
  const { host, data, bookId, events } = options;
  const book: Book = ePub(data);
  // Before any chapter is drawn: take out anything active (scripts are already blocked by the sandbox).
  (book.spine as unknown as { hooks: { content: { register: (fn: (doc: Document) => void) => void } } }).hooks.content.register(
    (doc) => void sanitizeEpubDocument(doc),
  );
  const rendition: Rendition = book.renderTo(host, {
    width: "100%",
    height: "100%",
    flow: "paginated",
    spread: "auto",
    minSpreadWidth: 900,
    allowScriptedContent: false,
  });
  let toc: TocItem[] = [];
  let destroyed = false;
  const wordsBySection = new Map<string, number>();
  let last: Location | null = null;

  const chapterOf = (href: string) => {
    const clean = href.split("#")[0];
    let found: string | null = null;
    for (const item of toc) if (item.target.split("#")[0] === clean || clean.endsWith(item.target.split("#")[0])) found ??= item.label;
    return found;
  };
  const report = (location: Location) => {
    last = location;
    const start = location.start;
    const ready = book.locations.length() > 0;
    const words = wordsBySection.get(start.href) ?? 0;
    const pages = start.displayed?.total ?? 0;
    // Both pages of a spread count as read.
    const page = Math.max(start.displayed?.page ?? 1, location.end?.displayed?.page ?? 1);
    events.onPlace({
      location: start.cfi,
      percent: ready ? Math.min(1, Math.max(0, location.atEnd ? 1 : book.locations.percentageFromCfi(start.cfi))) : null,
      chapter: chapterOf(start.href),
      minutesLeft: minutesLeft(words, page, pages),
      pageLabel: null,
      atStart: location.atStart,
      atEnd: location.atEnd,
    });
  };

  const applyTheme = (theme: ReaderTheme) => {
    const colors = THEME_COLORS[theme];
    rendition.themes.override("color", colors.text, true);
    rendition.themes.override("background", colors.bg, true);
    rendition.themes.override("font-family", BOOK_FONT[theme], true);
    rendition.themes.override("line-height", "1.55", true);
    host.style.background = colors.bg;
  };
  rendition.themes.default({
    html: { "overscroll-behavior": "none", "touch-action": "pan-y pinch-zoom" },
    a: { color: "inherit !important" },
    img: { "max-width": "100% !important" },
  });
  applyTheme(options.theme);
  rendition.themes.fontSize(`${options.fontSize}%`);

  rendition.hooks.content.register((contents: { document: Document; window: Window }) => {
    const text = contents.document.body?.textContent ?? "";
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    // The section this iframe holds: epub.js sets its index on the contents.
    const index = (contents as unknown as { sectionIndex?: number }).sectionIndex;
    const item = typeof index === "number" ? book.spine.get(index) : null;
    if (item) wordsBySection.set(item.href, words);
    // Swipes and keys inside the book's iframe come out to the reader.
    let touch: { x: number; y: number; t: number } | null = null;
    contents.document.addEventListener("touchstart", (event) => {
      const t = event.changedTouches[0];
      touch = { x: t.screenX, y: t.screenY, t: Date.now() };
    }, { passive: true });
    contents.document.addEventListener("touchend", (event) => {
      const t = event.changedTouches[0];
      const direction = touch ? swipeDirection(touch, { x: t.screenX, y: t.screenY, t: Date.now() }) : null;
      touch = null;
      if (direction) events.onSwipe?.(direction);
    }, { passive: true });
    contents.document.addEventListener("keydown", (event) => events.onKey?.(event));
    // Links to other websites open in a new tab, outside the sandbox.
    contents.document.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.getAttribute("href") ?? "";
      if (/^https?:\/\//i.test(href)) {
        event.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
      }
    });
  });
  rendition.on("relocated", (location: Location) => {
    if (!destroyed) report(location);
  });

  const navigation = await book.loaded.navigation;
  toc = flattenToc(navigation.toc ?? []);
  events.onToc(toc);
  await rendition.display(options.start || undefined).catch(() => rendition.display());

  // The page map behind "x%": saved in this browser after the first time, worked out in the background.
  void (async () => {
    try {
      const saved = window.localStorage.getItem(locationsKey(bookId));
      if (saved) book.locations.load(saved);
    } catch {}
    if (!book.locations.length()) {
      await book.locations.generate(LOCATION_CHARS);
      try {
        window.localStorage.setItem(locationsKey(bookId), book.locations.save());
      } catch {}
    }
    if (!destroyed && last) report(last);
  })();

  return {
    next: () => void rendition.next(),
    prev: () => void rendition.prev(),
    goTo: (target) => void rendition.display(target),
    setTheme: (theme) => applyTheme(theme),
    setFontSize: (percent) => rendition.themes.fontSize(`${percent}%`),
    resize: () => {
      try {
        rendition.resize(host.clientWidth, host.clientHeight);
      } catch {}
    },
    destroy: () => {
      destroyed = true;
      try {
        rendition.destroy();
        book.destroy();
      } catch {}
    },
  };
}
