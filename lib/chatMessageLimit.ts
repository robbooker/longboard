/**
 * #367: one length limit for member messages — room messages, thread replies and private
 * messages, when sent and when edited. The database checks the same number
 * (supabase/migrations/20261105120000_chat_longer_messages.sql).
 *
 * Lengths are JavaScript string lengths (UTF-16 units), which are never shorter than the
 * database's char_length, so anything the browser lets through the server accepts too.
 */
export const CHAT_MESSAGE_MAX_LENGTH = 10_000;

/** The counter appears once a draft is within this many characters of the limit. */
export const CHAT_MESSAGE_COUNTER_MARGIN = 1_000;

/** Messages longer than this may fold behind "Show more"; shorter ones render exactly as before. */
export const CHAT_MESSAGE_FOLD_FROM = 600;

const count = (value: number) => value.toLocaleString("en-US");

export function isOverMessageLimit(body: string, max = CHAT_MESSAGE_MAX_LENGTH) {
  return body.trim().length > max;
}

/**
 * What the composer says about the draft's length: nothing until it nears the limit, then how
 * much room is left, then (over the limit) how much to cut. Over the limit sending is blocked,
 * but the draft is kept as typed.
 */
export function messageLengthNotice(body: string, max = CHAT_MESSAGE_MAX_LENGTH) {
  // The server trims before it checks, so spaces and blank lines at the ends don't count.
  const length = body.trim().length;
  if (length > max) {
    const over = length - max;
    return {
      over: true,
      text: `${count(over)} ${over === 1 ? "character" : "characters"} over the ${count(max)} limit. Shorten it to send.`,
    };
  }
  if (length >= max - CHAT_MESSAGE_COUNTER_MARGIN) {
    const left = max - length;
    return { over: false, text: `${count(left)} ${left === 1 ? "character" : "characters"} left` };
  }
  return { over: false, text: "" };
}

/** Appends a GIF link to a draft, or returns null when it would not fit. */
export function appendToDraft(body: string, addition: string, max = CHAT_MESSAGE_MAX_LENGTH) {
  const next = [body.trim(), addition].filter(Boolean).join("\n");
  return next.length > max ? null : next;
}

/** Only messages past the old 600-character limit can fold; the browser decides if they overflow. */
export function mayFoldMessage(body: string) {
  return body.length > CHAT_MESSAGE_FOLD_FROM;
}
