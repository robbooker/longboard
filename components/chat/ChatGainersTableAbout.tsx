"use client";
import { useId, useState, type ReactNode } from "react";
import styles from "./ChatGainersTableAbout.module.css";

// #476: the Gainers Table's heading (what the table is, how to sort, where the facts come from, and a
// phone's icon key) folds into one slim "About this table" bar above the table, so the first rows sit
// higher. A click or tap (or Enter / Space) opens it; again closes it. It starts closed, and this
// device remembers whether it was last left open or closed (the same way it remembers the table's
// sort); with storage blocked it simply starts closed each time. Everywhere the table appears: its
// own page, a six view card, a quad.

/** #476: this device's open or closed heading. */
const ABOUT_STORAGE = "longboard-gainers-table-about-v1";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(ABOUT_STORAGE) === "open";
  } catch {
    return false;
  }
}

function saveOpen(open: boolean) {
  try {
    if (open) window.localStorage.setItem(ABOUT_STORAGE, "open");
    else window.localStorage.removeItem(ABOUT_STORAGE);
  } catch {
    // Private windows and blocked storage: it just isn't remembered.
  }
}

export default function GainersTableAbout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(() => (typeof window === "undefined" ? false : readOpen()));
  const panelId = useId();
  const flip = () => {
    const next = !open;
    setOpen(next);
    saveOpen(next);
  };
  return (
    <div className={styles.about} data-gainers-about={open ? "open" : "closed"}>
      <button
        type="button"
        className={styles.bar}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={flip}
        data-gainers-about-toggle
      >
        <span className={styles.arrow} aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        About this table
      </button>
      <div id={panelId} className={styles.panel} hidden={!open} data-gainers-about-panel>
        {children}
      </div>
    </div>
  );
}
