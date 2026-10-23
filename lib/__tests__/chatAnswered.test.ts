import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { answeredTarget } from "@/lib/chatAnswered";
import { withAnsweredMessages } from "@/lib/chatReads/answered";
import type { PublicChatMessage } from "@/lib/publicChat";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const message = (n: number, extra: Partial<PublicChatMessage> = {}): PublicChatMessage => ({
  id: id(n),
  guest_id: null,
  member_id: id(100 + n),
  author_label: `Person ${n}`,
  body: "text",
  created_at: "2026-10-01T00:00:00Z",
  ...extra,
});

// A tiny PostgREST stand-in: answered_id links, the answered rows, current member names.
function db(tables: { links: unknown[] | { error: unknown }; rows?: unknown[]; names?: unknown[] }) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    let columns = "";
    const q = {
      select: (c: string) => ((columns = c), q),
      eq: () => q,
      in: async () => {
        calls.push(`${table}:${columns}`);
        if (table === "longboard_chat_members") return { data: tables.names ?? [], error: null };
        if (columns === "id,answered_id")
          return Array.isArray(tables.links) ? { data: tables.links, error: null } : { data: null, ...tables.links };
        return { data: tables.rows ?? [], error: null };
      },
    };
    return q;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("withAnsweredMessages", () => {
  it("adds who a moved reply answered, with current names and deleted targets", async () => {
    const { client } = db({
      links: [
        { id: id(2), answered_id: id(1) },
        { id: id(3), answered_id: id(9) },
        { id: id(4), answered_id: null },
      ],
      rows: [{ id: id(1), member_id: id(101), bot_slug: null, author_label: "Old name", deleted_at: null, removed: false }],
      names: [{ id: id(101), display_name: "New name" }],
    });
    const result = await withAnsweredMessages(client, "main", [message(2), message(3), message(4)]);
    expect(result[0]).toMatchObject({
      answered_id: id(1),
      answered: { id: id(1), author_label: "New name", member_id: id(101), bot_slug: null },
    });
    // The answered message is gone (hard-deleted): still labelled, as deleted.
    expect(result[1]).toMatchObject({ answered_id: id(9), answered: { id: id(9), deleted: true } });
    expect(result[2]).toEqual(message(4));
  });

  it("serves the thread unchanged before the migration adds answered_id", async () => {
    const { client, calls } = db({ links: { error: { code: "42703", message: "column does not exist" } } });
    const replies = [message(2)];
    expect(await withAnsweredMessages(client, "main", replies)).toBe(replies);
    expect(calls).toEqual(["longboard_chat_messages:id,answered_id"]);
  });

  it("does no lookup without replies", async () => {
    const { client, calls } = db({ links: [] });
    expect(await withAnsweredMessages(client, "main", [])).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("answeredTarget", () => {
  it("prefers the copy on screen, then the read's label", () => {
    const answered = message(1);
    const reply = message(2, { answered_id: id(1), answered: { id: id(1), author_label: "From read", member_id: null, bot_slug: null } });
    expect(answeredTarget(reply, [answered])).toEqual({ deleted: false, message: answered });
    expect(answeredTarget(reply, [])).toEqual({ deleted: false, message: reply.answered });
    expect(answeredTarget(reply, [message(1, { deleted_at: "2026-10-02T00:00:00Z" })])).toEqual({ deleted: true });
    expect(answeredTarget(message(3, { answered_id: id(1), answered: { id: id(1), deleted: true } }), [])).toEqual({ deleted: true });
  });
  it("is null for a direct reply or an answered message not known yet", () => {
    expect(answeredTarget(message(2), [message(1)])).toBeNull();
    expect(answeredTarget(message(2, { answered_id: id(7) }), [message(1)])).toBeNull();
  });
});
