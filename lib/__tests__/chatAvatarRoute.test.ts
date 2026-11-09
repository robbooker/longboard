// #410: /api/chat/avatar access and flow, with the database and storage mocked (synthetic values).
import sharp from "sharp";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/chat/avatar/route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), admin: vi.fn(), member: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/chatAuth", () => ({ requireChatUser: mocks.auth }));
vi.mock("@/lib/chatAdmin", () => ({ createChatAdminClient: mocks.admin, requestOriginAllowed: mocks.origin }));
vi.mock("@/lib/chatMembers", () => ({
  findChatMember: mocks.member,
  CHAT_UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  withAvatarColumn: (read: (avatar: boolean) => unknown) => read(true),
}));

const self = "20000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const upload = "30000000-0000-4000-8000-000000000003";
const oldPicture = "40000000-0000-4000-8000-000000000004";
let rpc: ReturnType<typeof vi.fn>;
let buckets: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
let staged: Uint8Array;
let uploadRow: Record<string, unknown> | null;

const signedIn = (admin = false, extra: Record<string, unknown> = {}) =>
  mocks.auth.mockResolvedValue({
    ok: true,
    user: { id: "account-1", email: "", role: admin ? "admin" : "user" },
    access: { longboard: true, boardroom: false, shortscout: false, admin, ...extra },
    serverSession: true,
  });
const call = (body: unknown) =>
  POST(
    new NextRequest("https://example.test/api/chat/avatar", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
function table() {
  const q = {
    select: () => q,
    eq: () => q,
    is: () => q,
    neq: () => q,
    limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: uploadRow, error: null }),
  };
  return q;
}

beforeEach(async () => {
  vi.clearAllMocks();
  signedIn();
  mocks.origin.mockReturnValue(true);
  mocks.member.mockResolvedValue({ id: self, display_name: "Alice", accepts_requests: true, avatar_path: oldPicture });
  staged = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#4060a0" } }).jpeg().toBuffer();
  uploadRow = { id: upload, member_id: self, used_at: null, created_at: new Date().toISOString() };
  rpc = vi.fn(async (name: string) =>
    name === "chat_avatar_reserve"
      ? { data: upload, error: null }
      : name === "chat_avatar_set" || name === "chat_avatar_clear"
        ? { data: oldPicture, error: null }
        : { data: null, error: { message: "unknown" } },
  );
  const bucket = () => ({
    upload: vi.fn(async () => ({ data: {}, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    download: vi.fn(async () => ({ data: new Blob([staged as BlobPart]), error: null })),
    createSignedUploadUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://storage.example/upload/${path}?token=t` },
      error: null,
    })),
  });
  buckets = { "chat-avatars": bucket(), "chat-avatar-uploads": bucket() };
  mocks.admin.mockReturnValue({ rpc, from: table, storage: { from: (name: string) => buckets[name] } });
});

describe("removing a picture", () => {
  it("lets a member remove their own and deletes both files", async () => {
    const response = await call({ action: "remove" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ memberId: self, removed: true, accountId: "account-1" });
    expect(body.member.avatar_path).toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("chat_avatar_clear", { p_member: self });
    expect(buckets["chat-avatars"].remove).toHaveBeenCalledWith([`${oldPicture}-256.webp`, `${oldPicture}-64.webp`]);
  });

  it("does not let a member remove someone else's", async () => {
    const response = await call({ action: "remove", memberId: other });
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    expect(buckets["chat-avatars"].remove).not.toHaveBeenCalled();
  });

  it("lets an admin remove anyone's", async () => {
    signedIn(true);
    const response = await call({ action: "remove", memberId: other });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ memberId: other, removed: true });
    expect(rpc).toHaveBeenCalledWith("chat_avatar_clear", { p_member: other });
    expect(buckets["chat-avatars"].remove).toHaveBeenCalled();
  });

  it("refuses bots, API tokens, other sites and signed-out visitors", async () => {
    signedIn(false, { botRooms: ["main"] });
    expect((await call({ action: "remove" })).status).toBe(403);
    mocks.auth.mockResolvedValue({ ok: true, user: { id: "a" }, access: { admin: true }, apiToken: true });
    expect((await call({ action: "remove", memberId: other })).status).toBe(403);
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: "unauthenticated" });
    expect((await call({ action: "remove" })).status).toBe(401);
    mocks.origin.mockReturnValue(false);
    expect((await call({ action: "remove" })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("uploading a picture", () => {
  it("signs a one-time upload into the private bucket under the member's folder", async () => {
    const response = await call({ action: "start", byteSize: 2_000_000 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      uploadId: upload,
      url: `https://storage.example/upload/${self}/${upload}?token=t`,
    });
    expect(rpc).toHaveBeenCalledWith("chat_avatar_reserve", { p_member: self });
  });

  it("refuses more than 10 MB and says so", async () => {
    const response = await call({ action: "start", byteSize: 10 * 1024 * 1024 + 1 });
    expect(response.status).toBe(413);
    expect((await response.json()).error).toMatch(/10 MB/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes on the per-member limit", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "avatar_rate_limited" } });
    const response = await call({ action: "start", byteSize: 1000 });
    expect(response.status).toBe(429);
    expect((await response.json()).error).toMatch(/try again/i);
  });

  it("refuses a renamed PDF at preview and deletes it", async () => {
    staged = Buffer.from("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF");
    const response = await call({ action: "preview", uploadId: upload });
    expect(response.status).toBe(415);
    expect((await response.json()).error).toMatch(/isn't a picture/);
    expect(buckets["chat-avatar-uploads"].remove).toHaveBeenCalledWith([`${self}/${upload}`]);
    expect(buckets["chat-avatar-uploads"].upload).not.toHaveBeenCalled();
  });

  it("previews the cleaned copy and keeps only that copy", async () => {
    const response = await call({ action: "preview", uploadId: upload });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect([response.headers.get("x-avatar-width"), response.headers.get("x-avatar-height")]).toEqual(["300", "200"]);
    expect(buckets["chat-avatar-uploads"].upload).toHaveBeenCalledWith(`${self}/${upload}`, expect.any(Buffer), {
      contentType: "image/webp",
      upsert: true,
    });
  });

  it("will not use someone else's upload", async () => {
    uploadRow = null;
    const response = await call({ action: "save", uploadId: upload });
    expect(response.status).toBe(410);
    expect(buckets["chat-avatar-uploads"].download).not.toHaveBeenCalled();
  });

  it("saves 256px and 64px files under a new name and deletes the old picture and the upload", async () => {
    const response = await call({ action: "save", uploadId: upload, crop: { x: 0.3, y: 0.5, zoom: 1.5 } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accountId).toBe("account-1");
    expect(body.member.id).toBe(self);
    expect(body.member.avatar_path).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.member.avatar_path).not.toBe(oldPicture);
    const writes = buckets["chat-avatars"].upload.mock.calls;
    expect(writes.map((c) => c[0]).sort()).toEqual(
      [`${body.member.avatar_path}-256.webp`, `${body.member.avatar_path}-64.webp`].sort(),
    );
    for (const [, bytes, options] of writes) {
      expect(options).toEqual({ contentType: "image/webp", cacheControl: "31536000", upsert: false });
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(meta.height);
      expect(meta.exif).toBeUndefined();
    }
    expect(rpc).toHaveBeenCalledWith("chat_avatar_set", {
      p_member: self,
      p_upload: upload,
      p_path: body.member.avatar_path,
    });
    expect(buckets["chat-avatars"].remove).toHaveBeenCalledWith([`${oldPicture}-256.webp`, `${oldPicture}-64.webp`]);
    expect(buckets["chat-avatar-uploads"].remove).toHaveBeenCalledWith([`${self}/${upload}`]);
  });

  it("undoes the new files when the database refuses the save", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "avatar_upload_invalid" } }));
    const response = await call({ action: "save", uploadId: upload });
    expect(response.status).toBe(410);
    const written = buckets["chat-avatars"].upload.mock.calls.map((c) => c[0]);
    expect(buckets["chat-avatars"].remove).toHaveBeenCalledWith(written.sort((a, b) => b.length - a.length));
  });
});
