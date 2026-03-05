import { createClient } from "@supabase/supabase-js";
import type { TickerResearch } from "@/types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function submitTickerResearch(ticker: string): Promise<TickerResearch> {
  const { data, error } = await supabase
    .from("ticker_research")
    .insert({ ticker: ticker.toUpperCase(), status: "pending" })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export function subscribeToResearch(
  id: string,
  onUpdate: (row: TickerResearch) => void
) {
  return supabase
    .channel(`research:${id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "ticker_research",
        filter: `id=eq.${id}`,
      },
      (payload) => onUpdate(payload.new as TickerResearch)
    )
    .subscribe();
}
