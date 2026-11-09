import { THEME_COLORS, type ReaderTheme } from "@/lib/readerProgress";
import { PDF_WORKER_URL } from "./pdfWorker";
import type { EngineOptions, ReaderEngine, TocItem } from "./engine";

// #385 PDF books, drawn by Mozilla's PDF.js (pdfjs-dist) one page at a time onto a canvas, fitted to
// the screen. PDF.js never runs a PDF's own JavaScript (that needs its full viewer with scripting
// turned on, which we don't use); links and form fields are not drawn as live elements either. The
// dark, sepia and terminal themes tint the drawn page rather than re-colouring the PDF.

const FILTERS: Record<ReaderTheme, string> = {
  light: "none",
  sepia: "sepia(0.45) brightness(0.97)",
  dark: "invert(0.9) hue-rotate(180deg)",
  terminal: "invert(0.88) hue-rotate(180deg) sepia(0.1)",
};

export async function createPdfEngine(options: EngineOptions): Promise<ReaderEngine> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  const { host, events } = options;
  // PDF.js takes the buffer over, so it gets a copy.
  const loading = pdfjs.getDocument({ data: new Uint8Array(options.data.slice(0)), enableXfa: false, stopAtErrors: false });
  const doc = await loading.promise;
  const pages = doc.numPages;
  const canvas = document.createElement("canvas");
  canvas.setAttribute("data-reader-pdf-page", "");
  canvas.style.display = "block";
  canvas.style.margin = "0 auto";
  canvas.style.boxShadow = "0 1px 6px rgba(0,0,0,0.18)";
  host.replaceChildren(canvas);
  host.style.display = "flex";
  host.style.alignItems = "center";
  host.style.justifyContent = "center";
  host.style.overflow = "hidden";
  let page = Math.min(pages, Math.max(1, Number(options.start) || 1));
  let destroyed = false;
  let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
  let outline: { label: string; page: number }[] = [];

  const chapterOf = (n: number) => {
    let label: string | null = null;
    for (const item of outline) if (item.page <= n) label = item.label;
    return label;
  };
  const report = () =>
    events.onPlace({
      location: String(page),
      percent: pages > 1 ? (page - 1) / (pages - 1) : 1,
      chapter: chapterOf(page),
      minutesLeft: null,
      pageLabel: `Page ${page} of ${pages}`,
      atStart: page <= 1,
      atEnd: page >= pages,
    });

  const draw = async () => {
    const shown = page;
    const pdfPage = await doc.getPage(shown);
    if (destroyed || shown !== page) return;
    const base = pdfPage.getViewport({ scale: 1 });
    const width = Math.max(100, host.clientWidth - 16),
      height = Math.max(100, host.clientHeight - 16);
    const scale = Math.min(width / base.width, height / base.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const viewport = pdfPage.getViewport({ scale: scale * ratio });
    task?.cancel();
    const offscreen = document.createElement("canvas");
    offscreen.width = Math.floor(viewport.width);
    offscreen.height = Math.floor(viewport.height);
    const render = pdfPage.render({ canvas: offscreen, viewport });
    task = render;
    try {
      await render.promise;
    } catch {
      return; // Cancelled by a newer page.
    }
    if (destroyed || shown !== page) return;
    canvas.width = offscreen.width;
    canvas.height = offscreen.height;
    canvas.getContext("2d")!.drawImage(offscreen, 0, 0);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    canvas.dataset.page = String(shown);
  };
  const show = (n: number) => {
    const next = Math.min(pages, Math.max(1, n));
    if (next === page && canvas.dataset.page) return;
    page = next;
    report();
    void draw();
  };
  const setTheme = (theme: ReaderTheme) => {
    canvas.style.filter = FILTERS[theme];
    host.style.background = THEME_COLORS[theme].bg;
  };
  setTheme(options.theme);
  page = Math.min(pages, Math.max(1, page));
  report();
  await draw();

  // The PDF's own bookmarks, when it has them, become the table of contents.
  void (async () => {
    try {
      const items = (await doc.getOutline()) ?? [];
      const flat: TocItem[] = [];
      const resolved: { label: string; page: number }[] = [];
      const walk = async (list: typeof items, depth: number) => {
        for (const item of list) {
          let dest = item.dest;
          if (typeof dest === "string") dest = await doc.getDestination(dest);
          const ref = Array.isArray(dest) ? dest[0] : null;
          let target: number | null = null;
          if (ref && typeof ref === "object") target = (await doc.getPageIndex(ref as never)) + 1;
          else if (typeof ref === "number") target = ref + 1;
          if (target) {
            flat.push({ label: item.title || `Page ${target}`, target: String(target), depth });
            resolved.push({ label: item.title, page: target });
          }
          if (item.items?.length && depth < 2) await walk(item.items, depth + 1);
        }
      };
      await walk(items, 0);
      outline = resolved.sort((a, b) => a.page - b.page);
      if (destroyed) return;
      events.onToc(flat.length ? flat : [{ label: "Beginning", target: "1", depth: 0 }]);
      report();
    } catch {
      events.onToc([{ label: "Beginning", target: "1", depth: 0 }]);
    }
  })();

  return {
    next: () => show(page + 1),
    prev: () => show(page - 1),
    goTo: (target) => show(Number(target) || 1),
    setTheme,
    setFontSize: () => {},
    resize: () => void draw(),
    destroy: () => {
      destroyed = true;
      task?.cancel();
      void loading.destroy();
      host.replaceChildren();
    },
  };
}
