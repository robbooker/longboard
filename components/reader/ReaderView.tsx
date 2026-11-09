"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { progressLabel, type ReaderOpenBook } from "@/lib/reader";
import {
  READER_PREFS_KEY,
  READER_THEMES,
  createProgressSaver,
  parsePrefs,
  readChatTheme,
  saveProgressRequest,
  startLocation,
  stepFontSize,
  themeFromChat,
  type ReaderPrefs,
  type ReaderTheme,
} from "@/lib/readerProgress";
import { swipeDirection, type EnginePlace, type ReaderEngine, type TocItem } from "./engine";
import styles from "./reader.module.css";

// #385 The reading screen, full screen at /reader/<id>: the page, a slim bar on top (back to the
// library, contents, text size and theme) and the progress line underneath. Turn pages by tapping or
// clicking the left or right edge, with the arrow keys (or Page Up/Down, Space), or by swiping on a
// phone. The member's place is saved to their account a moment after they stop turning pages, and
// again when the tab is hidden, so the book opens at the same page on every device.

type Status = { state: "loading"; note: string } | { state: "error"; note: string } | { state: "ready" };
const LIBRARY_HREF = "/chat?page=reader";

function usePrefs() {
  const [prefs, setPrefs] = useState<ReaderPrefs>(() => {
    try {
      return parsePrefs(typeof window === "undefined" ? null : window.localStorage.getItem(READER_PREFS_KEY));
    } catch {
      return parsePrefs(null);
    }
  });
  const update = useCallback((next: Partial<ReaderPrefs>) => {
    setPrefs((current) => {
      const merged = { ...current, ...next };
      try {
        window.localStorage.setItem(READER_PREFS_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }, []);
  return [prefs, update] as const;
}

export default function ReaderView({ bookId }: { bookId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<ReaderEngine | null>(null);
  const [prefs, setPrefs] = usePrefs();
  const [chatTheme] = useState(() => (typeof window === "undefined" ? null : readChatTheme()));
  const theme: ReaderTheme =
    prefs.theme === "auto"
      ? themeFromChat(chatTheme, typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches)
      : prefs.theme;
  const [status, setStatus] = useState<Status>({ state: "loading", note: "Opening the book…" });
  const [book, setBook] = useState<ReaderOpenBook["book"] | null>(null);
  const [place, setPlace] = useState<EnginePlace | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [panel, setPanel] = useState<"toc" | "settings" | null>(null);
  const saver = useRef<ReturnType<typeof createProgressSaver> | null>(null);
  const lastPercent = useRef(0);
  const settings = useRef({ theme, fontSize: prefs.fontSize });
  settings.current = { theme, fontSize: prefs.fontSize };

  const turn = useCallback((direction: "next" | "prev") => {
    if (direction === "next") engine.current?.next();
    else engine.current?.prev();
  }, []);
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Escape") return setPanel(null);
      if (event.key === "ArrowRight" || event.key === "PageDown" || (event.key === " " && !event.shiftKey)) {
        event.preventDefault();
        turn("next");
      } else if (event.key === "ArrowLeft" || event.key === "PageUp" || (event.key === " " && event.shiftKey)) {
        event.preventDefault();
        turn("prev");
      }
    },
    [turn],
  );

  // Open the book: ask for a short-lived link and the saved place, download the file, draw it.
  useEffect(() => {
    let cancelled = false;
    let made: ReaderEngine | null = null;
    const saveNow = () => void saver.current?.flush(true);
    const onHidden = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    (async () => {
      try {
        const response = await fetch(`/api/chat/reader/books/${bookId}`, { credentials: "same-origin", cache: "no-store" });
        if (response.status === 403) throw new Error("The Reader is for Booker Stock Club members.");
        if (response.status === 404) throw new Error("This book isn’t on the shelf any more.");
        if (!response.ok) throw new Error("The book couldn’t be opened right now. Please try again.");
        const opened = (await response.json()) as ReaderOpenBook;
        if (cancelled) return;
        setBook(opened.book);
        document.title = `${opened.book.title} · Reader`;
        setStatus({ state: "loading", note: "Downloading the book…" });
        const file = await fetch(opened.url, { cache: "no-store" });
        if (!file.ok) throw new Error("The book couldn’t be downloaded. Please try again.");
        const data = await file.arrayBuffer();
        if (cancelled || !host.current) return;
        const saved = opened.progress;
        lastPercent.current = saved?.percent ?? 0;
        const save = createProgressSaver(saveProgressRequest(bookId));
        if (saved) save.markSaved({ location: saved.location, percent: saved.percent });
        saver.current = save;
        const create =
          opened.book.format === "pdf"
            ? (await import("./pdfEngine")).createPdfEngine
            : (await import("./epubEngine")).createEpubEngine;
        made = await create({
          host: host.current,
          data,
          bookId,
          start: startLocation(saved),
          theme: settings.current.theme,
          fontSize: settings.current.fontSize,
          events: {
            onPlace: (next) => {
              if (cancelled) return;
              // While an EPUB's page map is still being worked out, keep the last known percent.
              const percent = next.percent ?? lastPercent.current;
              if (next.percent !== null) lastPercent.current = next.percent;
              setPlace({ ...next, percent });
              save.update({ location: next.location, percent });
            },
            onToc: (items) => !cancelled && setToc(items),
            onKey,
            onSwipe: (direction) => turn(direction),
          },
        });
        if (cancelled) {
          made.destroy();
          return;
        }
        engine.current = made;
        setStatus({ state: "ready" });
      } catch (error) {
        if (!cancelled) setStatus({ state: "error", note: error instanceof Error ? error.message : "The book couldn’t be opened." });
      }
    })();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", saveNow);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", saveNow);
      saveNow();
      made?.destroy();
      engine.current = null;
    };
  }, [bookId, onKey, turn]);

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);
  useEffect(() => engine.current?.setTheme(theme), [theme, status.state]);
  useEffect(() => engine.current?.setFontSize(prefs.fontSize), [prefs.fontSize, status.state]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let frame = 0;
    // Only real size changes (a rotated phone, a resized window): redrawing re-lays out the book.
    let size = `${element.clientWidth}x${element.clientHeight}`;
    const observer = new ResizeObserver(() => {
      const next = `${element.clientWidth}x${element.clientHeight}`;
      if (next === size) return;
      size = next;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => engine.current?.resize());
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Swipes over the edge areas and the PDF page (EPUB swipes inside the book come from its engine).
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    const t = event.changedTouches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const t = event.changedTouches[0];
    const direction = touch.current ? swipeDirection(touch.current, { x: t.clientX, y: t.clientY, t: Date.now() }) : null;
    touch.current = null;
    if (direction) {
      event.preventDefault();
      turn(direction);
    }
  };

  const isEpub = book?.format === "epub";
  const percent = place?.percent ?? 0;
  const label = place ? progressLabel(percent, place.minutesLeft) : "";
  return (
    <div className={styles.reader} data-reader data-reader-theme={theme} data-reader-format={book?.format} data-reader-location={place?.location}>
      <header className={styles.bar}>
        <a className={styles.barButton} href={LIBRARY_HREF} data-reader-back>
          <span aria-hidden="true">‹</span> Library
        </a>
        <div className={styles.barTitle}>
          <strong>{book?.title ?? "Reader"}</strong>
          {book?.author && <span>{book.author}</span>}
        </div>
        <button
          type="button"
          className={styles.barButton}
          aria-expanded={panel === "toc"}
          onClick={() => setPanel(panel === "toc" ? null : "toc")}
          disabled={!toc.length}
          data-reader-toc-button
        >
          Contents
        </button>
        <button
          type="button"
          className={styles.barButton}
          aria-expanded={panel === "settings"}
          aria-label="Text and theme"
          onClick={() => setPanel(panel === "settings" ? null : "settings")}
          data-reader-settings-button
        >
          Aa
        </button>
      </header>

      <main className={styles.stage} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div ref={host} className={styles.host} data-reader-host />
        {status.state === "ready" && (
          <>
            <button type="button" className={`${styles.edge} ${styles.edgeLeft}`} aria-label="Previous page" onClick={() => turn("prev")} disabled={place?.atStart} data-reader-prev />
            <button type="button" className={`${styles.edge} ${styles.edgeRight}`} aria-label="Next page" onClick={() => turn("next")} disabled={place?.atEnd} data-reader-next />
          </>
        )}
        {status.state !== "ready" && (
          <p className={status.state === "error" ? styles.error : styles.status} role="status" data-reader-status={status.state}>
            {status.note}
            {status.state === "error" && (
              <a href={LIBRARY_HREF} className={styles.statusLink}>
                Back to the library
              </a>
            )}
          </p>
        )}
      </main>

      <footer className={styles.footer}>
        <div className={styles.track} role="progressbar" aria-label="How far through the book" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent * 100)}>
          <div className={styles.fill} style={{ width: `${percent * 100}%` }} />
        </div>
        <div className={styles.footLine}>
          <span className={styles.chapter} data-reader-chapter>
            {place?.pageLabel ?? place?.chapter ?? ""}
          </span>
          <span data-reader-progress>{label}</span>
        </div>
      </footer>

      {panel && <button type="button" className={styles.scrim} aria-label="Close" onClick={() => setPanel(null)} />}
      {panel === "toc" && (
        <nav className={styles.panel} aria-label="Contents" data-reader-toc>
          <h2 className={styles.panelTitle}>Contents</h2>
          <ol className={styles.tocList}>
            {toc.map((item, index) => (
              <li key={`${item.target}-${index}`} style={{ paddingLeft: `${item.depth * 14}px` }}>
                <button
                  type="button"
                  className={styles.tocItem}
                  aria-current={place?.chapter === item.label ? "true" : undefined}
                  onClick={() => {
                    engine.current?.goTo(item.target);
                    setPanel(null);
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {panel === "settings" && (
        <div className={`${styles.panel} ${styles.settings}`} role="dialog" aria-label="Text and theme" data-reader-settings>
          {isEpub && (
            <div className={styles.setting}>
              <span className={styles.settingLabel}>Text size</span>
              <div className={styles.sizeRow}>
                <button type="button" className={styles.sizeButton} aria-label="Smaller text" onClick={() => setPrefs({ fontSize: stepFontSize(prefs.fontSize, -1) })} data-reader-font="smaller">
                  A−
                </button>
                <span className={styles.sizeValue} data-reader-font-size>
                  {prefs.fontSize}%
                </span>
                <button type="button" className={styles.sizeButton} aria-label="Larger text" onClick={() => setPrefs({ fontSize: stepFontSize(prefs.fontSize, 1) })} data-reader-font="larger">
                  A+
                </button>
              </div>
            </div>
          )}
          <div className={styles.setting}>
            <span className={styles.settingLabel}>Theme</span>
            <div className={styles.themeRow} role="radiogroup" aria-label="Theme">
              {READER_THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={prefs.theme === option.value}
                  className={styles.themeChip}
                  data-swatch={option.value === "auto" ? themeFromChat(chatTheme) : option.value}
                  onClick={() => setPrefs({ theme: option.value })}
                  data-reader-theme-choice={option.value}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
