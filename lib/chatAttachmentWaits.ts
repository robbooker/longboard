// File checks that are still running, by attachment id. A message can be sent
// while its files are checked: the send waits here, then posts once they pass.
const checks = new Map<string, Promise<void>>();

export function trackAttachmentCheck(id: string, check: Promise<void>) {
  const tracked = check.finally(() => {
    if (checks.get(id) === tracked) checks.delete(id);
  });
  tracked.catch(() => {});
  checks.set(id, tracked);
}

// Resolves once every listed file is checked; rejects with the first failure.
// Ids with no check in this tab (finished, or from before a reload) pass
// straight through and the server decides.
export async function waitForAttachments(ids: readonly string[]) {
  await Promise.all(ids.map((id) => checks.get(id)));
}
