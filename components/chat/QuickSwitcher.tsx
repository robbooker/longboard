"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./QuickSwitcher.module.css";

export type QuickSwitchItem = {
  key: string;
  label: string;
  hint: string;
  unread?: number;
  onSelect: () => void;
};

/** Ctrl/⌘K: type a few letters of a room or person and press Enter (QUICK-SWITCH). */
export default function QuickSwitcher({ items, onClose }: { items: QuickSwitchItem[]; onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items
      .map((item) => ({ item, at: `${item.label} ${item.hint}`.toLowerCase().indexOf(q) }))
      .filter((match) => match.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((match) => match.item);
  }, [items, query]);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  function choose(item?: QuickSwitchItem) {
    if (!item) return;
    onClose();
    item.onSelect();
  }
  const current = Math.min(active, Math.max(0, matches.length - 1));
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-label="Jump to a room or conversation"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      <input
        className={styles.input}
        autoFocus
        value={query}
        placeholder="Jump to a room or person…"
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={matches.length ? `${id}-${current}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((current + step + matches.length) % Math.max(1, matches.length));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(matches[current]);
          }
        }}
      />
      <ul id={`${id}-list`} role="listbox" className={styles.list} aria-label="Rooms and conversations">
        {matches.map((item, index) => (
          <li
            key={item.key}
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(item)}
          >
            <span>{item.label}</span>
            <small>{item.hint}</small>
            {item.unread ? <b aria-label={`${item.unread} unread`}>{item.unread}</b> : null}
          </li>
        ))}
        {!matches.length && <li className={styles.none}>Nothing matches “{query}”.</li>}
      </ul>
      <p className={styles.keys}>↑↓ to choose · Enter to open · Esc to close</p>
    </dialog>
  );
}
