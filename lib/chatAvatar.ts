/** Initials for an avatar tile: first letters of the first two words ("Jammie Ferguson" → "JF"). */
export function chatInitials(name: string): string {
  const words = name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

// Eight hues that keep white initials above 4.5:1 at this saturation and lightness.
const HUES = [152, 205, 262, 330, 18, 42, 182, 290];
/** A stable tile color per person, so the same person always looks the same. */
export function chatAvatarColor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `hsl(${HUES[hash % HUES.length]} 42% 36%)`;
}

// #410 profile pictures. A picture's name is a uuid; its files never change, so they cache for good.
const AVATAR_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CHAT_AVATAR_BUCKET = "chat-avatars";
export const CHAT_AVATAR_SIZES = [256, 64] as const;
export type ChatAvatarSize = (typeof CHAT_AVATAR_SIZES)[number];
export function validAvatarPath(value: unknown): value is string {
  return typeof value === "string" && AVATAR_NAME.test(value);
}
export const chatAvatarFile = (path: string, size: ChatAvatarSize) => `${path}-${size}.webp`;
/** The public address of one size of a picture, or null when there is no (valid) picture. */
export function chatAvatarUrl(path: unknown, size: ChatAvatarSize = 64): string | null {
  if (!validAvatarPath(path)) return null;
  // Next.js writes the value in at build time; the guard keeps bundles without `process` working.
  const base = typeof process === "undefined" ? undefined : process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/${CHAT_AVATAR_BUCKET}/${chatAvatarFile(path, size)}`;
}
