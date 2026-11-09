import sharp from "sharp";

/**
 * #410 profile pictures: everything a member uploads is rebuilt here from its pixels alone.
 *
 * - The file's first bytes decide what it is (never its name or the type the browser claims):
 *   JPEG, PNG, WebP or HEIC/HEIF. Anything else (a renamed PDF, say) is refused.
 * - normalizeAvatar: turned the right way up (EXIF orientation), at most 1536px on its long side,
 *   re-encoded as WebP. sharp writes no metadata unless asked, so EXIF, GPS location, XMP, ICC and
 *   comments are all gone. This is the copy the member's preview shows and the one kept until saving.
 * - renderAvatar: the member's square (their crop, or the middle) at 256px and 64px, WebP, no metadata.
 *   Any size or shape works: small pictures are scaled up, long ones are cropped square.
 *
 * HEIC: sharp's prebuilt libvips can read the HEIF container but not HEVC pictures (it only decodes
 * AVIF), so iPhone photos are decoded by heic-decode (libheif compiled to WebAssembly, loaded only
 * for HEIC files) and then rebuilt by sharp like any other picture. libheif applies the file's own
 * rotation while decoding.
 */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
export const AVATAR_MAX_ZOOM = 4;
const MAX_PIXELS = 70_000_000;
const NORMAL_SIDE = 1536;

export const AVATAR_NOT_IMAGE = "That file isn't a picture. Choose a JPG, PNG, WebP or HEIC photo.";
export const AVATAR_TOO_BIG = "Pictures must be 10 MB or smaller.";
export const AVATAR_UNREADABLE = "That picture couldn't be read. Please try a different photo.";

export class AvatarError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type AvatarKind = "jpeg" | "png" | "webp" | "heif";
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);
const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** What the bytes really are, or null when they aren't a picture we take. */
export function sniffAvatar(bytes: Uint8Array): AvatarKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b))
    return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (bytes.length >= 16 && ascii(bytes, 4, 8) === "ftyp") {
    const size = Math.min(
      bytes.length,
      ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0,
    );
    const brands = [ascii(bytes, 8, 12)];
    for (let at = 16; at + 4 <= size && at < 64; at += 4) brands.push(ascii(bytes, at, at + 4));
    if (brands.some((brand) => HEIF_BRANDS.has(brand))) return "heif";
  }
  return null;
}

const encodeNormal = (image: sharp.Sharp) =>
  image
    .rotate()
    .resize({ width: NORMAL_SIDE, height: NORMAL_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .timeout({ seconds: 20 })
    .toBuffer({ resolveWithObject: true });

async function decodeHeic(bytes: Uint8Array) {
  const { default: decode } = await import("heic-decode");
  const image = await decode({ buffer: bytes });
  if (!image.width || !image.height || image.width * image.height > MAX_PIXELS)
    throw Error("too_many_pixels");
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  });
}

/** The cleaned, upright copy (WebP, at most 1536px). Throws AvatarError with a member-facing message. */
export async function normalizeAvatar(
  bytes: Uint8Array,
): Promise<{ data: Buffer; width: number; height: number }> {
  if (bytes.length > AVATAR_MAX_BYTES) throw new AvatarError(AVATAR_TOO_BIG, 413);
  const kind = sniffAvatar(bytes);
  if (!kind) throw new AvatarError(AVATAR_NOT_IMAGE, 415);
  // A full-size photo can take a few hundred MB to decode; a server instance does two at a time.
  if (decoding >= 2) throw new AvatarError("Pictures are busy right now. Please try again in a moment.", 503);
  decoding++;
  try {
    return await decodeNormal(bytes, kind);
  } finally {
    decoding--;
  }
}
let decoding = 0;
async function decodeNormal(bytes: Uint8Array, kind: AvatarKind) {
  let result: { data: Buffer; info: sharp.OutputInfo };
  try {
    result = await encodeNormal(
      sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", pages: 1, animated: false }),
    );
  } catch {
    if (kind !== "heif") throw new AvatarError(AVATAR_UNREADABLE, 422);
    try {
      result = await encodeNormal(await decodeHeic(bytes));
    } catch {
      throw new AvatarError(AVATAR_UNREADABLE, 422);
    }
  }
  return { data: result.data, width: result.info.width, height: result.info.height };
}

/** Where the member centered the circle (0–1 across and down the upright picture) and how far they zoomed. */
export type AvatarCrop = { x: number; y: number; zoom: number };

/** A crop from a request: anything missing or out of range falls back to the middle, not zoomed. */
export function parseAvatarCrop(value: unknown): AvatarCrop {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const num = (n: unknown, fallback: number, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  return { x: num(v.x, 0.5, 0, 1), y: num(v.y, 0.5, 0, 1), zoom: num(v.zoom, 1, 1, AVATAR_MAX_ZOOM) };
}

/** The square (in pixels of a width x height picture) a crop covers, always inside the picture. */
export function avatarSquare(width: number, height: number, crop: AvatarCrop) {
  const side = Math.max(1, Math.min(width, height, Math.round(Math.min(width, height) / crop.zoom)));
  const clamp = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n)));
  return {
    left: clamp(crop.x * width - side / 2, width - side),
    top: clamp(crop.y * height - side / 2, height - side),
    width: side,
    height: side,
  };
}

/** The two files that are stored: 256px and 64px WebP squares, no metadata. */
export async function renderAvatar(bytes: Uint8Array, crop: AvatarCrop = parseAvatarCrop(null)) {
  const normal = await normalizeAvatar(bytes);
  const square = sharp(normal.data).extract(avatarSquare(normal.width, normal.height, crop));
  const [large, small] = await Promise.all(
    ([256, 64] as const).map((size) =>
      square
        .clone()
        .resize(size, size, { fit: "fill" })
        .webp({ quality: size === 256 ? 82 : 80 })
        .timeout({ seconds: 10 })
        .toBuffer(),
    ),
  );
  return { large, small, normal };
}
