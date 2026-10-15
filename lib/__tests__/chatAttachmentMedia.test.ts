import { describe, expect, it, vi } from "vitest";
import {
  mediaFrame,
  mediaFromRow,
  mediaDimensions,
  withAttachmentMedia,
} from "../chatAttachmentMedia";

// Minimal PostgREST-style builder: records selected columns, answers from `answer`.
function fakeDb(answer: (columns: string) => { data: unknown[] | null; error: unknown }) {
  const selects: string[] = [];
  const db = {
    from: () => ({
      select: (columns: string) => {
        selects.push(columns);
        const chain = {
          eq: () => chain,
          in: () => chain,
          then: (resolve: (value: unknown) => void) => resolve(answer(columns)),
        };
        return chain;
      },
    }),
  };
  return { db: db as never, selects };
}

describe("MEDIA-SIZE attachment boxes", () => {
  it("fits inside 302x220 without enlarging and keeps a 44px target", () => {
    expect(mediaFrame(1800, 600)).toEqual({ width: 302, height: 101, sized: true });
    expect(mediaFrame(600, 1800)).toEqual({ width: 73, height: 220, sized: true });
    expect(mediaFrame(120, 80)).toEqual({ width: 120, height: 80, sized: true });
    expect(mediaFrame(10, 10)).toEqual({ width: 44, height: 44, sized: true });
    expect(mediaFrame(null, null)).toEqual({ width: 302, height: 220, sized: false });
  });
  it("rejects bad sizes and prefers the original over the preview size", () => {
    expect(mediaDimensions(0, 10)).toBeNull();
    expect(mediaDimensions(1.5, 10)).toBeNull();
    expect(mediaDimensions(30_000, 10)).toBeNull();
    expect(mediaFromRow({ id: "a", mime_type: "image/png", width: 1000, height: 333, preview_width: 640, preview_height: 213 })).toEqual({ kind: "image", width: 1000, height: 333 });
    expect(mediaFromRow({ id: "a", mime_type: "image/gif", preview_width: 640, preview_height: 213 })).toEqual({ kind: "image", width: 640, height: 213 });
    expect(mediaFromRow({ id: "a", mime_type: "image/jpeg" })).toEqual({ kind: "image", width: null, height: null });
    expect(mediaFromRow({ id: "a", mime_type: "application/pdf" })).toEqual({ kind: "file" });
    expect(mediaFromRow({ id: "a", mime_type: "audio/wav" })).toEqual({ kind: "audio" });
  });
  it("adds media only to shown messages with files and falls back before the migration", async () => {
    vi.useFakeTimers();
    const { db, selects } = fakeDb((columns) =>
      columns.includes(",width")
        ? { data: null, error: { code: "42703", message: "column chat_attachments.width does not exist" } }
        : { data: [{ id: "f1", mime_type: "image/png", preview_width: 640, preview_height: 320 }], error: null },
    );
    const rows = [
      { id: "m1", attachment_ids: ["f1"] },
      { id: "m2", attachment_ids: ["f1"], deleted_at: "2026-10-15" },
      { id: "m3" },
    ];
    const out = await withAttachmentMedia(db, { room: "main" }, rows);
    expect(out[0].attachment_media).toEqual({ f1: { kind: "image", width: 640, height: 320 } });
    expect(out[1].attachment_media).toBeUndefined();
    expect(out[2]).toBe(rows[2]);
    expect(selects).toHaveLength(2);
    // Remembers the missing columns for a while instead of failing twice per read.
    await withAttachmentMedia(db, { room: "main" }, rows);
    expect(selects).toHaveLength(3);
    vi.useRealTimers();
  });
  it("never fails the read", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { message: "down" } }));
    const rows = [{ id: "m1", attachment_ids: ["f1"] }];
    expect(await withAttachmentMedia(db, { conversationId: "c" }, rows)).toBe(rows);
  });
});
