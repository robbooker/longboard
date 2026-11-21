// #482: AI Insights wording, the SS note's link and the write-up's light formatting. No server code,
// so the chat page can load it too.
export const AI_INSIGHTS_BOT = "ai-insights";
export const AI_INSIGHTS_AUTHOR = "AI Insights";
export const AI_INSIGHTS_DESCRIPTION = "What the AI learned from today's SS room";
export const AI_INSIGHTS_FOOTER = "Written by AI from today's ShortScout room. Not trading advice.";
export const AI_INSIGHTS_ROOM_PATH = "/chat?room=ai-insights";
export const AI_INSIGHTS_LINK_LABEL = "AI Insights";
/** What a member hears when they try to start a post there. */
export const AI_INSIGHTS_REPLIES_ONLY =
  "AI Insights takes replies only. Tap Reply under a post to ask the AI about it.";

/** The in-app link to one post, the format the bell uses (#chat-message-<id>). */
export function aiInsightsPostPath(messageId: string) {
  return `${AI_INSIGHTS_ROOM_PATH}#chat-message-${messageId}`;
}

/** The note in SS once the day's write-up is posted. The full address is for API readers. */
export function composeAiInsightsNote(origin: string, messageId: string) {
  return `Today's AI Insights are ready 👉 ${AI_INSIGHTS_LINK_LABEL}: ${origin.replace(/\/+$/, "")}${aiInsightsPostPath(messageId)}`;
}

const NOTE_LINK =
  /(AI Insights): https?:\/\/[^\s/]+(\/chat\?room=ai-insights#chat-message-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\s|$)/;

/** Splits the AI's note so the chat shows "AI Insights" as a link that stays in the app. */
export function aiInsightsNoteLink(
  body: string,
): { before: string; label: string; href: string; after: string } | null {
  const match = NOTE_LINK.exec(body);
  if (!match) return null;
  return {
    before: body.slice(0, match.index),
    label: match[1],
    href: match[2],
    after: body.slice(match.index + match[0].length),
  };
}

export type AiInsightsSpan = { kind: "text" | "strong" | "em"; value: string };

/**
 * The write-up's only formatting: **bold** and *italic* within a line. Anything else, an unpaired
 * star included, stays plain text. Never HTML.
 */
export function aiInsightsSpans(line: string): AiInsightsSpan[] {
  const spans: AiInsightsSpan[] = [];
  const pattern = /\*\*([^*\n]+?)\*\*|\*([^*\n]+?)\*/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) spans.push({ kind: "text", value: line.slice(last, at) });
    spans.push(
      match[1] !== undefined ? { kind: "strong", value: match[1] } : { kind: "em", value: match[2] },
    );
    last = at + match[0].length;
  }
  if (last < line.length) spans.push({ kind: "text", value: line.slice(last) });
  return spans;
}
