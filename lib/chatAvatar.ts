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
