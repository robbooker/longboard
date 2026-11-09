"use client";
import { useEffect, useRef, useState } from "react";
import { CHAT_THEME_KEY, chatThemeCookie, gainersThemeOf, type GainersTheme } from "@/lib/chatTheme";
import styles from "./GainersPage.module.css";

const OPTIONS: Array<{ value: GainersTheme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const savedChoice = () => {
  try {
    return gainersThemeOf(window.localStorage.getItem(CHAT_THEME_KEY));
  } catch {
    return null;
  }
};

/** #343: light or dark for the gainers pages, sharing the choice chat keeps on this device. */
export default function GainersThemeToggle() {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<GainersTheme | null>(null);
  const paintPage = (theme: GainersTheme | null) => {
    const page = box.current?.closest("[data-gainers-page]");
    if (!page) return;
    if (theme) page.setAttribute("data-gainers-theme", theme);
    else page.removeAttribute("data-gainers-theme");
  };

  useEffect(() => {
    const device = matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const saved = savedChoice();
      paintPage(saved);
      setActive(saved ?? (device.matches ? "dark" : "light"));
    };
    sync();
    // Nobody has chosen: follow the device. Chosen elsewhere (chat in another tab, or back to this page): catch up.
    device.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      device.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, []);

  const choose = (theme: GainersTheme) => {
    // Already showing this one, which also keeps a saved Blade Runner when Dark is pressed.
    if (theme === active) return;
    try {
      window.localStorage.setItem(CHAT_THEME_KEY, theme);
    } catch {
      // Storage blocked: the page still changes, it just won't be remembered.
    }
    document.cookie = chatThemeCookie(theme);
    paintPage(theme);
    setActive(theme);
  };

  return (
    <div ref={box} className={styles.theme} role="group" aria-label="Page theme">
      {OPTIONS.map(({ value, label }) => (
        <button key={value} type="button" aria-pressed={active === value} onClick={() => choose(value)}>
          {label}
        </button>
      ))}
    </div>
  );
}
