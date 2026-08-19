const PEDRO_MENTION = /(^|[^\p{L}\p{N}_])@pedrobot\b/iu;
const PEDRO_MENTION_GLOBAL = /(^|[^\p{L}\p{N}_])@pedrobot\b/giu;

export const MAX_PEDRO_REPLY_LENGTH = 4000;

export function hasPedroMention(message: string): boolean {
  return PEDRO_MENTION.test(message);
}

export function promptForPedro(message: string): string {
  return message
    .replace(PEDRO_MENTION_GLOBAL, "$1")
    .replace(/^\s*[,.;:!?-]+\s*/, "")
    .replace(/[,;:]\s*([.!?])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+([,.;!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function limitPedroReply(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= MAX_PEDRO_REPLY_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_PEDRO_REPLY_LENGTH - 1).trimEnd()}…`;
}
