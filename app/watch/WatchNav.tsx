"use client";

import { useEffect, useRef } from "react";

export default function WatchNav({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => el.classList.toggle("scrolled", window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <nav ref={ref} className="wnav">
      {children}
    </nav>
  );
}
