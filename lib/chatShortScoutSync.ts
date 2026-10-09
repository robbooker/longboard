import { randomUUID } from "node:crypto";
import type { createChatAdminClient } from "./chatAdmin";
import { verifyCurrentShortScoutAuthorization } from "./chatShortScoutAuthorization";

type Admin = NonNullable<ReturnType<typeof createChatAdminClient>>;
export type ShortScoutSyncResult = {
  subjects: number;
  allow: number;
  deny: number;
  /** ShortScout didn't answer; those members keep their current copy until it expires. */
  unavailable: number;
  /** Answers the database refused because a newer check (a sign-in) overtook them. */
  superseded: number;
};
type Options = { verify?: typeof verifyCurrentShortScoutAuthorization; concurrency?: number };

/**
 * Refreshes the local ShortScout copy for every subject chat knows (A6). Runs nightly from
 * cron and on an owner's Sync now. Each subject uses the sign-in proof path: reserve a
 * generation, ask ShortScout, apply only if that generation is still current.
 */
export async function syncShortScoutMembership(
  admin: Admin,
  { verify = verifyCurrentShortScoutAuthorization, concurrency = 6 }: Options = {},
): Promise<ShortScoutSyncResult> {
  const list = await admin.rpc("chat_shortscout_sync_subjects");
  if (list.error || !Array.isArray(list.data)) throw Error("shortscout_sync_subjects_failed");
  const subjects = list.data.map((row: unknown) =>
    typeof row === "string"
      ? row
      : (row as { chat_shortscout_sync_subjects: string }).chat_shortscout_sync_subjects,
  );
  const run = randomUUID();
  const result: ShortScoutSyncResult = {
    subjects: subjects.length,
    allow: 0,
    deny: 0,
    unavailable: 0,
    superseded: 0,
  };
  let next = 0;
  const worker = async () => {
    while (next < subjects.length) {
      const subject = subjects[next++];
      const start = await admin.rpc("begin_chat_shortscout_sync", { p_subject: subject, p_run: run });
      if (start.error || start.data?.mode !== "refresh") {
        result.unavailable++;
        continue;
      }
      const proof = await verify(subject);
      const applied = await admin.rpc("finish_chat_shortscout_sync", {
        p_subject: subject,
        p_run: run,
        p_generation: start.data.generation,
        p_state: proof.state,
        p_level: proof.level,
      });
      if (applied.error) result.unavailable++;
      else if (applied.data !== true) result.superseded++;
      else result[proof.state]++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, subjects.length) }, worker));
  return result;
}
