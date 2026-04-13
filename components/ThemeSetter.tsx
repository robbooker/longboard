"use client";

import { useEffect } from "react";

/** Sets data-theme on <html> element. Used by route pages to activate their theme.
 *  On unmount, restores the user's persisted light/dark preference so dashboards
 *  regain their theme when navigating back. */
export default function ThemeSetter({ theme }: { theme: "terminal" | "longboard" }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    return () => {
      const stored = localStorage.getItem("longboard-theme");
      const restore = stored === "dark" || stored === "light" ? stored : "light";
      document.documentElement.setAttribute("data-theme", restore);
    };
  }, [theme]);

  return null;
}
