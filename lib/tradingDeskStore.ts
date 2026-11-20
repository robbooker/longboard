// #469 Trading Desk: the one saved snapshot (the latest the home computer sent). Server only, service
// role only (supabase/migrations/20261120120000_chat_trading_desk_snapshot.sql). Before that migration
// is applied, reads find nothing (the desk shows its sample) and saves answer "unavailable".
import type { SupabaseClient } from "@supabase/supabase-js";
import { createChatAdminClient } from "@/lib/chatAdmin";
import type { TradeZeroFeed } from "@/lib/tradeZeroFeed";
import { parseTradingDeskSnapshot } from "@/lib/tradingDeskFeed";

export type StoredDeskSnapshot = { feed: TradeZeroFeed; receivedAt: string };

/** The latest snapshot, checked again on the way out; null when there is none (or it can't be read). */
export async function readDeskSnapshot(db: SupabaseClient | null = createChatAdminClient()): Promise<StoredDeskSnapshot | null> {
  if (!db) return null;
  try {
    const { data, error } = await db.from("chat_trading_desk_snapshot").select("snapshot, received_at").eq("id", true).maybeSingle();
    if (error || !data) return null;
    const feed = parseTradingDeskSnapshot(data.snapshot, Number.POSITIVE_INFINITY);
    return feed ? { feed, receivedAt: String(data.received_at) } : null;
  } catch {
    return null;
  }
}

/** Replaces the saved snapshot with this one (already checked by parseTradingDeskSnapshot). */
export async function saveDeskSnapshot(feed: TradeZeroFeed, db: SupabaseClient | null = createChatAdminClient()): Promise<"saved" | "unavailable"> {
  if (!db) return "unavailable";
  try {
    const { error } = await db.rpc("save_chat_trading_desk_snapshot", { p_snapshot: feed });
    return error ? "unavailable" : "saved";
  } catch {
    return "unavailable";
  }
}
