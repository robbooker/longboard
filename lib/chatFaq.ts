// #332 LB-FAQ: the chat's FAQ page. Shared by the routes and the browser, so it holds only plain
// validation, search and types. Items are question + plain-text answer; admins change them.

export type ChatFaqItem = { id: string; question: string; answer: string };

export const FAQ_QUESTION_MAX = 200;
export const FAQ_ANSWER_MAX = 5000;
export const FAQ_TOPIC_MAX = 300;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function oneLine(value: unknown, missing: string, label: string, max: number): Parsed<string> {
  if (typeof value !== "string" || !value.trim()) return { ok: false, error: missing };
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > max) return { ok: false, error: `Keep the ${label} to ${max} characters or fewer.` };
  return { ok: true, value: text };
}

/** A question (one line) and an answer (plain text; line breaks are kept), as typed by an admin. */
export function parseFaqItemInput(body: unknown): Parsed<{ question: string; answer: string }> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const question = oneLine(input.question, "Add a question.", "question", FAQ_QUESTION_MAX);
  if (!question.ok) return question;
  if (typeof input.answer !== "string" || !input.answer.trim()) return { ok: false, error: "Add an answer." };
  const answer = input.answer.replace(/\r\n?/g, "\n").trim();
  if (answer.length > FAQ_ANSWER_MAX) return { ok: false, error: `Keep the answer to ${FAQ_ANSWER_MAX} characters or fewer.` };
  return { ok: true, value: { question: question.value, answer } };
}

export function parseFaqTopic(body: unknown): Parsed<string> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return oneLine(input.topic, "Add a topic.", "topic", FAQ_TOPIC_MAX);
}

/** Lower case, no accents, straight quotes: a curly and a plain apostrophe read the same. Unicode classes, not
 * literal ranges, so the built script stays plain ASCII however it is decoded. */
function searchable(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\p{Pi}|\p{Pf}/gu, "'")
    .toLowerCase();
}

/** The items whose question or answer contains every word typed. It only ever sees FAQ items. */
export function searchFaqItems<T extends { question: string; answer: string }>(items: T[], query: string): T[] {
  const words = searchable(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const text = searchable(`${item.question}\n${item.answer}`);
    return words.every((word) => text.includes(word));
  });
}
