// #443 What's New pictures: parsing, limits, where pictures go, the upload route, the follow-up
// route and the scripts' folder convention. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  changes: [] as { pr_number: number; note: string; pictures_posted_at: string | null }[],
  inserted: [] as Record<string, unknown>[],
  uploads: [] as string[],
  removed: [] as string[],
}));
vi.mock("@/lib/chatAdmin", () => ({
  createChatAdminClient: () => ({
    rpc: mock.rpc,
    storage: {
      from: () => ({
        upload: async (path: string) => (mock.uploads.push(path), { data: { path }, error: null }),
        remove: async (paths: string[]) => (mock.removed.push(...paths), { data: [], error: null }),
      }),
    },
    from: (table: string) => ({
      select: () => ({
        in: async (_column: string, values: number[]) => ({
          data: mock.changes.filter((c) => values.includes(c.pr_number)),
          error: null,
        }),
        eq: async (_column: string, value: number) => {
          expect(table).toBe("chat_whats_new_changes");
          return { data: mock.changes.filter((c) => c.pr_number === value), error: null };
        },
      }),
      insert: (row: Record<string, unknown>) => {
        expect(table).toBe("chat_attachments");
        mock.inserted.push(row);
        return { select: () => ({ maybeSingle: async () => ({ data: { id: row.id }, error: null }) }) };
      },
    }),
  }),
}));
vi.mock("@/lib/chatAttachmentPreview", () => ({ ensureAttachmentPreview: vi.fn(async () => "previews/x.webp") }));
vi.mock("@/lib/chatRealtimePublish", () => ({ publishRoomEventAfterResponse: vi.fn() }));

import { POST as postNote } from "@/app/api/chat/whats-new/route";
import { POST as postPicture } from "@/app/api/chat/whats-new/pictures/route";
import {
  parseWhatsNewFollowUp,
  parseWhatsNewRequest,
  planWhatsNewFollowUp,
  planWhatsNewPictures,
  WHATS_NEW_PICTURE_MAX_BYTES,
  whatsNewPictureFilename,
} from "@/lib/chatWhatsNew";
import {
  attachPictures,
  captionFromFile,
  readPictures,
  uploadPicture,
} from "../../scripts/whats-new/post-whats-new.mjs";
import { postPictures } from "../../scripts/whats-new/post-pictures.mjs";

const token = "t".repeat(48);
const sha = "a".repeat(40);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const change = (pr: number, pictures?: string[], mergedAt = `2026-11-0${pr % 10}T12:00:00Z`) => ({
  pr,
  note: `Change ${pr} is live.`,
  mergedAt,
  ...(pictures ? { pictures } : {}),
});
const noteRequest = (payload: unknown) =>
  new NextRequest("http://localhost/api/chat/whats-new", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
const pictureRequest = (bytes: Uint8Array, query: string, type = "image/png", auth = `Bearer ${token}`) =>
  new NextRequest(`http://localhost/api/chat/whats-new/pictures?${query}`, {
    method: "POST",
    headers: { authorization: auth, "content-type": type },
    body: Buffer.from(bytes),
  });
let png: Buffer;

beforeEach(async () => {
  vi.stubEnv("WHATS_NEW_TOKEN", token);
  mock.changes = [];
  mock.inserted = [];
  mock.uploads = [];
  mock.removed = [];
  mock.rpc.mockReset().mockImplementation(async (name: string) =>
    name === "post_chat_whats_new_note"
      ? { data: { messageId: "note-1", posted: true, followUpIds: ["follow-1"] }, error: null }
      : { data: { posted: true, messageIds: ["pictures-1"] }, error: null },
  );
  png ??= await sharp({ create: { width: 40, height: 30, channels: 3, background: "#e05a9a" } })
    .png()
    .toBuffer();
});
afterEach(() => vi.unstubAllEnvs());

describe("parsing pictures", () => {
  it("accepts up to 4 picture ids per change and keeps text-only changes unchanged", () => {
    const parsed = parseWhatsNewRequest({
      deployment: sha,
      changes: [change(1, [id(1), id(2), id(3), id(4)]), change(2)],
    });
    expect(parsed?.changes[0].pictures).toEqual([id(1), id(2), id(3), id(4)]);
    expect(parsed?.changes[1]).toEqual({ pr: 2, note: "Change 2 is live.", mergedAt: "2026-11-02T12:00:00.000Z" });
    expect(parseWhatsNewRequest({ deployment: sha, changes: [change(1, [])] })?.changes[0]).not.toHaveProperty(
      "pictures",
    );
  });
  it.each([
    ["five pictures", [change(1, [id(1), id(2), id(3), id(4), id(5)])]],
    ["the same picture twice", [change(1, [id(1), id(1)])]],
    ["one picture on two changes", [change(1, [id(1)]), change(2, [id(1)])]],
    ["a picture that is not an id", [change(1, ["../etc/passwd"])]],
    ["pictures that are not a list", [{ ...change(1), pictures: id(1) }]],
  ])("rejects %s", (_label, changes) => {
    expect(parseWhatsNewRequest({ deployment: sha, changes })).toBeNull();
  });
  it("reads a follow-up for an announced PR and nothing else", () => {
    expect(parseWhatsNewFollowUp({ followUp: { pr: 581, pictures: [id(1)] } })).toEqual({ pr: 581, pictures: [id(1)] });
    for (const bad of [
      { followUp: { pr: 581, pictures: [] } },
      { followUp: { pr: 0, pictures: [id(1)] } },
      { followUp: { pr: 581, pictures: [id(1)], note: "x" } },
      { followUp: { pr: 581, pictures: [id(1)] }, deployment: sha },
      { deployment: sha, changes: [change(1)] },
    ])
      expect(parseWhatsNewFollowUp(bad)).toBeNull();
  });
  it("makes a safe file name from a caption", () => {
    expect(whatsNewPictureFilename("The new Pink theme", "image/png")).toBe("The new Pink theme.png");
    expect(whatsNewPictureFilename("../../etc/passwd\u0000", "image/jpeg")).toBe("etc passwd.jpg");
    expect(whatsNewPictureFilename("   ", "image/png")).toBe("Picture.png");
    expect(whatsNewPictureFilename("x".repeat(400), "image/png").length).toBeLessThanOrEqual(124);
  });
});

describe("where pictures go", () => {
  it("puts up to 3 on the note itself", () => {
    expect(planWhatsNewPictures([change(1, [id(1), id(2)])])).toEqual({ noteFiles: [id(1), id(2)], followUps: [] });
  });
  it("sends a fourth picture right after the note, naming the change", () => {
    const plan = planWhatsNewPictures([change(1, [id(1), id(2), id(3), id(4)])]);
    expect(plan.noteFiles).toEqual([id(1), id(2), id(3)]);
    expect(plan.followUps).toEqual([{ pr: 1, body: "More pictures: Change 1 is live.", files: [id(4)] }]);
  });
  it("keeps several PRs in merge order, at most 3 per message, one PR per follow-up", () => {
    const plan = planWhatsNewPictures([
      change(7, [id(71), id(72), id(73), id(74)], "2026-11-02T12:00:00Z"),
      change(6, [id(61), id(62)], "2026-11-01T12:00:00Z"),
      change(8, undefined, "2026-11-03T12:00:00Z"),
    ]);
    expect(plan.noteFiles).toEqual([id(61), id(62), id(71)]);
    expect(plan.followUps.map((m) => [m.pr, m.files])).toEqual([[7, [id(72), id(73), id(74)]]]);
    for (const message of plan.followUps) expect(message.files.length).toBeLessThanOrEqual(3);
  });
  it("splits an announced PR's pictures into messages of at most 3", () => {
    expect(planWhatsNewFollowUp(581, "SS follows your theme.", [id(1), id(2), id(3), id(4)])).toEqual([
      { pr: 581, body: "Pictures: SS follows your theme.", files: [id(1), id(2), id(3)] },
      { pr: 581, body: "More pictures: SS follows your theme.", files: [id(4)] },
    ]);
  });
});

describe("note route with pictures", () => {
  it("passes the note's files and the follow-ups, and leaves pictures out of the ledger rows", async () => {
    const response = await postNote(noteRequest({ deployment: sha, changes: [change(1, [id(1), id(2), id(3), id(4)])] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ posted: true, pictures: 4, followUpIds: ["follow-1"] });
    expect(mock.rpc).toHaveBeenCalledWith("post_chat_whats_new_note", {
      p_deployment: sha,
      p_body: "Change 1 is live.",
      p_changes: [{ pr: 1, note: "Change 1 is live.", mergedAt: "2026-11-01T12:00:00.000Z" }],
      p_note_files: [id(1), id(2), id(3)],
      p_follow_ups: [{ body: "More pictures: Change 1 is live.", files: [id(4)] }],
    });
  });
  it("posts text-only changes with the original three arguments", async () => {
    await postNote(noteRequest({ deployment: sha, changes: [change(1)] }));
    expect(Object.keys(mock.rpc.mock.calls[0][1])).toEqual(["p_deployment", "p_body", "p_changes"]);
  });
  it("answers 409 when the database refuses the pictures", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "invalid_whats_new_pictures" } });
    expect((await postNote(noteRequest({ deployment: sha, changes: [change(1, [id(1)])] }))).status).toBe(409);
  });
  it("posts pictures for an announced PR under its note, once", async () => {
    mock.changes = [{ pr_number: 581, note: "SS follows your theme.", pictures_posted_at: null }];
    const response = await postNote(noteRequest({ followUp: { pr: 581, pictures: [id(1), id(2)] } }));
    expect(await response.json()).toMatchObject({ posted: true, messageIds: ["pictures-1"], pictures: 2 });
    expect(mock.rpc).toHaveBeenCalledWith("post_chat_whats_new_pictures", {
      p_pr: 581,
      p_follow_ups: [{ body: "Pictures: SS follows your theme.", files: [id(1), id(2)] }],
    });
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: "whats_new_pictures_already_posted" } });
    const again = await postNote(noteRequest({ followUp: { pr: 581, pictures: [id(3)] } }));
    expect([again.status, (await again.json()).error]).toEqual([409, "pictures_already_posted"]);
  });
  it("refuses a follow-up for a PR that was never announced", async () => {
    const response = await postNote(noteRequest({ followUp: { pr: 999, pictures: [id(1)] } }));
    expect(response.status).toBe(409);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});

describe("picture upload route", () => {
  it("needs the token, a PNG or JPEG, a PR number and a small enough file", async () => {
    expect((await postPicture(pictureRequest(png, "pr=1", "image/png", "Bearer wrong"))).status).toBe(401);
    expect((await postPicture(pictureRequest(png, "pr=1", "image/gif"))).status).toBe(415);
    expect((await postPicture(pictureRequest(png, "pr=abc"))).status).toBe(400);
    expect((await postPicture(pictureRequest(png, "pr=0"))).status).toBe(400);
    expect((await postPicture(pictureRequest(new Uint8Array([1, 2, 3, 4]), "pr=1"))).status).toBe(400);
    const big = new Uint8Array(WHATS_NEW_PICTURE_MAX_BYTES + 1);
    big.set(png.subarray(0, 8));
    expect((await postPicture(pictureRequest(big, "pr=1"))).status).toBe(413);
    expect(mock.inserted).toEqual([]);
  });
  it("stores the rebuilt picture as a ready file of Booker Chat Updates", async () => {
    const response = await postPicture(pictureRequest(png, "pr=443&caption=Pictures%20in%20What%27s%20New"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ filename: "Pictures in What's New.png", width: 40, height: 30 });
    expect(mock.inserted).toHaveLength(1);
    expect(mock.inserted[0]).toMatchObject({
      id: body.id,
      member_id: null,
      room_slug: "whats-new",
      mime_type: "image/png",
      status: "ready",
      whats_new_pr: 443,
      object_path: mock.uploads[0],
    });
    expect(mock.inserted[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it("only takes pictures before the note, or once after it with followUp", async () => {
    mock.changes = [{ pr_number: 581, note: "x", pictures_posted_at: null }];
    expect((await (await postPicture(pictureRequest(png, "pr=581"))).json()).error).toBe("already_announced");
    expect((await postPicture(pictureRequest(png, "pr=581&followUp=1"))).status).toBe(200);
    expect((await (await postPicture(pictureRequest(png, "pr=582&followUp=1"))).json()).error).toBe("not_announced");
    mock.changes[0].pictures_posted_at = "2026-11-11T00:00:00Z";
    expect((await (await postPicture(pictureRequest(png, "pr=581&followUp=1"))).json()).error).toBe(
      "pictures_already_posted",
    );
  });
});

describe("the docs/whats-new/<pr>/ folder", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "whats-new-pictures-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));
  it("turns file names into captions", () => {
    expect(captionFromFile("2-pink-theme_on-a-phone.png")).toBe("Pink theme on a phone");
    expect(captionFromFile("01_desktop.JPG")).toBe("Desktop");
    expect(captionFromFile("after.png")).toBe("After");
  });
  it("reads up to 4 pictures in name order, captions.json first, and reports the rest", async () => {
    const folder = join(dir, "443");
    await mkdir(folder);
    await writeFile(join(folder, "captions.json"), JSON.stringify({ "2-phone.png": "On a phone" }));
    await writeFile(join(folder, "1-desktop.png"), png);
    await writeFile(join(folder, "2-phone.png"), png);
    await writeFile(join(folder, "3-fake.png"), "not a picture");
    const huge = Buffer.alloc(700_000);
    png.copy(huge);
    await writeFile(join(folder, "4-huge.png"), huge);
    await writeFile(join(folder, "5-extra.jpg"), png);
    await writeFile(join(folder, "notes.txt"), "x");
    const { pictures, problems } = await readPictures(dir, 443);
    expect(pictures.map((p: { file: string; caption: string; mime: string }) => [p.file, p.caption, p.mime])).toEqual([
      ["1-desktop.png", "Desktop", "image/png"],
      ["2-phone.png", "On a phone", "image/png"],
    ]);
    expect(problems.join("\n")).toMatch(/notes\.txt/);
    expect(problems.join("\n")).toMatch(/only the first 4/);
    expect(problems.join("\n")).toMatch(/3-fake\.png: not a PNG or JPEG inside/);
    expect(problems.join("\n")).toMatch(/4-huge\.png: 700 KB is over 600 KB/);
  });
  it("finds nothing for a PR without a folder (text only, as before)", async () => {
    expect(await readPictures(dir, 1)).toEqual({ pictures: [], problems: [] });
  });
  it("uploads each change's pictures and leaves a failed one out", async () => {
    const folder = join(dir, "10");
    await mkdir(folder);
    await writeFile(join(folder, "1-a.png"), png);
    await writeFile(join(folder, "2-b.png"), png);
    const urls: string[] = [];
    let n = 0;
    const fetchImpl = async (url: URL) => {
      urls.push(String(url));
      n++;
      return n === 2
        ? new Response(JSON.stringify({ error: "invalid_picture" }), { status: 400 })
        : new Response(JSON.stringify({ id: id(n) }), { status: 200 });
    };
    const changes: { pr: number; note: string; pictures?: string[] }[] = [
      { pr: 10, note: "x" },
      { pr: 11, note: "y" },
    ];
    const problems = await attachPictures({
      changes,
      dir,
      url: "https://chat.example.test/api/chat/whats-new",
      token,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(changes[0].pictures).toEqual([id(1)]);
    expect(changes[1]).not.toHaveProperty("pictures");
    expect(problems).toEqual(["#10 picture 2-b.png failed (400): invalid_picture"]);
    expect(urls[0]).toBe("https://chat.example.test/api/chat/whats-new/pictures?pr=10&caption=A");
  });
  it("sends the picture bytes with the token and its type", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: URL, init: RequestInit) => (
      seen.push({ url: String(url), init }), new Response(JSON.stringify({ id: id(9) }))
    );
    const picture = { file: "1-a.png", caption: "Pink & blue", mime: "image/png", bytes: png };
    expect(await uploadPicture({ url: "https://x.test/api/chat/whats-new", token, pr: 5, picture, followUp: true, fetchImpl: fetchImpl as unknown as typeof fetch })).toBe(id(9));
    expect(seen[0].url).toBe("https://x.test/api/chat/whats-new/pictures?pr=5&caption=Pink+%26+blue&followUp=1");
    expect((seen[0].init.headers as Record<string, string>)["content-type"]).toBe("image/png");
    expect((seen[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
  });
  it("posts an announced PR's pictures as a follow-up (post-pictures.mjs)", async () => {
    const folder = join(dir, "581");
    await mkdir(folder);
    await writeFile(join(folder, "1-a.png"), png);
    await writeFile(join(folder, "2-b.png"), png);
    const bodies: unknown[] = [];
    let n = 0;
    const fetchImpl = async (url: URL | string, init: RequestInit) => {
      if (String(url).includes("/pictures?")) return new Response(JSON.stringify({ id: id(++n) }));
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ posted: true, messageIds: ["m1"], pictures: 2 }));
    };
    const result = await postPictures({ pr: 581, dir, url: "https://x.test/api/chat/whats-new", token, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toMatchObject({ posted: true, pictures: 2 });
    expect(bodies).toEqual([{ followUp: { pr: 581, pictures: [id(1), id(2)] } }]);
    await expect(postPictures({ pr: 1, dir, url: "https://x.test", token, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/No pictures/);
  });
});
