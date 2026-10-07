import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_UUID } from "./chatMembers";
type NamedMessage = {
  id?: string;
  member_id?: string | null;
  bot_slug?: string | null;
  author_label?: string;
};
/** Only enrich rows that the caller has already authorized. Never match by text. */
export async function withCurrentChatNames<T extends NamedMessage>(
  db: SupabaseClient,
  messages: T[],
): Promise<T[]> {
  const ids = [
    ...new Set(
      messages
        .filter((m) => !m.bot_slug && m.author_label !== undefined)
        .map((m) => m.member_id)
        .filter((id): id is string => typeof id === "string" && CHAT_UUID.test(id)),
    ),
  ];
  const names = new Map<string, string>();
  try {
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      const { data, error } = await db
        .from("longboard_chat_members")
        .select("id,display_name")
        .in("id", batch);
      if (!error)
        for (const row of data ?? [])
          if (batch.includes(row.id) && typeof row.display_name === "string")
            names.set(row.id, row.display_name);
    }
  } catch {
    /* Preserve stored labels when current-name lookup is unavailable. */
  }
  return messages.map((m) =>
    !m.bot_slug && m.member_id && names.has(m.member_id)
      ? { ...m, author_label: names.get(m.member_id)! }
      : m,
  );
}
/** Legacy search functions omit identity columns; recover only their authorized result IDs. */
export async function withSearchChatNames<T extends NamedMessage>(
  db: SupabaseClient,
  messages: T[],
): Promise<T[]> {
  const ids = [
    ...new Set(
      messages.map((m) => m.id).filter((id): id is string => typeof id === "string" && CHAT_UUID.test(id)),
    ),
  ];
  const identities = new Map<string, { member_id: string | null; bot_slug: string | null }>();
  try {
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      const { data, error } = await db
        .from("longboard_chat_messages")
        .select("id,member_id,bot_slug")
        .in("id", batch);
      if (!error)
        for (const row of data ?? [])
          if (batch.includes(row.id))
            identities.set(row.id, { member_id: row.member_id, bot_slug: row.bot_slug });
    }
  } catch {
    /* A projection failure must not widen the authorized result. */
  }
  return withCurrentChatNames(
    db,
    messages.map((m) => ({ ...m, ...identities.get(m.id ?? "") })),
  );
}
