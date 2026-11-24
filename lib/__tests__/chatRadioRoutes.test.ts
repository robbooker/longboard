import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { auth, admin } = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: admin }));
import { GET as listen } from "@/app/api/chat/radio/listen/route";
import { GET as playout } from "@/app/api/chat/radio/playout/[key]/route";
import { GET as audio } from "@/app/api/chat/radio/audio/[signature]/[...path]/route";
import {
  RADIO_CLIP_MAX_BYTES,
  RADIO_KEY_WINDOW_MS,
  RADIO_PLAYOUT_MEMORY_MS,
  forgetRadioPlayout,
  radioClipUrl,
  radioListenKey,
} from "@/lib/chatRadioAccess";

const NOW = Date.parse("2026-11-10T14:03:00Z");
const SHARED_CDN = "public, s-maxage=5, stale-while-revalidate=20";
const FOREVER = "public, max-age=31536000, immutable";
const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;

const member = (access: Record<string, unknown>) => ({ ok: true, user: { id: "acct-1" }, access: { longboard: false, shortscout: false, admin: false, ...access } });
const request = (path: string) => new NextRequest(`https://chat.test${path}`);

/** A stand-in database that answers each read in turn and remembers exactly what was asked. */
function fakeDb(...answers: Array<{ data: unknown; error: unknown } | Error>) {
  const reads: Array<{ table: string; columns: string; where: Record<string, unknown> }> = [];
  const db = {
    from(table: string) {
      const read = { table, columns: "", where: {} as Record<string, unknown> };
      const query = {
        select(columns: string) {
          read.columns = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          read.where[column] = value;
          return query;
        },
        abortSignal: () => query,
        async maybeSingle() {
          reads.push(read);
          const answer = answers.shift() ?? { data: null, error: null };
          if (answer instanceof Error) throw answer;
          return answer;
        },
      };
      return query;
    },
  };
  admin.mockReturnValue(db);
  return reads;
}

beforeEach(() => {
  vi.resetAllMocks();
  forgetRadioPlayout();
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
});
afterEach(() => {
  vi.useRealTimers();
  if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
});

describe("Trader Radio: who may listen (/api/chat/radio/listen)", () => {
  const call = () => listen(request("/api/chat/radio/listen"));

  it("turns a signed-out caller away", async () => {
    auth.mockResolvedValue({ ok: false, status: 401, error: "unauthorized" });
    const response = await call();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("turns away a member who cannot open the Gainers room, with no playout address", async () => {
    // No membership at all, a bot without the room, and purchases that do not include Gainers.
    for (const access of [{}, { botRooms: ["social"] }, { member: ["reader", "club-room"] }, { admin: true }]) {
      auth.mockResolvedValue(member(access));
      const response = await call();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "room_access_required" });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });
  it("gives everyone who can open the Gainers room the same playout address", async () => {
    const addresses = new Set<string>();
    // The Gainers room's own rule: chat members of either kind, Stock Club buyers, and a bot given the room.
    for (const access of [{ longboard: true }, { shortscout: true }, { shortscoutMember: true }, { member: ["gainers"] }, { botRooms: ["gainers"] }]) {
      auth.mockResolvedValue(member(access));
      const response = await call();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("CDN-Cache-Control")).toBeNull();
      const body = await response.json();
      addresses.add(body.playout);
      expect(body.refreshInMs).toBeGreaterThan(12 * 60_000);
      expect(body.expiresInMs).toBe(12 * 60_000 + RADIO_KEY_WINDOW_MS);
    }
    expect([...addresses]).toEqual([`/api/chat/radio/playout/${radioListenKey(NOW)}`]);
  });
  it("never touches the relay tables: the only database work is the sign-in check", async () => {
    auth.mockResolvedValue(member({ shortscout: true }));
    await call();
    expect(auth).toHaveBeenCalledTimes(1);
    expect(admin).not.toHaveBeenCalled();
  });
  it("says so when the server has no secret to sign with", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    auth.mockResolvedValue(member({ shortscout: true }));
    expect((await call()).status).toBe(503);
  });
});

describe("Trader Radio: what is on air (/api/chat/radio/playout/[key])", () => {
  const call = (key: string) => playout(request(`/api/chat/radio/playout/${key}`), { params: Promise.resolve({ key }) });
  const row = {
    events: [{ at: "2026-11-10T14:00:00.000Z", type: "alert", line: "P X L W.", symbol: "PXLW", sourceId: "1", audioUrl: "/api/squawkbox/relay-audio/audio-cache/line-1.mp3" }],
    generatedAt: "2026-11-10T14:02:54Z",
    updated_at: "2026-11-10T14:02:55Z",
  };

  it("refuses a made-up or run-out key without reading anything, and that answer is never shared", async () => {
    const reads = fakeDb();
    for (const key of ["nope", radioListenKey(NOW - 2 * RADIO_KEY_WINDOW_MS)!]) {
      const response = await call(key);
      expect(response.status).toBe(403);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    }
    expect(admin).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });
  it("answers a good key from one small read, in a form every listener shares", async () => {
    const reads = fakeDb({ data: row, error: null });
    const response = await call(radioListenKey(NOW)!);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("CDN-Cache-Control")).toBe(SHARED_CDN);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const body = await response.json();
    expect(body.live).toBe(true);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].audioUrl).toBe(radioClipUrl("audio-cache/line-1.mp3"));
    expect(reads).toEqual([
      { table: "squawkbox_relay_state", columns: "events:payload->events,generatedAt:payload->generatedAt,updated_at", where: { key: "playout" } },
    ]);
  });
  it("does no sign-in check of its own (that would be a database call per listener per poll)", async () => {
    fakeDb({ data: row, error: null });
    await call(radioListenKey(NOW)!);
    expect(auth).not.toHaveBeenCalled();
  });
  it("still takes last window's key, so nobody is cut off as the window turns", async () => {
    fakeDb({ data: row, error: null });
    expect((await call(radioListenKey(NOW - RADIO_KEY_WINDOW_MS)!)).status).toBe(200);
  });
  it("answers 'off air' (still shared) when the relay row is missing, errors or the read throws", async () => {
    for (const answer of [{ data: null, error: null }, { data: null, error: { message: "boom" } }, new Error("timeout")]) {
      forgetRadioPlayout();
      fakeDb(answer);
      const response = await call(radioListenKey(NOW)!);
      expect(response.status).toBe(200);
      expect(response.headers.get("CDN-Cache-Control")).toBe(SHARED_CDN);
      expect(await response.json()).toEqual({ live: false, generatedAt: null, events: [] });
    }
    forgetRadioPlayout();
    admin.mockReturnValue(null);
    expect(await (await call(radioListenKey(NOW)!)).json()).toEqual({ live: false, generatedAt: null, events: [] });
  });
});

describe("Trader Radio: the playout kept in server memory for a few seconds (#497)", () => {
  const call = (key: string) => playout(request(`/api/chat/radio/playout/${key}`), { params: Promise.resolve({ key }) });
  const row = (line: string) => ({
    events: [{ at: "2026-11-10T14:00:00.000Z", type: "alert", line, symbol: "PXLW", sourceId: line, audioUrl: "/api/squawkbox/relay-audio/audio-cache/line-1.mp3" }],
    generatedAt: "2026-11-10T14:02:54Z",
    updated_at: "2026-11-10T14:02:55Z",
  });
  const lines = async (response: Response) => ((await response.json()) as { events: Array<{ line: string }> }).events.map((e) => e.line);

  it("answers repeat requests inside the window from one read, whichever live key they carry", async () => {
    const reads = fakeDb({ data: row("first"), error: null }, { data: row("second"), error: null });
    const keys = [radioListenKey(NOW)!, radioListenKey(NOW - RADIO_KEY_WINDOW_MS)!];
    for (const [i, key] of [...keys, ...keys].entries()) {
      vi.setSystemTime(NOW + i * 1_000);
      const response = await call(key);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("CDN-Cache-Control")).toBe(SHARED_CDN);
      expect(await lines(response)).toEqual(["first"]);
    }
    expect(reads).toHaveLength(1);
    expect(admin).toHaveBeenCalledTimes(1);
  });
  it("reads again once the window has passed", async () => {
    const reads = fakeDb({ data: row("first"), error: null }, { data: row("second"), error: null });
    expect(await lines(await call(radioListenKey(NOW)!))).toEqual(["first"]);
    vi.setSystemTime(NOW + RADIO_PLAYOUT_MEMORY_MS - 1);
    expect(await lines(await call(radioListenKey(NOW)!))).toEqual(["first"]);
    vi.setSystemTime(NOW + RADIO_PLAYOUT_MEMORY_MS);
    expect(await lines(await call(radioListenKey(NOW)!))).toEqual(["second"]);
    expect(reads).toHaveLength(2);
  });
  it("keeps 'off air' from a failed read for the window too, then asks again", async () => {
    const reads = fakeDb({ data: null, error: { message: "boom" } }, { data: row("back"), error: null });
    expect((await (await call(radioListenKey(NOW)!)).json()).live).toBe(false);
    expect((await (await call(radioListenKey(NOW)!)).json()).live).toBe(false);
    expect(reads).toHaveLength(1);
    vi.setSystemTime(NOW + RADIO_PLAYOUT_MEMORY_MS);
    expect(await lines(await call(radioListenKey(NOW)!))).toEqual(["back"]);
    expect(reads).toHaveLength(2);
  });
  it("makes requests that arrive while a read is under way share that one read", async () => {
    let answer!: (value: { data: unknown; error: unknown }) => void;
    let reads = 0;
    const query = {
      select: () => query,
      eq: () => query,
      abortSignal: () => query,
      maybeSingle: () => {
        reads++;
        return new Promise((resolve) => (answer = resolve));
      },
    };
    admin.mockReturnValue({ from: () => query });
    const keys = [radioListenKey(NOW)!, radioListenKey(NOW - RADIO_KEY_WINDOW_MS)!, radioListenKey(NOW)!];
    const pending = keys.map((key) => call(key));
    await vi.waitFor(() => expect(reads).toBe(1));
    answer({ data: row("shared"), error: null });
    const responses = await Promise.all(pending);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await lines(response)).toEqual(["shared"]);
    }
    expect(reads).toBe(1);
  });
  it("still turns away a bad or run-out key while a fresh playout is remembered, with the same headers", async () => {
    fakeDb({ data: row("first"), error: null });
    expect((await call(radioListenKey(NOW)!)).status).toBe(200);
    for (const key of ["nope", radioListenKey(NOW - 2 * RADIO_KEY_WINDOW_MS)!]) {
      const response = await call(key);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "radio_key_expired" });
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    }
  });
  it("refuses a key that runs out between two requests, though the playout is still remembered", async () => {
    const reads = fakeDb({ data: row("first"), error: null });
    // A millisecond before a window turns, last window's key is still good...
    const turn = (Math.floor(NOW / RADIO_KEY_WINDOW_MS) + 1) * RADIO_KEY_WINDOW_MS;
    vi.setSystemTime(turn - 1);
    const key = radioListenKey(turn - 1 - RADIO_KEY_WINDOW_MS)!;
    expect((await call(key)).status).toBe(200);
    // ...and a millisecond after, it is two windows old and refused, while the read is still fresh.
    vi.setSystemTime(turn + 1);
    const response = await call(key);
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    expect((await call(radioListenKey(turn + 1)!)).status).toBe(200);
    expect(reads).toHaveLength(1);
  });
});

describe("Trader Radio: one clip (/api/chat/radio/audio/[signature]/[...path])", () => {
  const PATH = "audio-cache/line-1.mp3";
  const call = (url: string | null) => {
    const [signature, ...path] = (url ?? "").replace("/api/chat/radio/audio/", "").split("/");
    return audio(request(url ?? "/"), { params: Promise.resolve({ signature, path }) });
  };
  const sound = Buffer.from("not really an mp3");

  it("refuses an address that was not signed for that clip, without reading anything", async () => {
    const reads = fakeDb();
    const good = radioClipUrl(PATH)!;
    for (const url of [good.replace("line-1", "line-2"), good.replace(/audio\/[^/]+\//, "audio/forged/"), "/api/chat/radio/audio/x/smoke-probe/y.mp3"]) {
      const response = await call(url);
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    }
    expect(admin).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });
  it("serves a signed clip to be kept for good, reading the sound for that one clip only", async () => {
    const reads = fakeDb({ data: { content_type: "audio/mpeg", byte_length: sound.byteLength }, error: null }, { data: { body_base64: sound.toString("base64") }, error: null });
    const response = await call(radioClipUrl(PATH));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(FOREVER);
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Length")).toBe(String(sound.byteLength));
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(Buffer.from(await response.arrayBuffer()).equals(sound)).toBe(true);
    expect(reads).toEqual([
      { table: "squawkbox_relay_audio", columns: "content_type,byte_length", where: { path: PATH } },
      { table: "squawkbox_relay_audio", columns: "body_base64", where: { path: PATH } },
    ]);
    expect(auth).not.toHaveBeenCalled();
  });
  it("finds a clip whose name needs escaping, whether or not the framework decoded it", async () => {
    const spaced = "sounds/evening/trade well.mp3";
    for (const decodedByFramework of [true, false]) {
      const reads = fakeDb({ data: { content_type: "audio/mpeg", byte_length: 3 }, error: null }, { data: { body_base64: "AAAA" }, error: null });
      const [signature, ...parts] = radioClipUrl(spaced)!.replace("/api/chat/radio/audio/", "").split("/");
      const path = decodedByFramework ? parts.map(decodeURIComponent) : parts;
      const response = await audio(request("/"), { params: Promise.resolve({ signature, path }) });
      expect(response.status).toBe(200);
      expect(reads.map((read) => read.where.path)).toEqual([spaced, spaced]);
    }
  });
  it("answers a pruned clip as missing, remembered only briefly, and never asks for the sound", async () => {
    const reads = fakeDb({ data: null, error: null });
    const response = await call(radioClipUrl(PATH));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "clip_missing" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=60");
    expect(reads.map((read) => read.columns)).toEqual(["content_type,byte_length"]);
  });
  it("never pulls a clip too large for the CDN to keep", async () => {
    const reads = fakeDb({ data: { content_type: "audio/mpeg", byte_length: RADIO_CLIP_MAX_BYTES + 1 }, error: null });
    const response = await call(radioClipUrl(PATH));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "clip_too_large" });
    expect(response.headers.get("CDN-Cache-Control")).toBe("public, s-maxage=3600");
    expect(reads.map((read) => read.columns)).toEqual(["content_type,byte_length"]);
  });
  it("does not let a database error be cached", async () => {
    for (const answers of [[{ data: null, error: { message: "boom" } }], [{ data: { content_type: "audio/mpeg", byte_length: 3 }, error: null }, { data: null, error: { message: "boom" } }]]) {
      fakeDb(...answers);
      const response = await call(radioClipUrl(PATH));
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("CDN-Cache-Control")).toBeNull();
    }
  });
  it("only ever labels a clip as sound", async () => {
    fakeDb({ data: { content_type: "text/html", byte_length: 3 }, error: null }, { data: { body_base64: "AAAA" }, error: null });
    expect((await call(radioClipUrl(PATH))).headers.get("Content-Type")).toBe("audio/mpeg");
  });
});
