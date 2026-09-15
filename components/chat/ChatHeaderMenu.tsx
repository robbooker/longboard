"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./PublicChat.module.css";

// A disclosure of ordinary buttons/links: native Tab navigation, no menu-role trap.
export default function ChatHeaderMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button, a")?.focus();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className={styles.headerMenu} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }} onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className={styles.menuTrigger} aria-label="Chat settings" title="Chat settings" aria-expanded={open} aria-controls="chat-settings-panel" onClick={() => setOpen(!open)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
    </button>
    {open ? <div ref={panel} id="chat-settings-panel" className={styles.headerMenuPanel} aria-label="Chat settings">{children(close)}</div> : null}
  </div>;
}
