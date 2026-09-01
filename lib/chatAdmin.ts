import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { requireAdmin, type AuthedUser } from "@/lib/auth";

export type PublicRoomState = {
  isOpen: boolean;
  pausedAt: string | null;
  notice: string | null;
  updatedAt: string;
};

export type ChatOwnerResult =
  | { ok: true; user: AuthedUser; admin: SupabaseClient }
  | { ok: false; status: 401 | 403 | 500; error: string };

export function createChatAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function readPublicRoomState(admin = createChatAdminClient()): Promise<PublicRoomState> {
  if (!admin) throw new Error("chat_server_not_configured");
  const { data, error } = await admin
    .from("longboard_chat_room_state")
    .select("is_open, paused_at, pause_reason, updated_at")
    .eq("id", 1)
    .single();
  if (error || !data) throw new Error("chat_room_state_unavailable");
  return {
    isOpen: Boolean(data.is_open),
    pausedAt: typeof data.paused_at === "string" ? data.paused_at : null,
    notice: typeof data.pause_reason === "string" && data.pause_reason.trim()
      ? data.pause_reason.trim()
      : null,
    updatedAt: data.updated_at,
  };
}

export async function requireChatOwner(req: NextRequest): Promise<ChatOwnerResult> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth;
  const admin = createChatAdminClient();
  if (!admin) return { ok: false, status: 500, error: "server_not_configured" };

  const { data, error } = await admin
    .from("longboard_chat_owners")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "owner_lookup_failed" };
  if (!data) return { ok: false, status: 403, error: "chat_owner_only" };
  return { ok: true, user: auth.user, admin };
}

export function requestOriginAllowed(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return Boolean(requestHost && originUrl.host === requestHost);
  } catch {
    return false;
  }
}
