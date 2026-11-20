"use client";
import { useEffect, useState, type RefObject } from "react";

// Every 5%, so a newest row taller than the list still reports when its end comes into view.
const THRESHOLDS = Array.from({ length: 21 }, (_, step) => step / 20);

/**
 * #477: whether the newest row of a message list is on screen, with its end in view (the reader
 * sees all of it). An IntersectionObserver on that row reports it as the list scrolls, resizes or
 * grows, so nothing runs per scroll frame. `newestKey` changes whenever another row may now be the
 * newest (its id, or the list showing again), and the observer moves to that row.
 */
export function useNewestRowVisible(
  list: RefObject<HTMLElement | null>,
  rowSelector: string,
  newestKey: string,
) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const root = list.current,
      rows = root?.querySelectorAll<HTMLElement>(rowSelector),
      newest = rows?.[rows.length - 1];
    if (!root || !newest || typeof IntersectionObserver === "undefined") {
      setVisible(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1],
          bottom = entry.rootBounds?.bottom ?? Infinity;
        setVisible(
          entry.isIntersecting &&
            (entry.intersectionRatio > 0.98 || entry.boundingClientRect.bottom <= bottom + 2),
        );
      },
      { root, threshold: THRESHOLDS },
    );
    observer.observe(newest);
    return () => observer.disconnect();
  }, [list, rowSelector, newestKey]);
  return visible;
}
