"use client";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ChatRoom } from "@/lib/publicChat";
import styles from "./ReactionNames.module.css";

export default function ReactionNames({ messageId, room, revision, children }: { messageId: string; room: ChatRoom; revision: string; children: (descriptionId: string | undefined) => ReactNode }) {
  const id = useId();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = () => { clearTimeout(hideTimer.current); setOpen(true); };
  const hide = () => { clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setOpen(false), 150); };
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("Loading names…");
  const [position, setPosition] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open || !anchor.current) return;
    const element = anchor.current;
    const rect = element.getBoundingClientRect();
    const theme = getComputedStyle(element);
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: rect.top > 170 ? rect.top - 8 : rect.bottom + 8, transform: rect.top > 170 ? "translateY(-100%)" : undefined, maxHeight: rect.top > 170 ? rect.top - 16 : window.innerHeight - rect.bottom - 16, background: theme.getPropertyValue("--chat-panel"), color: theme.getPropertyValue("--chat-text"), borderColor: theme.getPropertyValue("--chat-line") });
    const controller = new AbortController();
    setText("Loading names…");
    void fetch(`/api/chat/reactions?room=${room}&messageId=${messageId}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted) setText(data.names.length ? `${data.names.join(", ")}${data.hasMore ? ", and more…" : ""}` : "No likes yet"); })
      .catch(() => { if (!controller.signal.aborted) setText("Names unavailable. Try again."); });
    const dismiss = (event: Event) => { if (!(event.target instanceof Element && event.target.closest('[role="tooltip"]'))) setOpen(false); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => { controller.abort(); window.removeEventListener("scroll", dismiss, true); window.removeEventListener("resize", dismiss); };
  }, [open, messageId, room, revision]);
  return <span ref={anchor} className={styles.anchor} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={() => setOpen(false)} onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
    {children(open ? id : undefined)}
    {open && createPortal(<span onMouseEnter={show} onMouseLeave={hide} role="tooltip" id={id} className={styles.tooltip} style={position}>{text}</span>, document.body)}
  </span>;
}
