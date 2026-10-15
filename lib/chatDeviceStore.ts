/**
 * DEVICE-STORE: recent chat kept on this device (IndexedDB) so switching to a room draws at
 * once, before the server answers, and the DM list shows straight away. The server stays the
 * truth: whatever is drawn from here is replaced by the next server read (edits, deletions and
 * removals applied, nothing duplicated).
 *
 * DMs keep only the conversation list (who, status, unread counts), never message text or the
 * last-message preview: a DM deleted on either side must not draw again from a device.
 *
 * Privacy: everything belongs to one owner (account + member). A store holding any other owner's
 * rows is wiped before anything is read, every write names its owner, and sign-out deletes the
 * database. Rooms the member can no longer read are dropped. Attachments are metadata only
 * (ids, kinds, sizes); files are never stored. Unsent sends are never stored (the outbox owns those).
 *
 * Cost: one read when the chat starts (in idle time) and batched writes in idle time; nothing
 * here runs while a room is switching. The pure planning below is unit-tested with a memory backend.
 */
import type { DirectConversation } from "./chatDirectMessages";
import type { ChatRoom, PublicChatMessage, PublicChatReaction, PublicChatRoomState } from "./publicChat";

export const DEVICE_DB = "longboard-chat-device-v1";
/** What a room shows (the server's newest page): every cached row is covered by its next read. */
export const DEVICE_ROOM_MESSAGES = 80;
export const DEVICE_TTL = 7 * 24 * 60 * 60 * 1000;
/** Characters of stored JSON across all rows (about 2 bytes each). */
export const DEVICE_MAX_SIZE = 2 * 1024 * 1024;

export type DeviceRoom = {
  roomState: PublicChatRoomState;
  messages: PublicChatMessage[];
  reactions: PublicChatReaction[];
  counts: Record<string, number>;
  featureChannel: boolean;
};
/** key: "room:<slug>" or "dms" (the conversation list, without message previews). */
export type DeviceRow = { key: string; owner: string; at: number; size: number; data: unknown };
export type DeviceContents = {
  owner: string;
  rooms: Map<ChatRoom, DeviceRoom>;
  dms: DirectConversation[] | null;
};
export type DeviceBackend = {
  readAll(): Promise<DeviceRow[]>;
  write(put: DeviceRow[], drop: string[]): Promise<void>;
  clear(): Promise<void>;
};

export const chatDeviceOwner = (accountId?: string | null, memberId?: string | null) =>
  accountId && memberId ? `${accountId}:${memberId}` : "";
export const emptyDeviceContents = (owner = ""): DeviceContents => ({
  owner,
  rooms: new Map(),
  dms: null,
});

/** A deleted row keeps its place but none of its text or files. */
function tombstone<T extends { deleted_at?: string | null; body: string; attachment_ids?: string[] }>(
  row: T,
): T {
  if (!row.deleted_at) return row;
  const { attachment_media: _media, ...rest } = row as T & { attachment_media?: unknown };
  return { ...(rest as T), body: "", attachment_ids: [] };
}

/** Server-confirmed rows only: no pending, failed, queued or moderator-removed messages. */
export function deviceRoomData(input: DeviceRoom): DeviceRoom {
  const messages = input.messages
    .filter((m) => !m.pending && !m.send_queued && !m.send_error && !m.removed && !m.id.startsWith("outbox-"))
    .slice(-DEVICE_ROOM_MESSAGES)
    .map(({ send_client_id: _a, send_error: _b, send_queued: _c, pending: _d, ...m }) => tombstone(m));
  const ids = new Set(messages.map((m) => m.id));
  return {
    roomState: input.roomState,
    messages,
    reactions: input.reactions.filter((r) => ids.has(r.message_id)).slice(-500),
    counts: Object.fromEntries(Object.entries(input.counts ?? {}).filter(([id]) => ids.has(id))),
    featureChannel: !!input.featureChannel,
  };
}

/** What a kept copy holds, to notice removals: message id → [position, deleted]. */
export type DeviceSeen = Map<string, [number, boolean]>;
export function deviceSeen(
  rows: ReadonlyArray<{ id: string; deleted_at?: string | null; created_at: string }>,
) {
  return new Map(
    rows.map((row) => [row.id, [Date.parse(row.created_at) || 0, !!row.deleted_at]]),
  ) as DeviceSeen;
}
/**
 * True when a message the kept copy holds was deleted or removed since: it is gone (but not just
 * older than everything now held, as when new messages push old ones out of the page) or now
 * marked deleted. Such a change is written at once rather than in idle time.
 */
export function deviceRemoval(
  kept: DeviceSeen,
  rows: ReadonlyArray<{ id: string; deleted_at?: string | null; created_at: string }>,
) {
  if (!kept.size) return false;
  const now = deviceSeen(rows);
  if (!now.size) return true;
  let oldest = Infinity;
  for (const [at] of now.values()) oldest = Math.min(oldest, at);
  for (const [id, [at, deleted]] of kept) {
    const row = now.get(id);
    if (row ? row[1] && !deleted : at >= oldest) return true;
  }
  return false;
}

const sizeOf = (data: unknown) => {
  try {
    return JSON.stringify(data).length;
  } catch {
    return Infinity;
  }
};

/**
 * Which stored rows stay. Any row of another owner wipes the whole store (a different member
 * signed in on this device); otherwise expired rows go, then the oldest rows until the total fits.
 */
export function planDeviceRows(rows: DeviceRow[], owner: string, now: number) {
  if (!owner || rows.some((row) => row.owner !== owner))
    return { wipe: true, keep: [] as DeviceRow[], drop: [] };
  const drop: string[] = [];
  let keep = rows.filter((row) => {
    const ok =
      typeof row.at === "number" &&
      now - row.at < DEVICE_TTL &&
      row.at <= now + 60_000 &&
      Number.isFinite(row.size) &&
      /^(room:[a-z0-9-]+|dms)$/i.test(row.key);
    if (!ok) drop.push(row.key);
    return ok;
  });
  keep.sort((a, b) => b.at - a.at);
  let total = 0;
  keep = keep.filter((row) => {
    total += row.size;
    if (total <= DEVICE_MAX_SIZE) return true;
    drop.push(row.key);
    return false;
  });
  return { wipe: false, keep, drop };
}

export function deviceContents(
  rows: DeviceRow[],
  owner: string,
  rooms?: readonly ChatRoom[],
): DeviceContents {
  const contents = emptyDeviceContents(owner);
  for (const row of rows) {
    if (row.owner !== owner) continue;
    if (row.key.startsWith("room:")) {
      const room = row.key.slice(5) as ChatRoom;
      const data = row.data as DeviceRoom;
      if (
        (!rooms || rooms.includes(room)) &&
        data?.roomState &&
        Array.isArray(data.messages) &&
        data.messages.length
      )
        contents.rooms.set(room, data);
    } else if (row.key === "dms") {
      if (Array.isArray(row.data)) contents.dms = row.data as DirectConversation[];
    }
  }
  return contents;
}

type Schedule = (task: () => void) => void;
const idle: Schedule = (task) => {
  if (typeof window !== "undefined" && "requestIdleCallback" in window)
    window.requestIdleCallback(() => task(), { timeout: 3000 });
  else setTimeout(task, 500);
};

export class ChatDeviceStore {
  private owner = "";
  private loading: Promise<DeviceContents> | null = null;
  private index = new Map<string, { at: number; size: number }>();
  private pending = new Map<string, DeviceRow | null>();
  private scheduled = false;
  private writing: Promise<void> = Promise.resolve();
  /** Set by sign-out (here or in another tab): nothing is written again by this page. */
  disabled = false;

  constructor(
    private backend: DeviceBackend,
    private now: () => number = Date.now,
    private schedule: Schedule = idle,
  ) {}

  /** This owner's stored chat. A store holding anyone else's is wiped first. Never throws. */
  load(owner: string, rooms?: readonly ChatRoom[]): Promise<DeviceContents> {
    if (this.disabled || !owner) return Promise.resolve(emptyDeviceContents(owner));
    if (owner !== this.owner || !this.loading) {
      this.owner = owner;
      this.pending.clear();
      this.index.clear();
      this.loading = (async () => {
        try {
          const rows = await this.backend.readAll();
          if (this.owner !== owner || this.disabled) return emptyDeviceContents(owner);
          const plan = planDeviceRows(rows, owner, this.now());
          if (plan.wipe) {
            if (rows.length) await this.backend.clear();
            return emptyDeviceContents(owner);
          }
          if (plan.drop.length) await this.backend.write([], plan.drop);
          for (const row of plan.keep) this.index.set(row.key, { at: row.at, size: row.size });
          return deviceContents(plan.keep, owner);
        } catch {
          return emptyDeviceContents(owner);
        }
      })();
    }
    const loaded = this.loading;
    return rooms
      ? loaded.then((c) => ({ ...c, rooms: new Map([...c.rooms].filter(([room]) => rooms.includes(room))) }))
      : loaded;
  }

  /**
   * `urgent` (a deletion, or the page hiding) writes now instead of in idle time: a room opened
   * right after a deletion must not draw the deleted message from the device again.
   */
  private queue(owner: string, key: string, data: unknown | null, urgent = false) {
    if (this.disabled || !owner || owner !== this.owner) return;
    if (data === null) this.pending.set(key, null);
    else {
      const size = sizeOf(data);
      if (size > DEVICE_MAX_SIZE) return;
      this.pending.set(key, { key, owner, at: this.now(), size, data });
    }
    if (urgent || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
      void this.flush();
      return;
    }
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      void this.flush();
    });
  }

  putRoom(owner: string, room: ChatRoom, data: DeviceRoom, urgent = false) {
    const stored = deviceRoomData(data);
    this.queue(owner, `room:${room}`, stored.messages.length ? stored : null, urgent);
  }
  /** The conversation list only: who, status and unread counts. The last-message preview is dropped. */
  putDms(owner: string, rows: DirectConversation[]) {
    this.queue(
      owner,
      "dms",
      rows.map((row) => ({ ...row, lastBody: null })),
    );
  }
  dropRoom(owner: string, room: ChatRoom) {
    this.queue(owner, `room:${room}`, null);
  }

  private keys() {
    return new Set([...this.index.keys(), ...this.pending.keys()]);
  }
  /** Rooms the member can no longer read are forgotten. */
  retainRooms(owner: string, rooms: readonly ChatRoom[]) {
    for (const key of this.keys())
      if (key.startsWith("room:") && !rooms.includes(key.slice(5) as ChatRoom)) this.queue(owner, key, null);
  }

  /** Writes everything queued in one transaction, after the owner's load (and any wipe). */
  flush(): Promise<void> {
    const owner = this.owner,
      loading = this.loading;
    this.writing = this.writing.then(async () => {
      if (!loading) return;
      await loading;
      if (this.disabled || owner !== this.owner || !this.pending.size) return;
      const batch = [...this.pending];
      this.pending.clear();
      const put: DeviceRow[] = [],
        drop: string[] = [];
      for (const [key, row] of batch) {
        if (row) {
          put.push(row);
          this.index.set(key, { at: row.at, size: row.size });
        } else {
          this.index.delete(key);
          drop.push(key);
        }
      }
      // Keep the caps after this batch: the oldest rows give way.
      const plan = planDeviceRows(
        [...this.index].map(([key, meta]) => ({ key, owner, data: null, ...meta })),
        owner,
        this.now(),
      );
      for (const key of plan.drop) {
        this.index.delete(key);
        const at = put.findIndex((row) => row.key === key);
        if (at >= 0) put.splice(at, 1);
        drop.push(key);
      }
      try {
        await this.backend.write(put, drop);
      } catch {
        /* Storage full or unavailable: the chat works the same, only slower to draw. */
      }
    });
    return this.writing;
  }

  /** Sign-out: forget everything on this device and write nothing more from this page. */
  async clear() {
    this.disabled = true;
    this.pending.clear();
    this.index.clear();
    this.owner = "";
    this.loading = null;
    await this.writing.catch(() => undefined);
    await this.backend.clear();
  }
}

/** IndexedDB backend. Another tab deleting the database (sign-out there) stops this page's store. */
export function indexedDbBackend(onClosed: () => void, factory: IDBFactory = indexedDB): DeviceBackend {
  let opened: Promise<IDBDatabase> | null = null;
  const request = <T>(req: IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DEVICE_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("rows"))
          req.result.createObjectStore("rows", { keyPath: "key" });
      };
      req.onsuccess = () => {
        const handle = req.result;
        handle.onversionchange = () => {
          handle.close();
          opened = null;
          onClosed();
        };
        resolve(handle);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    }));
  const done = (tx: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  return {
    async readAll() {
      const handle = await db();
      return request(
        handle.transaction("rows", "readonly").objectStore("rows").getAll() as IDBRequest<DeviceRow[]>,
      );
    },
    async write(put, drop) {
      if (!put.length && !drop.length) return;
      const handle = await db();
      const tx = handle.transaction("rows", "readwrite");
      const store = tx.objectStore("rows");
      for (const key of drop) store.delete(key);
      for (const row of put) store.put(row);
      await done(tx);
    },
    async clear() {
      const handle = await opened?.catch(() => null);
      handle?.close();
      opened = null;
      await deleteDeviceDatabase(factory);
    },
  };
}

function deleteDeviceDatabase(factory: IDBFactory) {
  return new Promise<void>((resolve) => {
    const req = factory.deleteDatabase(DEVICE_DB);
    // Blocked: another tab still has it open; it closes on versionchange and the delete completes.
    req.onsuccess = req.onerror = () => resolve();
    setTimeout(resolve, 1500);
  });
}

let browserStore: ChatDeviceStore | null = null;
/** This page's store, or null where IndexedDB is unavailable (old browsers, some private modes). */
export function chatDeviceStore(): ChatDeviceStore | null {
  if (browserStore) return browserStore.disabled ? null : browserStore;
  try {
    if (typeof window === "undefined" || !window.indexedDB) return null;
    const store: ChatDeviceStore = new ChatDeviceStore(
      indexedDbBackend(() => {
        store.disabled = true;
      }),
    );
    browserStore = store;
    return store;
  } catch {
    return null;
  }
}

/** Sign-out: deletes this device's stored chat (every member's). Resolves within ~1.5 s. */
export async function clearChatDeviceStore() {
  try {
    if (typeof window === "undefined" || !window.indexedDB) return;
    if (browserStore) await browserStore.clear();
    else {
      browserStore = new ChatDeviceStore(indexedDbBackend(() => undefined));
      browserStore.disabled = true;
      await deleteDeviceDatabase(window.indexedDB);
    }
  } catch {
    /* Nothing stored, or storage disabled. */
  }
}
