/**
 * Offline outbox: text messages typed with no connection wait on this device and are sent, in
 * order, when the signal returns. Each item keeps the clientId it was given when typed, so every
 * attempt is the same idempotent send on the server and nothing can post twice.
 *
 * Stored in localStorage under one key per signed-in member; cleared on sign-out.
 */
export type OutboxKind = "room" | "dm";
export type OutboxItem = {
  kind: OutboxKind;
  /** Room slug, or DM conversation id. */
  target: string;
  body: string;
  clientId: string;
  createdAt: string;
  memberId: string;
};
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

export const OUTBOX_PREFIX = "longboard-chat-outbox-v1:";
export const OUTBOX_LIMIT = 50;
export const OUTBOX_TTL = 24 * 60 * 60 * 1000;
const BODY_LIMIT = 8000;

export const outboxKey = (memberId: string) => `${OUTBOX_PREFIX}${encodeURIComponent(memberId)}`;

function valid(row: unknown, memberId: string, now: number): row is OutboxItem {
  if (!row || typeof row !== "object") return false;
  const item = row as Partial<OutboxItem>;
  const at = typeof item.createdAt === "string" ? Date.parse(item.createdAt) : NaN;
  return (
    (item.kind === "room" || item.kind === "dm") &&
    typeof item.target === "string" &&
    !!item.target &&
    typeof item.body === "string" &&
    !!item.body &&
    item.body.length <= BODY_LIMIT &&
    typeof item.clientId === "string" &&
    !!item.clientId &&
    item.memberId === memberId &&
    Number.isFinite(at) &&
    now - at < OUTBOX_TTL
  );
}

function write(store: Store, memberId: string, items: OutboxItem[]) {
  try {
    if (items.length) store.setItem(outboxKey(memberId), JSON.stringify(items));
    else store.removeItem(outboxKey(memberId));
    return true;
  } catch {
    return false;
  }
}

/** This member's queued items, oldest first. Expired, malformed and duplicate rows are dropped. */
export function readOutbox(store: Store, memberId: string, now = Date.now()): OutboxItem[] {
  if (!memberId) return [];
  let raw: string | null = null;
  try {
    raw = store.getItem(outboxKey(memberId));
  } catch {
    return [];
  }
  if (!raw) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    write(store, memberId, []);
    return [];
  }
  const seen = new Set<string>();
  const items = (Array.isArray(rows) ? rows : []).filter((row): row is OutboxItem => {
    if (!valid(row, memberId, now) || seen.has(row.clientId)) return false;
    seen.add(row.clientId);
    return true;
  });
  const kept = items.slice(-OUTBOX_LIMIT);
  if (!Array.isArray(rows) || kept.length !== rows.length) write(store, memberId, kept);
  return kept;
}

/** Queues an item at the end. A clientId already queued is left where it is. */
export function addToOutbox(store: Store, item: OutboxItem, now = Date.now()): boolean {
  if (!valid(item, item.memberId, now)) return false;
  const items = readOutbox(store, item.memberId, now);
  if (items.some((row) => row.clientId === item.clientId)) return true;
  // Over the cap the oldest item gives way, so the newest typing is never the one lost.
  return write(store, item.memberId, [...items, item].slice(-OUTBOX_LIMIT));
}

export function removeFromOutbox(store: Store, memberId: string, clientId: string, now = Date.now()) {
  const items = readOutbox(store, memberId, now);
  const kept = items.filter((row) => row.clientId !== clientId);
  if (kept.length !== items.length) write(store, memberId, kept);
}

/** Sign-out: forgets one member's outbox, or every member's when none is given. */
export function clearChatOutbox(store: Store, memberId?: string) {
  try {
    if (memberId) {
      store.removeItem(outboxKey(memberId));
      return;
    }
    for (let i = store.length - 1; i >= 0; i--) {
      const key = store.key(i);
      if (key?.startsWith(OUTBOX_PREFIX)) store.removeItem(key);
    }
  } catch {
    /* Storage can be disabled. */
  }
}

export type FlushResult = {
  sent: string[];
  /** The item that stopped the run, and why. Later items are left queued. */
  stopped?: { item: OutboxItem; error: unknown };
};

/**
 * Sends one kind of queued item one at a time, oldest first. Each is removed only after it is
 * sent; the first failure stops the run and leaves it and everything after it queued. The store
 * is re-read before every send, so an item another tab already sent (and removed) is skipped and
 * an item queued mid-run is still sent in order.
 */
export async function flushOutbox({
  store,
  memberId,
  kind,
  send,
  now = () => Date.now(),
}: {
  store: Store;
  memberId: string;
  kind: OutboxKind;
  send: (item: OutboxItem) => Promise<void>;
  now?: () => number;
}): Promise<FlushResult> {
  const sent: string[] = [];
  const attempted = new Set<string>();
  for (;;) {
    const next = readOutbox(store, memberId, now()).find(
      (row) => row.kind === kind && !attempted.has(row.clientId),
    );
    if (!next) return { sent };
    attempted.add(next.clientId);
    try {
      await send(next);
    } catch (error) {
      return { sent, stopped: { item: next, error } };
    }
    removeFromOutbox(store, memberId, next.clientId, now());
    sent.push(next.clientId);
  }
}

type LockManager = {
  request: (
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<boolean>,
  ) => Promise<boolean>;
};
const LOCK_TTL = 30_000;

/**
 * Runs `task` only if no other tab (or call in this tab) holds the flush lock for `name`.
 * Uses the Web Locks API where available; otherwise a short-lived localStorage lease.
 * Returns false when the lock was busy and `task` did not run.
 */
export async function withOutboxLock(
  name: string,
  task: () => Promise<void>,
  env: { locks?: LockManager | null; store?: Store | null; now?: () => number } = {},
): Promise<boolean> {
  const locks =
    env.locks !== undefined
      ? env.locks
      : typeof navigator !== "undefined"
        ? ((navigator as unknown as { locks?: LockManager }).locks ?? null)
        : null;
  if (locks)
    return locks.request(name, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      await task();
      return true;
    });
  const store =
    env.store !== undefined ? env.store : typeof localStorage !== "undefined" ? localStorage : null;
  const now = env.now ?? Date.now;
  if (!store) {
    await task();
    return true;
  }
  const key = `${OUTBOX_PREFIX}lock:${name}`;
  const token = `${now()}:${Math.random()}`;
  try {
    const held = JSON.parse(store.getItem(key) || "null") as { at?: number } | null;
    if (held && typeof held.at === "number" && now() - held.at < LOCK_TTL) return false;
    store.setItem(key, JSON.stringify({ at: now(), token }));
    if (JSON.parse(store.getItem(key) || "null")?.token !== token) return false;
  } catch {
    /* Storage disabled: nothing else can share it either. */
  }
  try {
    await task();
    return true;
  } finally {
    try {
      if (JSON.parse(store.getItem(key) || "null")?.token === token) store.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

/** A send that never reached the server (no connection), as opposed to an HTTP error reply. */
export function isNetworkError(
  error: unknown,
  online = typeof navigator === "undefined" || navigator.onLine,
) {
  // fetch() rejects with a TypeError: "Failed to fetch" (Chrome), "Load failed" (Safari),
  // "NetworkError when attempting to fetch resource." (Firefox).
  return !online || (error instanceof TypeError && /fetch|network|load failed/i.test(error.message));
}

export function browserOutboxStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
