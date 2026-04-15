"use client";

import { useEffect, useRef } from "react";

/** Top-of-viewport progress bar. Tracks scroll position on the document
 *  root and sets --progress on the rendered element. Intentionally tiny
 *  so it runs on every /learn route without forcing the layout itself
 *  to be a client component. */
export default function ReadingProgress() {
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const update = () => {
      const el = barRef.current;
      if (!el) return;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const scrolled = max > 0 ? (h.scrollTop / max) * 100 : 0;
      el.style.setProperty("--progress", `${scrolled}%`);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return <div ref={barRef} className="essay-progress" />;
}
