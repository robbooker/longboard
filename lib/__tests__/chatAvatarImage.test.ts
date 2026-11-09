// #410: every uploaded picture is rebuilt from its pixels (synthetic images only).
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_BYTES,
  AVATAR_NOT_IMAGE,
  AVATAR_TOO_BIG,
  AvatarError,
  avatarSquare,
  normalizeAvatar,
  parseAvatarCrop,
  renderAvatar,
  sniffAvatar,
} from "@/lib/chatAvatarImage";

// 120 x 80, left half red and right half blue.
const halves = () =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="60" height="80" fill="#f00"/><rect x="60" width="60" height="80" fill="#00f"/></svg>`,
    ),
  );
const pixel = async (bytes: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at], data[at + 1], data[at + 2]];
};
const red = (rgb: number[]) => rgb[0] > 180 && rgb[2] < 80;
const blue = (rgb: number[]) => rgb[2] > 180 && rgb[0] < 80;
// EXIF with a camera name and a GPS position, and orientation 6 (turn 90° clockwise to view).
const withExif = (orientation: number) =>
  halves()
    .jpeg({ quality: 95 })
    .withExif({
      IFD0: { Make: "SyntheticCam", Software: "secret-app" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 58/1 56/1" },
    })
    .withMetadata({ orientation })
    .toBuffer();

describe("sniffAvatar", () => {
  it("knows pictures by their bytes, not their names", async () => {
    expect(sniffAvatar(await halves().jpeg().toBuffer())).toBe("jpeg");
    expect(sniffAvatar(await halves().png().toBuffer())).toBe("png");
    expect(sniffAvatar(await halves().webp().toBuffer())).toBe("webp");
    expect(sniffAvatar(readFileSync(new URL("./fixtures/avatar-sample.heic", import.meta.url)))).toBe("heif");
    expect(sniffAvatar(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"))).toBeNull();
    expect(sniffAvatar(await halves().gif().toBuffer())).toBeNull();
    expect(sniffAvatar(new Uint8Array())).toBeNull();
  });
});

describe("normalizeAvatar", () => {
  it("turns a photo upright by its EXIF orientation and drops every bit of metadata", async () => {
    const original = await withExif(6);
    const before = await sharp(original).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.length).toBeGreaterThan(0);
    // The original carries a GPS block (tag 0x8825, either byte order).
    const gps = (exif: Buffer | undefined) =>
      !!exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])));
    expect(gps(before.exif)).toBe(true);
    const normal = await normalizeAvatar(original);
    // 120 x 80 turned a quarter clockwise is 80 x 120, red on top.
    expect([normal.width, normal.height]).toEqual([80, 120]);
    expect(red(await pixel(normal.data, 40, 10))).toBe(true);
    expect(blue(await pixel(normal.data, 40, 110))).toBe(true);
    const after = await sharp(normal.data).metadata();
    expect(after.format).toBe("webp");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    const text = normal.data.toString("latin1");
    expect(original.toString("latin1")).toContain("SyntheticCam");
    for (const leak of ["Exif", "SyntheticCam", "secret-app"]) expect(text).not.toContain(leak);
  });

  it("refuses a renamed PDF and anything else that isn't a picture", async () => {
    const pdf = Buffer.from("%PDF-1.4\n%âãÏÓ\n1 0 obj << /Type /Catalog >> endobj\ntrailer\n%%EOF");
    await expect(normalizeAvatar(pdf)).rejects.toMatchObject({ message: AVATAR_NOT_IMAGE, status: 415 });
    await expect(normalizeAvatar(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).rejects.toBeInstanceOf(
      AvatarError,
    );
  });

  it("refuses a file over 10 MB before reading it", async () => {
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    await expect(normalizeAvatar(big)).rejects.toMatchObject({ message: AVATAR_TOO_BIG, status: 413 });
  });

  it("refuses a broken file that only starts like a picture", async () => {
    const truncated = (await halves().png().toBuffer()).subarray(0, 40);
    await expect(normalizeAvatar(truncated)).rejects.toMatchObject({ status: 422 });
  });

  it("reads an iPhone HEIC photo and strips its EXIF", async () => {
    const heic = readFileSync(new URL("./fixtures/avatar-sample.heic", import.meta.url));
    const normal = await normalizeAvatar(heic);
    expect([normal.width, normal.height]).toEqual([120, 80]);
    expect(red(await pixel(normal.data, 10, 40))).toBe(true);
    expect(blue(await pixel(normal.data, 110, 40))).toBe(true);
    expect((await sharp(normal.data).metadata()).exif).toBeUndefined();
  });

  it("shrinks very large pictures to 1536px on the long side", async () => {
    const huge = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#888" } })
      .jpeg()
      .toBuffer();
    const normal = await normalizeAvatar(huge);
    expect([normal.width, normal.height]).toEqual([1536, 1152]);
  });
});

describe("renderAvatar", () => {
  it("makes 256px and 64px WebP squares from any shape, the middle by default", async () => {
    const { large, small } = await renderAvatar(await halves().png().toBuffer());
    for (const [bytes, size] of [
      [large, 256],
      [small, 64],
    ] as const) {
      const meta = await sharp(bytes).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(["webp", size, size]);
      expect(meta.exif).toBeUndefined();
    }
    // The middle 80 x 80 of the 120 x 80 picture: red on the left, blue on the right.
    expect(red(await pixel(large, 20, 128))).toBe(true);
    expect(blue(await pixel(large, 236, 128))).toBe(true);
  });

  it("uses the member's crop", async () => {
    const left = await renderAvatar(await halves().png().toBuffer(), { x: 0.1, y: 0.5, zoom: 2 });
    expect(red(await pixel(left.large, 128, 128))).toBe(true);
    const right = await renderAvatar(await halves().png().toBuffer(), { x: 0.9, y: 0.5, zoom: 2 });
    expect(blue(await pixel(right.large, 128, 128))).toBe(true);
  });

  it("scales up a tiny picture and strips metadata from the rotated result", async () => {
    const tiny = await sharp({ create: { width: 10, height: 30, channels: 3, background: "#0a0" } })
      .jpeg()
      .withExif({ IFD3: { GPSLatitudeRef: "S", GPSLatitude: "1/1 2/1 3/1" } })
      .toBuffer();
    const { large, small } = await renderAvatar(tiny);
    expect((await sharp(large).metadata()).width).toBe(256);
    expect((await sharp(small).metadata()).width).toBe(64);
    expect(large.toString("latin1")).not.toContain("Exif");
    const rotated = await renderAvatar(await withExif(6));
    expect((await sharp(rotated.large).metadata()).exif).toBeUndefined();
    // Upright 80 x 120 (red over blue), centered square: red at the top, blue at the bottom.
    expect(red(await pixel(rotated.large, 128, 20))).toBe(true);
    expect(blue(await pixel(rotated.large, 128, 236))).toBe(true);
  });
});

describe("crop", () => {
  it("falls back to the middle for missing or wild values and stays inside the picture", () => {
    expect(parseAvatarCrop(null)).toEqual({ x: 0.5, y: 0.5, zoom: 1 });
    expect(parseAvatarCrop({ x: "1", y: NaN, zoom: 99 })).toEqual({ x: 0.5, y: 0.5, zoom: 4 });
    expect(parseAvatarCrop({ x: -3, y: 7, zoom: 0 })).toEqual({ x: 0, y: 1, zoom: 1 });
    expect(avatarSquare(120, 80, { x: 0, y: 0, zoom: 1 })).toEqual({ left: 0, top: 0, width: 80, height: 80 });
    expect(avatarSquare(120, 80, { x: 1, y: 1, zoom: 2 })).toEqual({ left: 80, top: 40, width: 40, height: 40 });
    expect(avatarSquare(120, 80, { x: 0.5, y: 0.5, zoom: 1 })).toEqual({ left: 20, top: 0, width: 80, height: 80 });
  });
});
