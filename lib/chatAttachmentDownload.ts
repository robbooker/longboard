/**
 * Files that could run code in a browser (HTML) are never handed out as a signed storage
 * link and never shown inline. The download route sends their bytes itself with headers
 * that make every browser save the file instead of rendering it:
 * - Content-Disposition: attachment (with a safe filename)
 * - Content-Type: application/octet-stream, plus X-Content-Type-Options: nosniff so the
 *   browser cannot decide on its own that the bytes are HTML
 * - Content-Security-Policy: sandbox, so even a browser that ignored all of the above
 *   would run the page in an opaque origin with no scripts, no network and no forms.
 */
export const INERT_DOWNLOAD_CSP =
  "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** ASCII-only, quote-free fallback name; the exact name travels in filename* (RFC 6266/5987). */
export function safeDownloadFilename(filename: string) {
  const ascii = filename
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\;%*:?<>|/]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return ascii && !/^[._ -]*$/.test(ascii) ? ascii.slice(0, 180) : "download";
}

export function attachmentContentDisposition(filename: string) {
  const encoded = encodeURIComponent(filename.replace(/[\x00-\x1f\x7f/\\]/g, "_")).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${safeDownloadFilename(filename)}"; filename*=UTF-8''${encoded}`;
}

export function inertDownloadHeaders(filename: string, byteSize: number): Record<string, string> {
  return {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": attachmentContentDisposition(filename),
    "Content-Length": String(byteSize),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": INERT_DOWNLOAD_CSP,
    "X-Download-Options": "noopen",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
  };
}
