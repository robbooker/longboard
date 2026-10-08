import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { rebuildChatImage } from "@/lib/chatImageRebuild";

const payload = new TextEncoder().encode("<script>alert(1)</script>MZ-hidden-payload");
const includes = (bytes: Uint8Array, part: Uint8Array) =>
  Buffer.from(bytes).indexOf(Buffer.from(part)) !== -1;

async function png() {
  return new Uint8Array(
    await sharp({ create: { width: 60, height: 30, channels: 4, background: { r: 10, g: 120, b: 200, alpha: 1 } } })
      .png()
      .toBuffer(),
  );
}

describe("rebuildChatImage", () => {
  it("drops bytes appended after a PNG and keeps its pixels exactly", async () => {
    const original = await png();
    const tampered = new Uint8Array([...original, ...payload]);
    const rebuilt = await rebuildChatImage(tampered, "image/png", true);
    expect(rebuilt).not.toBeNull();
    expect(includes(rebuilt!, payload)).toBe(false);
    const [a, b] = await Promise.all([original, rebuilt!].map((x) => sharp(x).raw().toBuffer()));
    expect(b.equals(a)).toBe(true);
  });

  it("strips JPEG metadata such as GPS, after applying the EXIF rotation", async () => {
    const withGps = new Uint8Array(
      await sharp({ create: { width: 40, height: 20, channels: 3, background: "white" } })
        .jpeg()
        .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret-gps-marker" } } })
        .toBuffer(),
    );
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    const rebuilt = await rebuildChatImage(withGps, "image/jpeg", true);
    const meta = await sharp(rebuilt!).metadata();
    expect(meta.exif).toBeUndefined();
    expect(includes(rebuilt!, new TextEncoder().encode("secret-gps-marker"))).toBe(false);
    expect([meta.width, meta.height]).toEqual([20, 40]); // orientation 6 = rotated a quarter turn
  });

  it("sends everything else to the full scan", async () => {
    const original = await png();
    expect(await rebuildChatImage(original, "image/png", false)).toBeNull(); // switched off
    expect(await rebuildChatImage(original, "image/gif", true)).toBeNull();
    expect(await rebuildChatImage(original, "application/pdf", true)).toBeNull();
    expect(await rebuildChatImage(original, "image/jpeg", true)).toBeNull(); // wrong magic bytes
    // A PNG signature in front of junk won't decode, so it falls back to the scan.
    const fake = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...payload]);
    expect(await rebuildChatImage(fake, "image/png", true)).toBeNull();
  });
});
