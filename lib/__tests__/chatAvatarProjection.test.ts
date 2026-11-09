// #410: pictures ride along with the current-name read (no extra query), and the chat keeps working
// if the code goes live before its migration (synthetic values).
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withCurrentChatNames } from "@/lib/chatNameProjection";
import { chatAvatarUrl, validAvatarPath } from "@/lib/chatAvatar";
import { validChatMember } from "@/lib/chatMemberName";

const alice = "20000000-0000-4000-8000-000000000001";
const bob = "20000000-0000-4000-8000-000000000002";
const picture = "40000000-0000-4000-8000-000000000004";
function db(columnExists: boolean) {
  const selects: string[] = [];
  const client = {
    from: vi.fn(() => ({
      select: (columns: string) => {
        selects.push(columns);
        return {
          in: async () =>
            !columnExists && columns.includes("avatar_path")
              ? { data: null, error: { code: "42703", message: "column longboard_chat_members.avatar_path does not exist" } }
              : {
                  data: [
                    { id: alice, display_name: "Alice New", ...(columnExists ? { avatar_path: picture } : {}) },
                    { id: bob, display_name: "Bob", ...(columnExists ? { avatar_path: null } : {}) },
                  ],
                  error: null,
                },
        };
      },
    })),
  };
  return { client: client as unknown as SupabaseClient, selects };
}
const rows = [
  { id: "m1", member_id: alice, author_label: "Alice" },
  { id: "m2", member_id: bob, author_label: "Bob", author_avatar: picture },
  { id: "m3", member_id: null, bot_slug: "buddy", author_label: "Buddy" },
];

describe("withCurrentChatNames", () => {
  it("adds each author's picture from the same read as their name, and drops a removed one", async () => {
    const { client, selects } = db(true);
    const named = await withCurrentChatNames(client, rows);
    expect(selects).toEqual(["id,display_name,avatar_path"]);
    expect(named[0]).toEqual({ id: "m1", member_id: alice, author_label: "Alice New", author_avatar: picture });
    expect(named[1]).toEqual({ id: "m2", member_id: bob, author_label: "Bob" });
    expect(named[2]).toBe(rows[2]);
  });

  it("still projects names when the picture column isn't there yet", async () => {
    const { client, selects } = db(false);
    const named = await withCurrentChatNames(client, rows.slice(0, 1));
    expect(named[0]).toEqual({ id: "m1", member_id: alice, author_label: "Alice New" });
    expect(selects).toEqual(["id,display_name,avatar_path", "id,display_name"]);
  });
});

describe("picture names", () => {
  it("builds the public address only for a real picture name", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.example/");
    expect(chatAvatarUrl(picture, 64)).toBe(
      `https://project.supabase.example/storage/v1/object/public/chat-avatars/${picture}-64.webp`,
    );
    expect(chatAvatarUrl(picture, 256)).toMatch(/-256\.webp$/);
    expect(chatAvatarUrl("../secret", 64)).toBeNull();
    expect(chatAvatarUrl(null)).toBeNull();
    expect(validAvatarPath("ABCDEF00-0000-4000-8000-000000000004")).toBe(false);
    vi.unstubAllEnvs();
  });

  it("accepts a member with or without a picture, never a bad one", () => {
    const member = { id: alice, display_name: "Alice", accepts_requests: true };
    expect(validChatMember(member)).toBe(true);
    expect(validChatMember({ ...member, avatar_path: picture })).toBe(true);
    expect(validChatMember({ ...member, avatar_path: null })).toBe(true);
    expect(validChatMember({ ...member, avatar_path: "https://elsewhere.example/x.png" })).toBe(false);
  });
});
