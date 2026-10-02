export type ReplyCounts = Record<string, number>;
export const REPLY_COUNT_BATCH_SIZE = 80;

export function replyCountIds(ids: string): string[] {
  return [...new Set(ids.split(',').filter(Boolean))].sort();
}

/** A single refresh is complete only when every bounded count read succeeds. */
export async function readReplyCounts(room: string, ids: string[], read: (path: string) => Promise<Response>, view?: string): Promise<ReplyCounts> {
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += REPLY_COUNT_BATCH_SIZE) batches.push(ids.slice(offset, offset + REPLY_COUNT_BATCH_SIZE));
  const counts = await Promise.all(batches.map(async batch => {
    const response = await read(`/api/chat/thread-counts?room=${encodeURIComponent(room)}&ids=${batch.join(',')}${view?`&view=${encodeURIComponent(view)}`:''}`);
    if (!response.ok) throw new Error('Reply counts unavailable.');
    const data = await response.json();
    if (!data.counts || typeof data.counts !== 'object' || Array.isArray(data.counts)) throw new Error('Invalid reply counts.');
    const result: ReplyCounts = {};
    for (const id of batch) {
      const count = data.counts[id];
      if (count === undefined) continue; // The target may have been removed.
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid reply count.');
      result[id] = count;
    }
    return result;
  }));
  return Object.assign({}, ...counts);
}
