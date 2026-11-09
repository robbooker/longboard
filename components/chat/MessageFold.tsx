"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { mayFoldMessage } from "@/lib/chatMessageLimit";
import styles from "./MessageLength.module.css";

/**
 * #367: the message text paragraph. A long message folds after about eight lines with
 * "Show more" / "Show less"; a message of 600 characters or fewer renders the same plain <p> as
 * before. Whether the toggle shows depends on the text actually overflowing at this width.
 */
export default function MessageFold({
  body,
  className,
  children,
}: {
  body: string;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const foldable = mayFoldMessage(body);
  useEffect(() => {
    const el = ref.current;
    if (!foldable || open || !el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [foldable, open, body]);
  if (!foldable) return <p className={className}>{children}</p>;
  const folded = !open;
  return (
    <>
      <p
        ref={ref}
        id={id}
        className={folded ? `${className ?? ""} ${styles.folded}`.trim() : className}
        data-chat-folded={folded && overflows ? "true" : undefined}
      >
        {children}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={id}
          data-chat-fold-toggle
          onClick={(event) => {
            // Rows and search results open on click; this button only folds.
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
