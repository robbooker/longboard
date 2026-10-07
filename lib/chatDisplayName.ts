import { isReservedChatName } from "./publicChat";
// Whole words only: ordinary names containing these letters are not rejected.
const inappropriate = new Set([
  "fuck",
  "fucking",
  "motherfucker",
  "shit",
  "bullshit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
]);
export const CHAT_NAME_HELP =
  "Use a respectful, non-reserved name with 2–28 letters, numbers, spaces, periods, straight or curly apostrophes, underscores or hyphens.";
export function chatName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  return name.length >= 2 &&
    name.length <= 28 &&
    /^[\p{L}\p{N}][\p{L}\p{N} _.'‘’-]*$/u.test(name) &&
    !isReservedChatName(name) &&
    !name
      .toLocaleLowerCase("en-US")
      .split(/[^\p{L}\p{N}]+/u)
      .some((word) => inappropriate.has(word))
    ? name
    : null;
}
