import { describe, expect, it } from "vitest";
import {
  ChatDeviceStore,
  DEVICE_DM_CONVERSATIONS,
  DEVICE_DM_MESSAGES,
  DEVICE_MAX_SIZE,
  DEVICE_ROOM_MESSAGES,
  DEVICE_TTL,
  chatDeviceOwner,
  deviceRoomData,
  planDeviceRows,
  type DeviceBackend,
  type DeviceRoom,
  type DeviceRow,
} from "../chatDeviceStore";
import { reconcileRoomMessages } from "../chatMessageIdentity";
import type { DirectMessage } from "../chatDirectMessages";
import type { PublicChatMessage } from "../publicChat";

function memory() {
  const rows = new Map<string, DeviceRow>();
  const calls = { clear: 0, writes: 0 };
  const backend: DeviceBackend = {
    readAll: async () => [...rows.values()].map((row) => structuredClone(row)),
    write: async (put, drop) => {
      calls.writes++;
      for (const key of drop) rows.delete(key);
      for (const row of put) rows.set(row.key, structuredClone(row));
    },
    clear: async () => {
      calls.clear++;
      rows.clear();
    },
  };
  return { rows, calls, backend };
}
/** Runs scheduled flushes only when the test asks (stands in for idle time). */
function manual() {
  const tasks: Array<() => void> = [];
  return { schedule: (task: () => void) => void tasks.push(task), run: () => tasks.splice(0).forEach((t) => t()) };
}
const message = (i: number, extra: Partial<PublicChatMessage> = {}): PublicChatMessage => ({
  id: `m${i}`,
  guest_id: "g",
  member_id: "bob",
  author_label: "Bob",
  body: `message ${i}`,
  created_at: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  unread_seq: i,
  ...extra,
});
const room = (messages: PublicChatMessage[]): DeviceRoom => ({
  roomState: { isOpen: true, pausedAt: null, notice: null, updatedAt: "2026-10-01T00:00:00Z" },
  messages,
  reactions: messages.map((m) => ({
    message_id: m.id,
    guest_id: "g",
    active: true,
    created_at: m.created_at,
    updated_at: m.created_at,
  })),
  counts: Object.fromEntries(messages.map((m) => [m.id, 1])),
  featureChannel: false,
});
const A = chatDeviceOwner("acct-a", "member-a"),
  B = chatDeviceOwner("acct-b", "member-b");
async function settle(store: ChatDeviceStore, tick: ReturnType<typeof manual>) {
  tick.run();
  await store.flush();
}

describe("chat device store", () => {
  it("needs both an account and a member to keep anything", () => {
    expect(chatDeviceOwner("acct", "")).toBe("");
    expect(chatDeviceOwner(undefined, "m")).toBe("");
    expect(A).toBe("acct-a:member-a");
  });

  it("keeps rooms, the DM list and DMs per member and returns them on the next start", async () => {
    const { backend } = memory(),
      tick = manual();
    const store = new ChatDeviceStore(backend, Date.now, tick.schedule);
    await store.load(A);
    store.putRoom(A, "main", room([message(1), message(2)]));
    store.putDms(A, [{ id: "c1" } as never]);
    store.putDm(A, "c1", [{ id: "d1", seq: 1, sender_id: "x", body: "hi", created_at: "" }], false);
    await settle(store, tick);
    const next = await new ChatDeviceStore(backend).load(A);
    expect(next.rooms.get("main")?.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(next.dms?.map((c) => c.id)).toEqual(["c1"]);
    expect(next.dm.get("c1")?.messages[0].body).toBe("hi");
  });

  it("never shows one member's chat to another: a different owner wipes the store first", async () => {
    const { backend, rows, calls } = memory(),
      tick = manual();
    const a = new ChatDeviceStore(backend, Date.now, tick.schedule);
    await a.load(A);
    a.putRoom(A, "main", room([message(1)]));
    await settle(a, tick);
    expect(rows.size).toBe(1);
    const seen = await new ChatDeviceStore(backend).load(B);
    expect(seen.rooms.size).toBe(0);
    expect(seen.dms).toBeNull();
    expect(calls.clear).toBe(1);
    expect(rows.size).toBe(0);
    // And A's next start finds nothing either.
    expect((await new ChatDeviceStore(backend).load(A)).rooms.size).toBe(0);
  });

  it("ignores writes for another owner than the one loaded, and before any load", async () => {
    const { backend, rows } = memory(),
      tick = manual();
    const store = new ChatDeviceStore(backend, Date.now, tick.schedule);
    store.putRoom(A, "main", room([message(1)]));
    await store.load(A);
    store.putRoom(B, "social", room([message(2)]));
    store.putRoom("", "social", room([message(2)]));
    await settle(store, tick);
    expect(rows.size).toBe(0);
  });

  it("sign-out clears everything and nothing is written afterwards (even queued writes)", async () => {
    const { backend, rows } = memory(),
      tick = manual();
    const store = new ChatDeviceStore(backend, Date.now, tick.schedule);
    await store.load(A);
    store.putRoom(A, "main", room([message(1)]));
    await settle(store, tick);
    store.putRoom(A, "social", room([message(2)]));
    await store.clear();
    tick.run();
    await store.flush();
    store.putRoom(A, "main", room([message(3)]));
    await settle(store, tick);
    expect(rows.size).toBe(0);
    expect((await store.load(A)).rooms.size).toBe(0);
  });

  it("stores server-confirmed rows only, deleted rows without text or files, at most a room's page", () => {
    const rows = [
      ...Array.from({ length: DEVICE_ROOM_MESSAGES + 10 }, (_, i) => message(i)),
      message(500, { pending: true, send_client_id: "c" }),
      message(501, { send_queued: true }),
      message(502, { removed: true, body: "hidden by a moderator" }),
      message(503, {
        deleted_at: "2026-10-01T00:00:00Z",
        body: "secret",
        attachment_ids: ["f"],
        attachment_media: { f: { kind: "image" } } as never,
      }),
      { ...message(504), id: "outbox-x" },
    ];
    const stored = deviceRoomData(room(rows));
    expect(stored.messages).toHaveLength(DEVICE_ROOM_MESSAGES);
    expect(stored.messages.some((m) => m.pending || m.send_queued || m.removed || m.id.startsWith("outbox-"))).toBe(
      false,
    );
    const deleted = stored.messages.at(-1)!;
    expect(deleted.id).toBe("m503");
    expect(deleted.body).toBe("");
    expect(deleted.attachment_ids).toEqual([]);
    expect("attachment_media" in deleted).toBe(false);
    // Reactions and reply counts only for messages kept.
    const ids = new Set(stored.messages.map((m) => m.id));
    expect(stored.reactions.every((r) => ids.has(r.message_id))).toBe(true);
    expect(Object.keys(stored.counts).every((id) => ids.has(id))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("secret");
    expect(JSON.stringify(stored)).not.toContain("moderator");
  });

  it("server truth replaces the kept copy: edits and deletions apply, nothing is duplicated", () => {
    const kept = deviceRoomData(room([message(1), message(2), message(3)])).messages;
    const server = [
      message(2, { body: "edited", revision: 1, edited_at: "2026-10-02T00:00:00Z" }),
      message(3),
      message(4),
    ];
    const next = reconcileRoomMessages(kept, server);
    expect(next.map((m) => m.id)).toEqual(["m2", "m3", "m4"]);
    expect(next[0].body).toBe("edited");
    // An unchanged row keeps its identity (no re-render).
    expect(next[1]).toBe(kept[2]);
  });

  it("caps DMs per conversation and the number of conversations", async () => {
    const { backend } = memory(),
      tick = manual();
    let now = 1_000_000;
    const store = new ChatDeviceStore(backend, () => now, tick.schedule);
    await store.load(A);
    const dms: DirectMessage[] = Array.from({ length: DEVICE_DM_MESSAGES + 50 }, (_, i) => ({
      id: `d${i}`,
      seq: i,
      sender_id: "x",
      body: `dm ${i}`,
      created_at: "",
    }));
    for (let i = 0; i < DEVICE_DM_CONVERSATIONS + 5; i++) {
      now++;
      store.putDm(A, `c${i}`, dms, false);
      await settle(store, tick);
    }
    const loaded = await new ChatDeviceStore(backend, () => now).load(A);
    expect(loaded.dm.size).toBe(DEVICE_DM_CONVERSATIONS);
    expect(loaded.dm.has("c0")).toBe(false);
    expect(loaded.dm.get("c24")?.messages).toHaveLength(DEVICE_DM_MESSAGES);
    expect(loaded.dm.get("c24")?.hasMore).toBe(true);
    expect(loaded.dm.get("c24")?.messages[0].id).toBe("d50");
  });

  it("expires old rows and keeps the total size under the cap, oldest first", () => {
    const now = 10 * DEVICE_TTL;
    const row = (key: string, at: number, size = 10): DeviceRow => ({ key, owner: A, at, size, data: null });
    const expired = planDeviceRows([row("room:main", now - DEVICE_TTL), row("room:social", now - 1)], A, now);
    expect(expired.drop).toEqual(["room:main"]);
    expect(expired.keep.map((r) => r.key)).toEqual(["room:social"]);
    const big = planDeviceRows(
      [
        row("room:main", now - 3, DEVICE_MAX_SIZE / 2),
        row("room:social", now - 2, DEVICE_MAX_SIZE / 2),
        row("dms", now - 1, DEVICE_MAX_SIZE / 2),
      ],
      A,
      now,
    );
    expect(big.drop).toEqual(["room:main"]);
    // Rows that don't look like ours are dropped too.
    expect(planDeviceRows([row("weird key", now)], A, now).drop).toEqual(["weird key"]);
  });

  it("drops rooms the member can no longer read, on load and when the room list changes", async () => {
    const { backend, rows } = memory(),
      tick = manual();
    const store = new ChatDeviceStore(backend, Date.now, tick.schedule);
    await store.load(A);
    store.putRoom(A, "main", room([message(1)]));
    store.putRoom(A, "shortscout", room([message(2)]));
    await settle(store, tick);
    const visible = await new ChatDeviceStore(backend).load(A, ["main"]);
    expect([...visible.rooms.keys()]).toEqual(["main"]);
    store.retainRooms(A, ["main"]);
    await settle(store, tick);
    expect([...rows.keys()]).toEqual(["room:main"]);
    // A room whose messages are now empty (access lost) is forgotten as well.
    store.putRoom(A, "main", room([]));
    await settle(store, tick);
    expect(rows.size).toBe(0);
  });

  it("batches writes: many saves before idle time are one write", async () => {
    const { backend, calls } = memory(),
      tick = manual();
    const store = new ChatDeviceStore(backend, Date.now, tick.schedule);
    await store.load(A);
    for (let i = 0; i < 10; i++) store.putRoom(A, "main", room([message(i)]));
    store.putRoom(A, "social", room([message(1)]));
    expect(calls.writes).toBe(0);
    await settle(store, tick);
    expect(calls.writes).toBe(1);
  });

  it("works without storage: a failing backend reads as empty and writes are dropped", async () => {
    const store = new ChatDeviceStore({
      readAll: () => Promise.reject(new Error("denied")),
      write: () => Promise.reject(new Error("full")),
      clear: () => Promise.resolve(),
    });
    const loaded = await store.load(A);
    expect(loaded.rooms.size).toBe(0);
    store.putRoom(A, "main", room([message(1)]));
    await expect(store.flush()).resolves.toBeUndefined();
  });
});
