"use client";
import {
  SIDEBAR_FOLD_PREFIX,
  parseSidebarFolds,
  sidebarFoldKey,
  toggleSidebarFold,
  type SidebarFoldGroup,
} from "@/lib/chatSidebarFold";
import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react";
import styles from "./SidebarFold.module.css";

// D-324: one small device store for the sidebar's folded groups. The room list, the Pinned section
// and the DM list each read it, so a fold in one place shows everywhere at once (and in other tabs
// through the storage event). The server and the first client render see nothing folded; React then
// re-renders with the saved folds, so there is no hydration mismatch.
const listeners = new Set<() => void>();
// Kept in memory as well, so a fold still works for this visit when storage is blocked.
const memory = new Map<string, string>();

function read(key: string) {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) return value;
  } catch {
    /* Storage can be disabled; the in-memory copy stands in. */
  }
  return memory.get(key) ?? "";
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Not saved on this device; it still holds until the page reloads. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(SIDEBAR_FOLD_PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const serverSnapshot = () => "";

/** This person's folded groups on this device, and a setter. */
export function useSidebarFolds(memberId: string | null | undefined) {
  const key = sidebarFoldKey(memberId);
  const raw = useSyncExternalStore(subscribe, () => read(key), serverSnapshot);
  const folded = useMemo(() => new Set(parseSidebarFolds(raw)), [raw]);
  const setFolded = useCallback(
    (group: SidebarFoldGroup, value: boolean) => write(key, toggleSidebarFold(read(key), group, value)),
    [key],
  );
  return { folded, setFolded };
}

/**
 * A sidebar group heading that folds its group: a button with aria-expanded and a +/− mark.
 * Folded, it also shows the group's unread total and an @ mark for an unread mention inside.
 * The mark is drawn (no text), so the heading's text stays just its name.
 */
export function FoldHeading({
  group,
  label,
  folded,
  onToggle,
  unread = 0,
  mention = false,
  controls,
  children,
}: {
  group: SidebarFoldGroup;
  label: string;
  folded: boolean;
  onToggle: (folded: boolean) => void;
  unread?: number;
  mention?: boolean;
  /** The id of the element holding the group's rows, when there is a single one. */
  controls?: string;
  /** Anything that always shows beside the name (the DM heading's own total). */
  children?: ReactNode;
}) {
  const showTotals = folded && (unread > 0 || mention);
  return (
    <button
      type="button"
      className={styles.fold}
      data-sidebar-fold={group}
      aria-expanded={!folded}
      aria-controls={controls}
      onClick={() => onToggle(!folded)}
    >
      <span className={styles.name}>{label}</span>
      {children}
      {showTotals && mention && (
        <span className={styles.mention} data-fold-mention="true" title="Unread mention">
          @<span className={styles.srOnly}> unread mention</span>
        </span>
      )}
      {showTotals && unread > 0 && (
        <span className={styles.total} data-fold-unread={unread}>
          {unread > 99 ? "99+" : unread}
          <span className={styles.srOnly}> unread</span>
        </span>
      )}
      <svg
        className={styles.mark}
        width="12"
        height="12"
        viewBox="0 0 12 12"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={folded ? "M2 6h8M6 2v8" : "M2 6h8"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
