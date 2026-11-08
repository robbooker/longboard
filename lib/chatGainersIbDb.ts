import { ibFromDb, type GainersIb, type GainersIbDbRow } from "@/lib/chatGainersIb";

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * #376: Interactive Brokers' latest rate for each of these tickers. Never throws: when it can't be
 * read (or the migration isn't applied yet) it returns null, and callers carry on without it.
 */
export async function ibForTickers(db: RpcClient, tickers: string[]): Promise<Map<string, GainersIb> | null> {
  if (!tickers.length) return new Map();
  try {
    const { data, error } = await db.rpc("chat_gainers_ib_for", { p_tickers: tickers });
    if (error || !Array.isArray(data)) return null;
    return new Map((data as GainersIbDbRow[]).map((row) => [row.ticker, ibFromDb(row)]));
  } catch {
    return null;
  }
}
