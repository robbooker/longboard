// #328 Polls: shared rules for the poll route and the poll card. A poll is a chat message whose body
// is POLL_PREFIX + question, with a poll record (supabase/migrations/20261030120000_chat_polls.sql).

export const POLL_PREFIX = "📊 Poll: ";
export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 100;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 10;

/** A message that may be a poll (the poll card checks the record; other messages show as text). */
export const isPollBody = (body: string | null | undefined) => !!body && body.startsWith(POLL_PREFIX);
export const pollQuestionFromBody = (body: string) =>
  isPollBody(body) ? body.slice(POLL_PREFIX.length) : body;

export type PollDraft = { question: string; options: string[]; anonymous: boolean; multi: boolean };

/** Trims and checks a new poll; blank answer rows are dropped first. */
export function validatePollDraft(
  input: unknown,
): { ok: true; poll: PollDraft } | { ok: false; error: string } {
  const value = input as Partial<Record<keyof PollDraft, unknown>> | null;
  if (!value || typeof value !== "object")
    return { ok: false, error: "Add a question and at least two answers." };
  const question = typeof value.question === "string" ? value.question.trim() : "";
  if (!question) return { ok: false, error: "Add a question." };
  if (question.length > POLL_QUESTION_MAX)
    return { ok: false, error: `Keep the question under ${POLL_QUESTION_MAX} characters.` };
  if (!Array.isArray(value.options) || value.options.some((o) => typeof o !== "string"))
    return { ok: false, error: "Add at least two answers." };
  const options = (value.options as string[]).map((o) => o.trim()).filter(Boolean);
  if (options.length < POLL_MIN_OPTIONS) return { ok: false, error: "Add at least two answers." };
  if (options.length > POLL_MAX_OPTIONS)
    return { ok: false, error: `A poll can have up to ${POLL_MAX_OPTIONS} answers.` };
  if (options.some((o) => o.length > POLL_OPTION_MAX))
    return { ok: false, error: `Keep each answer under ${POLL_OPTION_MAX} characters.` };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length)
    return { ok: false, error: "Each answer must be different." };
  if (value.anonymous !== undefined && typeof value.anonymous !== "boolean")
    return { ok: false, error: "Choose anonymous or visible votes." };
  if (value.multi !== undefined && typeof value.multi !== "boolean")
    return { ok: false, error: "Choose one answer or several." };
  return {
    ok: true,
    poll: { question, options, anonymous: value.anonymous !== false, multi: value.multi === true },
  };
}

/** What the database returns for one poll (read_chat_polls). */
export type RawPoll = {
  message_id: string;
  question: string;
  anonymous: boolean;
  multi: boolean;
  closed_at: string | null;
  created_by_me: boolean;
  voters: number;
  my_votes: string[];
  options: Array<{
    id: string;
    label: string;
    votes: number;
    people: Array<{ id: string; name: string }> | null;
  }>;
};

export type PollOption = {
  id: string;
  label: string;
  /** Present only when results are shown. */
  votes?: number;
  percent?: number;
  /** Visible-votes polls only, and only when results are shown. */
  people?: Array<{ id: string; name: string }>;
};
export type ChatPoll = {
  messageId: string;
  question: string;
  anonymous: boolean;
  multi: boolean;
  closed: boolean;
  /** The reader created it (may close it). */
  canClose: boolean;
  myVotes: string[];
  /** Results are shown: the reader has voted, or the poll is closed. */
  results: boolean;
  /** People who voted (present only with results). */
  total?: number;
  options: PollOption[];
};

/** Whole-number percentages of the people who voted (several answers may each count). */
export const pollPercent = (votes: number, total: number) =>
  total > 0 ? Math.round((votes / total) * 100) : 0;

/**
 * The poll as one reader may see it. Counts only once they have voted or the poll is closed;
 * names only on visible-votes polls with results; never who voted on an anonymous poll, whatever
 * the database row holds.
 */
export function shapePoll(raw: RawPoll): ChatPoll {
  const ids = new Set(raw.options.map((o) => o.id));
  const myVotes = (Array.isArray(raw.my_votes) ? raw.my_votes : []).filter((id) => ids.has(id));
  const closed = !!raw.closed_at;
  const results = closed || myVotes.length > 0;
  const total = Math.max(0, Number(raw.voters) || 0);
  return {
    messageId: raw.message_id,
    question: raw.question,
    anonymous: !!raw.anonymous,
    multi: !!raw.multi,
    closed,
    canClose: !!raw.created_by_me && !closed,
    myVotes,
    results,
    ...(results ? { total } : {}),
    options: raw.options.map((o) => {
      const option: PollOption = { id: o.id, label: o.label };
      if (!results) return option;
      const votes = Math.max(0, Number(o.votes) || 0);
      option.votes = votes;
      option.percent = pollPercent(votes, total);
      if (!raw.anonymous && Array.isArray(o.people))
        option.people = o.people.map((p) => ({ id: String(p.id), name: String(p.name || "Member") }));
      return option;
    }),
  };
}

/** The answers after tapping one: single-answer polls switch, multi-answer polls toggle. */
export function nextPollSelection(poll: Pick<ChatPoll, "multi" | "myVotes">, optionId: string): string[] {
  if (!poll.multi) return poll.myVotes.length === 1 && poll.myVotes[0] === optionId ? [] : [optionId];
  return poll.myVotes.includes(optionId)
    ? poll.myVotes.filter((id) => id !== optionId)
    : [...poll.myVotes, optionId];
}
