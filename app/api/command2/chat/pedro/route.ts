import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  hasPedroMention,
  limitPedroReply,
  promptForPedro,
} from "@/lib/boardroomChatPedro";
import { answerPedro, type PedroChatMessage } from "@/lib/pedro/commands";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type BoardroomMessage = {
  id: string;
  cohort: string;
  user_id: string;
  author_label: string;
  body: string;
  bot_slug: string | null;
  reply_to_id: string | null;
  created_at: string;
};

const MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toPedroHistory(rows: BoardroomMessage[], sourceId: string): PedroChatMessage[] {
  return rows
    .filter((row) => row.id !== sourceId)
    .slice(-8)
    .map((row) => ({
      role: row.bot_slug === "pedrobot" ? "assistant" as const : "user" as const,
      content: row.bot_slug === "pedrobot"
        ? row.body
        : `${row.author_label}: ${row.body}`,
    }));
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let payload: { messageId?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  if (!MESSAGE_ID_PATTERN.test(messageId)) {
    return NextResponse.json({ error: "invalid_message_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: source, error: sourceError } = await supabase
    .from("boardroom_chat_messages")
    .select("id, cohort, user_id, author_label, body, bot_slug, reply_to_id, created_at")
    .eq("id", messageId)
    .maybeSingle();

  if (sourceError) {
    return NextResponse.json({ error: "message_lookup_failed" }, { status: 500 });
  }
  if (!source || source.user_id !== auth.user.id || source.bot_slug) {
    return NextResponse.json({ error: "message_not_found" }, { status: 404 });
  }
  if (!hasPedroMention(source.body)) {
    return NextResponse.json({ error: "pedrobot_not_mentioned" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("boardroom_chat_messages")
    .select("id, cohort, user_id, author_label, body, bot_slug, reply_to_id, created_at")
    .eq("reply_to_id", messageId)
    .maybeSingle();

  if (existing) return NextResponse.json(existing);

  const { data: contextRows } = await supabase
    .from("boardroom_chat_messages")
    .select("id, cohort, user_id, author_label, body, bot_slug, reply_to_id, created_at")
    .eq("cohort", source.cohort)
    .lte("created_at", source.created_at)
    .order("created_at", { ascending: false })
    .limit(9);

  const prompt = promptForPedro(source.body)
    || "Say hello and introduce yourself briefly to the Boardroom.";
  const history = toPedroHistory(
    ((contextRows ?? []) as BoardroomMessage[]).reverse(),
    source.id,
  );

  try {
    const answer = await answerPedro({ message: prompt, history });
    const reply = limitPedroReply(answer.text || "I am here, but I came up empty on that one.");
    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const { data, error } = await admin
      .from("boardroom_chat_messages")
      .insert({
        cohort: source.cohort,
        user_id: auth.user.id,
        author_label: "@pedrobot",
        body: reply,
        bot_slug: "pedrobot",
        reply_to_id: source.id,
      })
      .select("id, cohort, user_id, author_label, body, bot_slug, reply_to_id, created_at")
      .single();

    if (!error && data) return NextResponse.json(data);

    if (error?.code === "23505") {
      const { data: duplicate } = await supabase
        .from("boardroom_chat_messages")
        .select("id, cohort, user_id, author_label, body, bot_slug, reply_to_id, created_at")
        .eq("reply_to_id", messageId)
        .maybeSingle();
      if (duplicate) return NextResponse.json(duplicate);
    }

    console.error("[api/command2/chat/pedro] reply insert failed", error);
    return NextResponse.json({ error: "reply_insert_failed" }, { status: 500 });
  } catch (error) {
    console.error("[api/command2/chat/pedro] response failed", error);
    return NextResponse.json({ error: "pedro_failed" }, { status: 502 });
  }
}
