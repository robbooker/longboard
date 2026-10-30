import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createChatAdminClient } from "@/lib/chatAdmin";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The newest FAQ topic suggestions for Marketing HQ's page. Server-to-server and read-only:
// `Authorization: Bearer <CHAT_FAQ_SUGGESTIONS_READ_TOKEN>`, no member or admin session. It refuses
// everything until that env var is set. Each row is only { name, topic, created_at }: the name comes
// from the members table (null once that member is gone), and no id ever leaves this route.

const LIMIT = 200;
const MIN_SECRET_LENGTH = 32;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const digest = (text: string) => createHash("sha256").update(text).digest();

type Row = {
  topic: string;
  created_at: string;
  member: { display_name: string | null } | { display_name: string | null }[] | null;
};

export async function GET(req: NextRequest) {
  const secret = process.env.CHAT_FAQ_SUGGESTIONS_READ_TOKEN?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return json({ error: "feed_not_configured" }, 503);
  const given = /^bearer (.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  // Hashing first makes both sides the same length, so the comparison never exits early on length.
  if (!given || !timingSafeEqual(digest(given), digest(secret))) return json({ error: "unauthorized" }, 401);

  const db = createChatAdminClient();
  if (!db) return json({ error: "feed_unavailable" }, 503);
  try {
    const { data, error } = await db
      .from("chat_faq_suggestions")
      .select("topic, created_at, member:longboard_chat_members(display_name)")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(LIMIT);
    if (error) return json({ error: "feed_unavailable" }, 503);
    const suggestions = ((data ?? []) as unknown as Row[]).map((row) => {
      const member = Array.isArray(row.member) ? row.member[0] : row.member;
      return { name: member?.display_name ?? null, topic: row.topic, created_at: row.created_at };
    });
    return json({ suggestions });
  } catch {
    return json({ error: "feed_unavailable" }, 503);
  }
}
