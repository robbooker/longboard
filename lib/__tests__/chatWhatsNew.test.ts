// #302 What's New: the automatic note route and the PR collection script.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), known: [] as number[], readError: null as null | { message: string } }));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({
    rpc: mock.rpc,
    from: (table: string) => ({
      select: () => ({
        in: async (column: string, values: number[]) => {
          expect(table).toBe("chat_whats_new_changes");
          expect(column).toBe("pr_number");
          return mock.readError
            ? { data: null, error: mock.readError }
            : { data: mock.known.filter((pr) => values.includes(pr)).map((pr_number) => ({ pr_number })), error: null };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: vi.fn() }));
import { POST } from "@/app/api/chat/whats-new/route";
import { composeWhatsNewNote, parseWhatsNewRequest, WHATS_NEW_MAX_BODY } from "@/lib/chatWhatsNew";
import { collectChanges, postChanges, whatsNewNote } from "../../scripts/whats-new/post-whats-new.mjs";

const token = "t".repeat(48);
const sha = "a".repeat(40);
const request = (payload: unknown, auth = `Bearer ${token}`) =>
  new NextRequest("http://localhost/api/chat/whats-new", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
const change = (pr: number, note: string, mergedAt = `2026-10-2${pr % 10}T12:00:00Z`) => ({ pr, note, mergedAt });

beforeEach(() => {
  vi.stubEnv("WHATS_NEW_TOKEN", token);
  mock.known = [];
  mock.readError = null;
  mock.rpc.mockReset().mockImplementation(async (_name: string, args: { p_changes: { pr: number }[] }) => {
    mock.known.push(...args.p_changes.map((c) => c.pr));
    return { data: { messageId: "note-1", posted: true }, error: null };
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("What's New route", () => {
  it("rejects a missing, wrong or non-Bearer token before reading anything", async () => {
    for (const auth of ["", "Bearer wrong", `Basic ${token}`, `Bearer ${token}x`])
      expect((await POST(request({ deployment: sha, changes: [change(1, "x")] }, auth))).status).toBe(401);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("is off until a long enough secret is configured", async () => {
    vi.stubEnv("WHATS_NEW_TOKEN", "short");
    expect((await POST(request({ deployment: sha, changes: [change(1, "x")] }, "Bearer short"))).status).toBe(503);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { deployment: "abc", changes: [change(1, "x")] },
    { deployment: sha, changes: [] },
    { deployment: sha, changes: [{ pr: 0, note: "x" }] },
    { deployment: sha, changes: [{ pr: 1.5, note: "x" }] },
    { deployment: sha, changes: [{ pr: 1, note: "   " }] },
    { deployment: sha, changes: [{ pr: 1, note: "x", room: "main" }] },
    { deployment: sha, changes: [change(1, "x")], author: "Admin" },
  ])("rejects malformed input %j", async (payload) => {
    expect((await POST(request(payload))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("posts one note as the fixed bot, and a rerun of the same deploy posts nothing", async () => {
    const payload = { deployment: sha, changes: [change(7, "You can now react with a palm tree.")] };
    const first = await (await POST(request(payload))).json();
    expect(first).toMatchObject({ posted: true, announced: [7], body: "You can now react with a palm tree." });
    expect(mock.rpc).toHaveBeenCalledWith("post_chat_whats_new_note", {
      p_deployment: sha,
      p_body: "You can now react with a palm tree.",
      p_changes: [{ pr: 7, note: "You can now react with a palm tree.", mergedAt: "2026-10-27T12:00:00.000Z" }],
    });
    const again = await (await POST(request(payload))).json();
    expect(again).toEqual({ posted: false, announced: [], alreadyAnnounced: [7] });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it("combines several changes into one note and leaves out ones already announced", async () => {
    mock.known = [3];
    const r = await (
      await POST(request({ deployment: sha, changes: [change(4, "Second."), change(3, "Old."), change(2, "First.")] }))
    ).json();
    expect(r.announced).toEqual([4, 2]);
    expect(r.body).toBe("New on Longboard:\n• First.\n• Second.");
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it("retries with only the new ones when another run announced some meanwhile", async () => {
    mock.rpc.mockReset();
    mock.rpc
      .mockImplementationOnce(async () => {
        mock.known.push(5);
        return { data: null, error: { message: "whats_new_already_posted" } };
      })
      .mockImplementationOnce(async () => ({ data: { messageId: "note-2" }, error: null }));
    const r = await (await POST(request({ deployment: sha, changes: [change(5, "A."), change(6, "B.")] }))).json();
    expect(r).toMatchObject({ posted: true, announced: [6], body: "B." });
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });
  it("hides database details and reports a paused room", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "longboard_chat_paused" } });
    expect((await POST(request({ deployment: sha, changes: [change(8, "A.")] }))).status).toBe(423);
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "private details" } });
    const r = await POST(request({ deployment: sha, changes: [change(8, "A.")] }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "whats_new_unavailable" });
  });
});

describe("composeWhatsNewNote", () => {
  it("stays within one message and says how many more there were", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ pr: i + 1, note: `Change number ${i + 1} ${"x".repeat(60)}.`, mergedAt: null }));
    const body = composeWhatsNewNote(many);
    expect(Array.from(body).length).toBeLessThanOrEqual(WHATS_NEW_MAX_BODY);
    expect(body).toMatch(/…and \d+ more small improvements\.$/);
    expect(body.split("\n").length).toBeGreaterThan(3);
  });
  it("shortens one very long note", () => {
    const parsed = parseWhatsNewRequest({ deployment: sha, changes: [{ pr: 1, note: "word ".repeat(300) }] })!;
    expect(Array.from(composeWhatsNewNote(parsed.changes)).length).toBeLessThanOrEqual(280);
  });
});

describe("PR collection script", () => {
  it("reads the What's New line in its common forms and skips behind-the-scenes PRs", () => {
    expect(whatsNewNote("Summary\n\nWhat's New: Replies now stay in one list.\n\nmore")).toBe("Replies now stay in one list.");
    expect(whatsNewNote("**What’s New:** You can **pin** a room.")).toBe("You can pin a room.");
    expect(whatsNewNote("- whats new: [Search](https://x) is faster.")).toBe("Search is faster.");
    expect(whatsNewNote("## Notes\nWhat's New:\nTwo lines\nof text.\n\nOther")).toBe("Two lines of text.");
    expect(whatsNewNote("What's New: none")).toBeNull();
    expect(whatsNewNote("What's New: n/a")).toBeNull();
    expect(whatsNewNote("Refactor only, no user change.")).toBeNull();
    expect(whatsNewNote("```\nWhat's New: inside a code block\n```")).toBeNull();
    expect(whatsNewNote(null)).toBeNull();
  });
  it("collects only deployed, recent PRs: skips behind-the-scenes, combines several", async () => {
    const now = Date.parse("2026-10-23T20:00:00Z");
    const pulls = [
      { number: 10, merged_at: "2026-10-23T19:00:00Z", updated_at: "2026-10-23T19:00:00Z", merge_commit_sha: "m10", body: "What's New: Second visible change." },
      { number: 9, merged_at: "2026-10-23T18:00:00Z", updated_at: "2026-10-23T18:00:00Z", merge_commit_sha: "m9", body: "Tests only." },
      { number: 8, merged_at: "2026-10-23T17:00:00Z", updated_at: "2026-10-23T17:00:00Z", merge_commit_sha: "m8", body: "What's New: First visible change." },
      { number: 7, merged_at: null, updated_at: "2026-10-23T16:00:00Z", merge_commit_sha: "m7", body: "What's New: Closed, never merged." },
      { number: 6, merged_at: "2026-10-23T19:30:00Z", updated_at: "2026-10-23T19:30:00Z", merge_commit_sha: "not-deployed", body: "What's New: Merged after this deploy." },
      { number: 5, merged_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-23T10:00:00Z", merge_commit_sha: "m5", body: "What's New: Too old." },
    ];
    const github = vi.fn(async (path: string) =>
      path.startsWith("commits") ? ["m10", "m9", "m8", "m5", "x"].map((s) => ({ sha: s })) : pulls,
    );
    const { changes, skipped } = await collectChanges({ github, sha, now });
    expect(changes).toEqual([
      { pr: 8, note: "First visible change.", mergedAt: "2026-10-23T17:00:00Z" },
      { pr: 10, note: "Second visible change.", mergedAt: "2026-10-23T19:00:00Z" },
    ]);
    expect(skipped).toEqual([9]);
    expect(github.mock.calls[0][0]).toBe(`commits?sha=${sha}&per_page=100&page=1`);
    await expect(collectChanges({ github, sha: "main", now })).rejects.toThrow(/full commit SHA/);
  });
  it("sends the token and reports a rejected post", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    await expect(postChanges({ url: "https://example.test/api", token: "secret", sha, changes: [], fetchImpl })).rejects.toThrow(/401.*unauthorized/);
    expect(fetchImpl).toHaveBeenCalledWith("https://example.test/api", expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer secret" }) }));
  });
});
