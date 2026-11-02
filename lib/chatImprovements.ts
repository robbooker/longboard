// #352: "Suggest an Improvement" in the What's New room. Shared by the route and the browser, so it
// holds only plain validation and names. The text goes to the private Admins room, the way FAQ topic
// suggestions do (see post_chat_improvement_suggestion).

/** The Admins room's messages from this button carry this slug; they are drawn as plain text. */
export const CHAT_IMPROVEMENTS_BOT = "chat-improvements";

/** With the header line and the longest chat name this still fits the room's 600-character message limit. */
export const IMPROVEMENT_MAX = 450;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// Control characters except tab and line feed, and the marks that reorder text on screen.
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/**
 * Their own words, kept exactly, line breaks included. Only what can't be seen goes: hidden characters,
 * outer space and runs of blank lines. Only the text is read from the request: who sent it and when
 * come from the session and the database.
 */
export function parseImprovementSuggestion(body: unknown): Parsed<string> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof input.suggestion !== "string") return { ok: false, error: "Type your suggestion first." };
  const text = input.suggestion
    .replace(/\r\n?/g, "\n")
    .replace(HIDDEN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return { ok: false, error: "Type your suggestion first." };
  if (text.length > IMPROVEMENT_MAX) return { ok: false, error: `Keep your suggestion to ${IMPROVEMENT_MAX} characters or fewer.` };
  return { ok: true, value: text };
}
