"use client";

import { useEffect } from "react";

/** Sets data-theme on <html> element. Used by route pages to activate their theme. */
export default function ThemeSetter({ theme }: { theme: "terminal" | "longboard" }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [theme]);

  return null;
}
