// #332 LB-FAQ: the chat's FAQ page. Shared by the routes and the browser, so it holds only plain
// validation, search and types. Items are question + plain-text answer, with an optional topic
// (#338); admins change them.

export type ChatFaqItem = { id: string; question: string; answer: string; topic?: string | null };

export const FAQ_QUESTION_MAX = 200;
export const FAQ_ANSWER_MAX = 5000;
export const FAQ_TOPIC_MAX = 60;
export const FAQ_NOTE_MAX = 1000;
/** #344: what a draft says when its sources don't cover the question. Never publishable as an answer. */
export const FAQ_NOT_ENOUGH_INFO = "I don't have enough information to answer this yet.";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function oneLine(value: unknown, missing: string, label: string, max: number): Parsed<string> {
  if (typeof value !== "string" || !value.trim()) return { ok: false, error: missing };
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length > max) return { ok: false, error: `Keep the ${label} to ${max} characters or fewer.` };
  return { ok: true, value: text };
}

/** "Topic - Question", or just the question for an item with no topic. */
export function faqItemTitle(item: { question: string; topic?: string | null }) {
  return item.topic ? `${item.topic} - ${item.question}` : item.question;
}

/**
 * A question (one line) and an answer (plain text; line breaks are kept), as typed by an admin, and an
 * optional topic: blank clears it, and leaving the field out (a page opened before topics) keeps it.
 */
export function parseFaqItemInput(body: unknown): Parsed<{ question: string; answer: string; topic?: string | null }> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const question = oneLine(input.question, "Add a question.", "question", FAQ_QUESTION_MAX);
  if (!question.ok) return question;
  if (typeof input.answer !== "string" || !input.answer.trim()) return { ok: false, error: "Add an answer." };
  const answer = input.answer.replace(/\r\n?/g, "\n").trim();
  if (answer.length > FAQ_ANSWER_MAX) return { ok: false, error: `Keep the answer to ${FAQ_ANSWER_MAX} characters or fewer.` };
  if (input.topic === undefined) return { ok: true, value: { question: question.value, answer } };
  if (input.topic !== null && typeof input.topic !== "string") return { ok: false, error: "Add a topic." };
  if (!input.topic?.trim()) return { ok: true, value: { question: question.value, answer, topic: null } };
  const topic = oneLine(input.topic, "Add a topic.", "topic", FAQ_TOPIC_MAX);
  if (!topic.ok) return topic;
  return { ok: true, value: { question: question.value, answer, topic: topic.value } };
}

/** What a member sends with Suggest. It has to fit as a FAQ question once approved. */
export function parseFaqSuggestion(body: unknown): Parsed<string> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return oneLine(input.question ?? input.topic, "Add your question.", "question", FAQ_QUESTION_MAX);
}

export type FaqReview = { id: string; action: "reject"; actorName: string; actorRef: string } | { id: string; action: "approve"; actorName: string; actorRef: string; question: string; topic: string; answer: string };

/**
 * The review endpoint's body. Approving needs a question, topic and answer, whatever the AI drafted.
 * Whoever is named as acting was verified by Marketing HQ, which holds the write token.
 */
export function parseFaqReview(body: unknown): Parsed<FaqReview> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = input.id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false, error: "That suggestion is gone." };
  const actor = (input.actor && typeof input.actor === "object" ? input.actor : {}) as Record<string, unknown>;
  const actorName = oneLine(actor.name, "Say who is acting.", "name", 80);
  if (!actorName.ok) return actorName;
  const actorRef = oneLine(actor.id, "Say who is acting.", "id", 80);
  if (!actorRef.ok) return actorRef;
  const who = { actorName: actorName.value, actorRef: actorRef.value };
  if (input.action === "reject") return { ok: true, value: { id, action: "reject", ...who } };
  if (input.action !== "approve") return { ok: false, error: "Approve or reject." };
  const item = parseFaqItemInput(input);
  if (!item.ok) return item;
  if (!item.value.topic) return { ok: false, error: "Add a topic." };
  if (item.value.answer === FAQ_NOT_ENOUGH_INFO) return { ok: false, error: "Write the answer before approving. The AI didn't have enough information." };
  return { ok: true, value: { id, action: "approve", ...who, question: item.value.question, topic: item.value.topic, answer: item.value.answer } };
}

export type FaqReanswer = { id: string; actorName: string; actorRef: string; note: string | null };

/** The re-answer endpoint's body: who is acting, verified by Marketing HQ, and an optional note on what was wrong. */
export function parseFaqReanswer(body: unknown): Parsed<FaqReanswer> {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = input.id;
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false, error: "That suggestion is gone." };
  const actor = (input.actor && typeof input.actor === "object" ? input.actor : {}) as Record<string, unknown>;
  const actorName = oneLine(actor.name, "Say who is acting.", "name", 80);
  if (!actorName.ok) return actorName;
  const actorRef = oneLine(actor.id, "Say who is acting.", "id", 80);
  if (!actorRef.ok) return actorRef;
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") return { ok: false, error: "That note can't be read." };
  const note = typeof input.note === "string" ? input.note.replace(/\r\n?/g, "\n").trim() : "";
  if (note.length > FAQ_NOTE_MAX) return { ok: false, error: `Keep the note to ${FAQ_NOTE_MAX} characters or fewer.` };
  return { ok: true, value: { id, actorName: actorName.value, actorRef: actorRef.value, note: note || null } };
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

/** The items whose topic, question or answer contains every word typed. It only ever sees FAQ items. */
export function searchFaqItems<T extends { question: string; answer: string; topic?: string | null }>(items: T[], query: string): T[] {
  const words = searchable(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((item) => {
    const text = searchable(`${item.topic ?? ""}\n${item.question}\n${item.answer}`);
    return words.every((word) => text.includes(word));
  });
}
