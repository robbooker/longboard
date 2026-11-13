import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_UUID, withAvatarColumn } from "./chatMembers";
import type { ChatMessageAgent } from "./chatAgents";
type NamedMessage = {
  id?: string;
  member_id?: string | null;
  bot_slug?: string | null;
  author_label?: string;
  author_avatar?: string;
  agent?: ChatMessageAgent;
};

// #450: until the agents migration runs there is no lookup function; skip it for 5 minutes.
let agentLookupMissingAt = 0;
/**
 * #450: which of these (already authorized) messages an agent posted: its name and its owner's
 * current chat name. Failures leave the stored labels as they are; they never block a read.
 */
export async function chatMessageAgents(db: SupabaseClient, messageIds: string[]) {
  const agents = new Map<string, ChatMessageAgent>();
  const ids = [...new Set(messageIds.filter((id) => typeof id === "string" && CHAT_UUID.test(id)))];
  if (!ids.length || Date.now() - agentLookupMissingAt < 300_000) return agents;
  try {
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      const { data, error } = await db.rpc("chat_agent_message_identities", { p_ids: batch });
      if (error?.code === "PGRST202" || error?.code === "42883") {
        agentLookupMissingAt = Date.now();
        return agents;
      }
      if (error || !Array.isArray(data)) continue;
      for (const row of data as Array<{
        message_id: string;
        agent_id: string;
        name: string;
        owner_name: string;
      }>)
        if (batch.includes(row.message_id) && typeof row.name === "string")
          agents.set(row.message_id, { id: row.agent_id, name: row.name, owner: row.owner_name ?? "" });
    }
  } catch {
    /* Agent badges are left off; the read goes on. */
  }
  return agents;
}
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
  // #450: agent posts are rows of their owner's member: they keep the agent's name, not the owner's.
  const agentRead = chatMessageAgents(
    db,
    messages.filter((m) => !m.bot_slug && m.member_id && m.id).map((m) => m.id!),
  );
  const names = new Map<string, string>();
  // #410: the author's picture comes from the same read as their current name (no extra query).
  const avatars = new Map<string, string>();
  try {
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200);
      const { data, error } = await withAvatarColumn((avatar) =>
        db
          .from("longboard_chat_members")
          .select(avatar ? "id,display_name,avatar_path" : "id,display_name")
          .in("id", batch),
      );
      if (!error)
        for (const row of (data ?? []) as unknown as Array<{
          id: string;
          display_name: unknown;
          avatar_path?: unknown;
        }>)
          if (batch.includes(row.id) && typeof row.display_name === "string") {
            names.set(row.id, row.display_name);
            if (typeof row.avatar_path === "string") avatars.set(row.id, row.avatar_path);
          }
    }
  } catch {
    /* Preserve stored labels when current-name lookup is unavailable. */
  }
  const agents = await agentRead;
  return messages.map((m) => {
    const agent = m.id ? agents.get(m.id) : undefined;
    if (agent && !m.bot_slug) {
      const { author_avatar: _owner, ...rest } = m;
      return { ...rest, author_label: agent.name, agent } as T;
    }
    if (m.bot_slug || !m.member_id || !names.has(m.member_id)) return m;
    const { author_avatar: _stale, ...rest } = m;
    const avatar = avatars.get(m.member_id);
    return {
      ...rest,
      author_label: names.get(m.member_id)!,
      ...(avatar ? { author_avatar: avatar } : {}),
    } as T;
  });
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
