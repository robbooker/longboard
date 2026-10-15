export type ReplyCounts = Record<string, number>;
/** Who replied most recently (newest first, up to three people) and when the last reply came. */
export type ReplyPerson = { key: string; name: string; member?: string; bot?: boolean };
export type ReplyThread = { last: string; people: ReplyPerson[] };
export type ReplyThreads = Record<string, ReplyThread>;
export const REPLY_COUNT_BATCH_SIZE = 80;
export const REPLY_THREAD_PEOPLE = 3;

export function replyCountIds(ids: string): string[] {
  return [...new Set(ids.split(",").filter(Boolean))].sort();
}

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;

/**
 * Server side: the newest reply time and the first REPLY_THREAD_PEOPLE distinct people from
 * chat_thread_summaries' newest-first author list. The avatar key matches a room row's
 * (member, then guest, then label), so a person's tile has the same color everywhere.
 */
export function replyThreadSummary(last: unknown, repliers: unknown): ReplyThread | null {
  const at = typeof last === "string" ? last : last instanceof Date ? last.toISOString() : null;
  if (!at || Number.isNaN(Date.parse(at))) return null;
  const people: ReplyPerson[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(repliers) ? repliers : []) {
    if (people.length >= REPLY_THREAD_PEOPLE) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = text(row.name, 200);
    if (!name) continue;
    const bot = row.bot === "buddy";
    const member = bot ? undefined : text(row.member, 64);
    const key = bot ? "bot:buddy" : (member ?? text(row.guest, 200) ?? name);
    if (seen.has(key)) continue;
    seen.add(key);
    people.push({ key, name: bot ? "Buddy" : name, ...(member ? { member } : {}), ...(bot ? { bot } : {}) });
  }
  return { last: at, people };
}

function validThread(value: unknown): ReplyThread | null {
  if (!value || typeof value !== "object") return null;
  const { last, people } = value as { last?: unknown; people?: unknown };
  if (typeof last !== "string" || Number.isNaN(Date.parse(last)) || !Array.isArray(people)) return null;
  const valid = people
    .filter(
      (person): person is ReplyPerson =>
        !!person && typeof person.key === "string" && typeof person.name === "string",
    )
    .slice(0, REPLY_THREAD_PEOPLE)
    .map(({ key, name, member, bot }) => ({
      key,
      name,
      ...(typeof member === "string" ? { member } : {}),
      ...(bot === true ? { bot } : {}),
    }));
  return { last, people: valid };
}

/** A single refresh is complete only when every bounded count read succeeds. */
export async function readReplyThreads(
  room: string,
  ids: string[],
  read: (path: string) => Promise<Response>,
  view?: string,
): Promise<{ counts: ReplyCounts; threads: ReplyThreads }> {
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += REPLY_COUNT_BATCH_SIZE)
    batches.push(ids.slice(offset, offset + REPLY_COUNT_BATCH_SIZE));
  const results = await Promise.all(
    batches.map(async (batch) => {
      const response = await read(
        `/api/chat/thread-counts?room=${encodeURIComponent(room)}&ids=${batch.join(",")}${view ? `&view=${encodeURIComponent(view)}` : ""}`,
      );
      if (!response.ok) throw new Error("Reply counts unavailable.");
      const data = await response.json();
      if (!data.counts || typeof data.counts !== "object" || Array.isArray(data.counts))
        throw new Error("Invalid reply counts.");
      const counts: ReplyCounts = {};
      const threads: ReplyThreads = {};
      for (const id of batch) {
        const count = data.counts[id];
        if (count === undefined) continue; // The target may have been removed.
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid reply count.");
        counts[id] = count;
        // Older servers send counts only; the link then shows the count alone.
        const thread = count > 0 ? validThread(data.threads?.[id]) : null;
        if (thread) threads[id] = thread;
      }
      return { counts, threads };
    }),
  );
  return {
    counts: Object.assign({}, ...results.map((result) => result.counts)),
    threads: Object.assign({}, ...results.map((result) => result.threads)),
  };
}

export async function readReplyCounts(
  room: string,
  ids: string[],
  read: (path: string) => Promise<Response>,
  view?: string,
): Promise<ReplyCounts> {
  return (await readReplyThreads(room, ids, read, view)).counts;
}

/** Keeps the previous object for every unchanged thread, so memoized rows skip re-rendering. */
export function shareReplyThreads(previous: ReplyThreads, next: ReplyThreads): ReplyThreads {
  let same = Object.keys(previous).length === Object.keys(next).length;
  const shared: ReplyThreads = {};
  for (const [id, thread] of Object.entries(next)) {
    const old = previous[id];
    const equal =
      !!old &&
      old.last === thread.last &&
      old.people.length === thread.people.length &&
      old.people.every(
        (person, index) =>
          person.key === thread.people[index].key &&
          person.name === thread.people[index].name &&
          person.member === thread.people[index].member &&
          person.bot === thread.people[index].bot,
      );
    shared[id] = equal ? old : thread;
    if (!equal) same = false;
  }
  return same ? previous : shared;
}
