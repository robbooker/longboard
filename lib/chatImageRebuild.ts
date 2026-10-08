import sharp from "sharp";
import { attachmentSignature, CHAT_FILE_MAX_BYTES, type ChatFileType } from "./chatAttachmentValidation";

const REBUILT = new Set(["image/jpeg", "image/png"]);
// Bound concurrent full-size decodes per server instance; overflow takes the external scan.
let active = 0;

/**
 * Re-encodes a PNG or JPEG from its decoded pixels alone. Metadata (EXIF, GPS), trailing
 * bytes and any embedded payload are discarded, so the output can be shared without the
 * external malware scan. Returns null whenever the file must take the full scan instead:
 * other types, a disabled switch, a busy instance, or anything sharp won't decode cleanly.
 * The caller must store and share only the returned bytes, never the original upload.
 */
export async function rebuildChatImage(
  bytes: Uint8Array,
  mime: string,
  enabled = process.env.CHAT_IMAGE_REBUILD !== "off",
): Promise<Uint8Array | null> {
  if (
    !enabled ||
    !REBUILT.has(mime) ||
    bytes.length > CHAT_FILE_MAX_BYTES ||
    !attachmentSignature(bytes, mime as ChatFileType) ||
    active >= 3
  )
    return null;
  active++;
  try {
    const image = sharp(bytes, {
      limitInputPixels: 20_000_000,
      failOn: "warning",
      pages: 1,
      animated: false,
      sequentialRead: true,
    }).rotate(); // Apply EXIF orientation before the metadata is dropped.
    const encoded =
      mime === "image/png"
        ? image.png({ compressionLevel: 6, adaptiveFiltering: true })
        : image.jpeg({ quality: 92, chromaSubsampling: "4:4:4" });
    const output = new Uint8Array(await encoded.timeout({ seconds: 10 }).toBuffer());
    return output.length >= 1 &&
      output.length <= CHAT_FILE_MAX_BYTES &&
      attachmentSignature(output, mime as ChatFileType)
      ? output
      : null;
  } catch {
    return null;
  } finally {
    active--;
  }
}
