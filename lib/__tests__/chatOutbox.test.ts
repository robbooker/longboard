import { describe, expect, it } from "vitest";
import {
  OUTBOX_LIMIT,
  OUTBOX_TTL,
  addToOutbox,
  clearChatOutbox,
  flushOutbox,
  isNetworkError,
  outboxKey,
  readOutbox,
  removeFromOutbox,
  withOutboxLock,
  type OutboxItem,
} from "@/lib/chatOutbox";

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}
const NOW = Date.parse("2026-10-15T12:00:00Z");
const item = (clientId: string, over: Partial<OutboxItem> = {}): OutboxItem => ({
  kind: "room",
  target: "main",
  body: `body ${clientId}`,
  clientId,
  createdAt: new Date(NOW - 1000).toISOString(),
  memberId: "alice",
  ...over,
});

describe("chat outbox store", () => {
  it("keeps items in the order they were typed and ignores a repeated clientId", () => {
    const store = memoryStore();
    for (const id of ["a", "b", "c"]) addToOutbox(store, item(id), NOW);
    addToOutbox(store, item("a", { body: "changed" }), NOW);
    expect(readOutbox(store, "alice", NOW).map((row) => [row.clientId, row.body])).toEqual([
      ["a", "body a"],
      ["b", "body b"],
      ["c", "body c"],
    ]);
  });

  it("scopes items to the signed-in member and clears one member on sign-out", () => {
    const store = memoryStore();
    addToOutbox(store, item("a"), NOW);
    addToOutbox(store, item("b", { memberId: "bob" }), NOW);
    expect(readOutbox(store, "alice", NOW).map((row) => row.clientId)).toEqual(["a"]);
    expect(readOutbox(store, "bob", NOW).map((row) => row.clientId)).toEqual(["b"]);
    // A row copied under the wrong member's key is never shown to that member.
    store.setItem(outboxKey("carol"), JSON.stringify([item("x", { memberId: "alice" })]));
    expect(readOutbox(store, "carol", NOW)).toEqual([]);
    clearChatOutbox(store, "alice");
    expect(readOutbox(store, "alice", NOW)).toEqual([]);
    expect(readOutbox(store, "bob", NOW)).toHaveLength(1);
    clearChatOutbox(store);
    expect(store.map.size).toBe(0);
  });

  it("caps the queue (oldest give way) and drops items older than a day", () => {
    const store = memoryStore();
    for (let i = 0; i < OUTBOX_LIMIT + 5; i++) addToOutbox(store, item(`m${i}`), NOW);
    const rows = readOutbox(store, "alice", NOW);
    expect(rows).toHaveLength(OUTBOX_LIMIT);
    expect(rows[0].clientId).toBe("m5");
    expect(rows.at(-1)!.clientId).toBe(`m${OUTBOX_LIMIT + 4}`);
    expect(readOutbox(store, "alice", NOW + OUTBOX_TTL)).toEqual([]);
    expect(store.map.has(outboxKey("alice"))).toBe(false);
  });

  it("drops malformed rows and survives broken JSON", () => {
    const store = memoryStore();
    store.setItem(outboxKey("alice"), JSON.stringify([item("ok"), { clientId: "bad" }, item("ok")]));
    expect(readOutbox(store, "alice", NOW).map((row) => row.clientId)).toEqual(["ok"]);
    store.setItem(outboxKey("alice"), "{nope");
    expect(readOutbox(store, "alice", NOW)).toEqual([]);
    expect(addToOutbox(store, item("empty", { body: "" }), NOW)).toBe(false);
  });
});

describe("chat outbox flush", () => {
  it("sends one at a time in order, reusing each clientId, removing each after success", async () => {
    const store = memoryStore();
    for (const id of ["a", "b", "c"]) addToOutbox(store, item(id), NOW);
    addToOutbox(store, item("dm1", { kind: "dm", target: "conv" }), NOW);
    const calls: string[] = [];
    let inFlight = 0;
    const result = await flushOutbox({
      store,
      memberId: "alice",
      kind: "room",
      now: () => NOW,
      send: async (row) => {
        inFlight++;
        expect(inFlight).toBe(1);
        // Still stored while it is being sent: a crash here leaves it for next time.
        expect(readOutbox(store, "alice", NOW).some((r) => r.clientId === row.clientId)).toBe(true);
        calls.push(row.clientId);
        await Promise.resolve();
        inFlight--;
      },
    });
    expect(calls).toEqual(["a", "b", "c"]);
    expect(result).toEqual({ sent: ["a", "b", "c"] });
    expect(readOutbox(store, "alice", NOW).map((row) => row.clientId)).toEqual(["dm1"]);
  });

  it("stops on the first failure and leaves it and the rest queued", async () => {
    const store = memoryStore();
    for (const id of ["a", "b", "c"]) addToOutbox(store, item(id), NOW);
    const calls: string[] = [];
    const result = await flushOutbox({
      store,
      memberId: "alice",
      kind: "room",
      now: () => NOW,
      send: async (row) => {
        calls.push(row.clientId);
        if (row.clientId === "b") throw new TypeError("Failed to fetch");
      },
    });
    expect(calls).toEqual(["a", "b"]);
    expect(result.sent).toEqual(["a"]);
    expect(result.stopped?.item.clientId).toBe("b");
    expect(isNetworkError(result.stopped?.error, true)).toBe(true);
    expect(readOutbox(store, "alice", NOW).map((row) => row.clientId)).toEqual(["b", "c"]);
    // The next run sends the same items with the same clientIds.
    const retried: string[] = [];
    await flushOutbox({
      store,
      memberId: "alice",
      kind: "room",
      now: () => NOW,
      send: async (row) => void retried.push(row.clientId),
    });
    expect(retried).toEqual(["b", "c"]);
  });

  it("never sends an item twice: skips one another tab already sent, picks up one added mid-run", async () => {
    const store = memoryStore();
    for (const id of ["a", "b", "c"]) addToOutbox(store, item(id), NOW);
    const calls: string[] = [];
    await flushOutbox({
      store,
      memberId: "alice",
      kind: "room",
      now: () => NOW,
      send: async (row) => {
        calls.push(row.clientId);
        if (row.clientId === "a") {
          removeFromOutbox(store, "alice", "b"); // another tab sent "b"
          addToOutbox(store, item("d"), NOW); // typed while "a" was sending
        }
      },
    });
    expect(calls).toEqual(["a", "c", "d"]);
    expect(new Set(calls).size).toBe(calls.length);
  });

  it("does not resend an item that keeps failing within one run", async () => {
    const store = memoryStore();
    addToOutbox(store, item("a"), NOW);
    let attempts = 0;
    await flushOutbox({
      store,
      memberId: "alice",
      kind: "room",
      now: () => NOW,
      send: async () => {
        attempts++;
        throw new Error("Chat is temporarily paused.");
      },
    });
    expect(attempts).toBe(1);
  });
});

describe("chat outbox lock and errors", () => {
  it("lets only one flush run at a time with the storage lease", async () => {
    const store = memoryStore();
    let release!: () => void;
    const first = withOutboxLock("x", () => new Promise<void>((resolve) => (release = resolve)), {
      locks: null,
      store,
      now: () => NOW,
    });
    const second = await withOutboxLock("x", async () => {}, { locks: null, store, now: () => NOW });
    expect(second).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(await withOutboxLock("x", async () => {}, { locks: null, store, now: () => NOW })).toBe(true);
  });

  it("takes over a lease left by a closed tab after it expires", async () => {
    const store = memoryStore();
    store.setItem("longboard-chat-outbox-v1:lock:x", JSON.stringify({ at: NOW - 60_000, token: "old" }));
    expect(await withOutboxLock("x", async () => {}, { locks: null, store, now: () => NOW })).toBe(true);
  });

  it("uses Web Locks when available and skips when the lock is held", async () => {
    const held = new Set<string>();
    const locks = {
      request: async (
        name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: unknown) => Promise<boolean>,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          return await callback({ name });
        } finally {
          held.delete(name);
        }
      },
    };
    let ran = 0;
    let inner: boolean | undefined;
    await withOutboxLock(
      "y",
      async () => {
        ran++;
        inner = await withOutboxLock("y", async () => void ran++, { locks });
      },
      { locks },
    );
    expect(ran).toBe(1);
    expect(inner).toBe(false);
  });

  it("treats only connection failures as network errors", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"), true)).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"), true)).toBe(true);
    expect(isNetworkError(new TypeError("NetworkError when attempting to fetch resource."), true)).toBe(
      true,
    );
    expect(isNetworkError(new Error("Chat is temporarily paused."), true)).toBe(false);
    expect(isNetworkError(new TypeError("x is undefined"), true)).toBe(false);
    expect(isNetworkError(new Error("anything"), false)).toBe(true);
  });
});
