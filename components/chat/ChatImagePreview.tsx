"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { mediaFrameStyle } from "@/lib/chatAttachmentMedia";
import {
  PHOTO_ATTRIBUTE,
  PHOTO_SET_ATTRIBUTE,
  photoAttributes,
  photoPosition,
  photosFromSlots,
  photoStep,
  photosToPreload,
  swipeStep,
  type ChatPhoto,
} from "@/lib/chatPhotoSet";
import styles from "./ChatImagePreview.module.css";

/**
 * The same reserved box as the preview, shown while the file details load. With `photo`, the slot
 * already counts in the open viewer's set (#375), so stepping through a view does not skip it.
 */
export function ChatImagePlaceholder({
  width,
  height,
  photo,
}: {
  width?: number | null;
  height?: number | null;
  photo?: ChatPhoto;
}) {
  return (
    <span
      className={styles.thumbnail}
      style={mediaFrameStyle(width, height)}
      role="status"
      {...(photo ? photoAttributes(photo) : {})}
    >
      <span>Loading image…</span>
    </span>
  );
}

/** #375: the photos of the view `element` sits in, oldest first; just `self` outside a marked view. */
function photoSet(element: Element | null, self: ChatPhoto): ChatPhoto[] {
  const view = element?.closest(`[${PHOTO_SET_ATTRIBUTE}]`);
  if (!view) return [self];
  return photosFromSlots(
    Array.from(view.querySelectorAll<HTMLElement>(`[${PHOTO_ATTRIBUTE}]`), (slot) => slot.dataset),
  );
}

/** The thumbnail of `id` in the opener's view, when it is a button at least partly on screen. */
function visibleThumbnail(opener: HTMLElement | null, id: string) {
  const view = opener?.closest(`[${PHOTO_SET_ATTRIBUTE}]`);
  const button = view?.querySelector<HTMLButtonElement>(`button[${PHOTO_ATTRIBUTE}="${CSS.escape(id)}"]`);
  if (!view || !button) return null;
  const shown = button.getBoundingClientRect(),
    frame = view.getBoundingClientRect();
  const top = Math.max(0, frame.top),
    bottom = Math.min(window.innerHeight, frame.bottom);
  return shown.height > 0 && shown.bottom > top && shown.top < bottom ? button : null;
}

/** URLs remain owned by the caller's authenticated room/DM attachment routes. */
export default function ChatImagePreview({
  photoId,
  src,
  thumbnailSrc,
  width,
  height,
  alt,
  downloadHref,
}: {
  /** The attachment id: names this photo in its view's set (#375). */
  photoId?: string;
  src: string;
  thumbnailSrc?: string;
  /** Server-known pixel size (MEDIA-SIZE); missing means the fixed 302×220 box. */
  width?: number | null;
  height?: number | null;
  alt: string;
  downloadHref: string;
}) {
  const self: ChatPhoto = { id: photoId ?? src, src, alt, downloadHref };
  const [thumbnailFailed, setThumbnailFailed] = useState(!thumbnailSrc);
  useEffect(() => setThumbnailFailed(!thumbnailSrc), [thumbnailSrc]);
  const [open, setOpen] = useState(false),
    [failed, setFailed] = useState(false),
    [loading, setLoading] = useState(true),
    // #375: the photos the viewer steps through, and the one showing.
    [set, setSet] = useState<ChatPhoto[]>([]),
    [currentId, setCurrentId] = useState(self.id);
  const trigger = useRef<HTMLButtonElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    close = useRef<HTMLButtonElement>(null),
    previousButton = useRef<HTMLButtonElement>(null),
    nextButton = useRef<HTMLButtonElement>(null),
    stage = useRef<HTMLDivElement>(null),
    touch = useRef<{ x: number; y: number; multi: boolean } | null>(null),
    preloads = useRef<HTMLImageElement[]>([]);
  const position = photoPosition(set, currentId, self),
    shown = position.photo;
  const showing = useRef(shown.id);
  showing.current = shown.id;
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const modal = dialog.current!,
      originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modal.showModal();
    close.current?.focus();
    const opener = trigger.current;
    return () => {
      modal.close();
      document.body.style.overflow = originalOverflow;
      // Back to the photo now showing when it is in view, else to the one that was opened.
      const target = visibleThumbnail(opener, showing.current) ?? opener;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
  }, [open]);
  // A step can remove the button that had focus (Next on the last photo): keep focus in the viewer.
  useEffect(() => {
    if (!open || dialog.current?.contains(document.activeElement)) return;
    (previousButton.current ?? nextButton.current ?? close.current)?.focus();
  }, [open, shown.id]);
  // The neighbours load while this photo is looked at, so a step shows them at once.
  const preloadKey = open ? photosToPreload(position).join(" ") : "";
  useEffect(() => {
    preloads.current = preloadKey
      ? preloadKey.split(" ").map((url) => {
          const image = new window.Image();
          image.decoding = "async";
          image.src = url;
          return image;
        })
      : [];
  }, [preloadKey]);
  const step = (direction: -1 | 1) => {
    // Re-read the view so photos that arrived while the viewer was open count too.
    const fresh = photoSet(trigger.current, self),
      photos = fresh.some((photo) => photo.id === shown.id) ? fresh : set;
    const target = photoStep(photos, shown.id, direction);
    if (!target) return;
    setSet(photos);
    setCurrentId(target.id);
    setFailed(false);
    setLoading(true);
  };
  const keyboard = (event: KeyboardEvent<HTMLDialogElement>) => {
    // A preview inside a reply/DM portal must not trigger the underlying chat keys.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (
      (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      step(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.key === "Tab") {
      const controls = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]") ?? [],
        ),
        first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };
  // One finger swiping sideways steps; pinches and pans of a zoomed-in page are left to the browser.
  const touchStart = (event: ReactTouchEvent) => {
    // The chat under the viewer (its scroll and swipe handling) does not see these touches.
    event.stopPropagation();
    const finger = event.touches[0];
    if (event.touches.length > 1) {
      if (touch.current) touch.current.multi = true;
      else touch.current = { x: finger.clientX, y: finger.clientY, multi: true };
    } else if (finger) touch.current = { x: finger.clientX, y: finger.clientY, multi: false };
  };
  // Native and not passive, so a sideways one-finger swipe can be kept from the browser: left to it,
  // a swipe right on a phone is also the browser's own Back, which leaves the room (#375).
  useEffect(() => {
    const area = stage.current;
    if (!open || !area) return;
    const move = (event: TouchEvent) => {
      const start = touch.current,
        finger = event.touches[0];
      if (!start || !finger) return;
      if (event.touches.length > 1) start.multi = true;
      const zoomed = (window.visualViewport?.scale ?? 1) > 1.01;
      const dx = Math.abs(finger.clientX - start.x),
        dy = Math.abs(finger.clientY - start.y);
      if (!start.multi && !zoomed && dx > dy && event.cancelable) event.preventDefault();
    };
    area.addEventListener("touchmove", move, { passive: false });
    return () => area.removeEventListener("touchmove", move);
  }, [open]);
  const touchEnd = (event: ReactTouchEvent) => {
    event.stopPropagation();
    if (event.touches.length > 0) return;
    const start = touch.current,
      finger = event.changedTouches[0];
    touch.current = null;
    if (!start || !finger) return;
    const direction = swipeStep({
      dx: finger.clientX - start.x,
      dy: finger.clientY - start.y,
      multiTouch: start.multi,
      zoom: window.visualViewport?.scale ?? 1,
    });
    if (direction) step(direction);
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.thumbnail}
        style={mediaFrameStyle(width, height)}
        aria-label={`Enlarge ${alt}`}
        aria-haspopup="dialog"
        {...photoAttributes(self)}
        onClick={() => {
          setSet(photoSet(trigger.current, self));
          setCurrentId(self.id);
          setFailed(false);
          setLoading(true);
          setOpen(true);
        }}
      >
        {thumbnailFailed || !thumbnailSrc ? (
          <span>Preview unavailable · Open original</span>
        ) : (
          <Image
            unoptimized
            src={thumbnailSrc}
            alt={alt}
            width={width ?? 320}
            height={height ?? 220}
            loading="lazy"
            onError={() => setThumbnailFailed(true)}
          />
        )}
      </button>
      {open &&
        createPortal(
          <dialog
            ref={dialog}
            className={styles.dialog}
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={keyboard}
            onCancel={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <section className={styles.panel}>
              <header className={styles.header}>
                <h2 id={titleId}>{shown.alt}</h2>
                {position.label && (
                  <span className={styles.position} data-photo-position aria-live="polite">
                    {position.label}
                  </span>
                )}
                <button
                  ref={close}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close image preview"
                >
                  ×
                </button>
              </header>
              <div
                className={styles.imageArea}
                aria-busy={loading}
                data-photo-stage
                onTouchStart={touchStart}
                ref={stage}
                onTouchEnd={touchEnd}
                onTouchCancel={() => (touch.current = null)}
              >
                {failed ? (
                  <p role="alert">
                    This image could not load. Try opening it again or download the file below.
                  </p>
                ) : (
                  <Image
                    key={shown.id}
                    className={styles.image}
                    unoptimized
                    src={shown.src}
                    alt={shown.alt}
                    width={1600}
                    height={1200}
                    onLoad={() => setLoading(false)}
                    onError={() => {
                      setLoading(false);
                      setFailed(true);
                    }}
                  />
                )}
                {loading && (
                  <span className={styles.loading} role="status">
                    Loading image…
                  </span>
                )}
                {position.previous && (
                  <button
                    ref={previousButton}
                    type="button"
                    className={`${styles.step} ${styles.previous}`}
                    aria-label="Previous photo"
                    onClick={() => step(-1)}
                  >
                    ‹
                  </button>
                )}
                {position.next && (
                  <button
                    ref={nextButton}
                    type="button"
                    className={`${styles.step} ${styles.next}`}
                    aria-label="Next photo"
                    onClick={() => step(1)}
                  >
                    ›
                  </button>
                )}
              </div>
              <footer className={styles.footer}>
                <a href={shown.downloadHref} target="_blank" rel="noopener noreferrer">
                  Download original
                </a>
              </footer>
            </section>
          </dialog>,
          document.body,
        )}
    </>
  );
}
