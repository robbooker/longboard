import { borrowFromDb, type GainersBorrow, type GainersBorrowDbRow } from "@/lib/chatGainersBorrow";

type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/**
 * #373: that day's borrow checks by ticker. Never throws: when they can't be read (or the migration
 * isn't applied yet) it returns null, and callers carry on without them.
 */
export async function borrowForDay(db: RpcClient, day: string): Promise<Map<string, GainersBorrow> | null> {
  try {
    const { data, error } = await db.rpc("chat_gainers_borrow_day", { p_day: day });
    if (error || !Array.isArray(data)) return null;
    return new Map((data as GainersBorrowDbRow[]).map((row) => [row.ticker, borrowFromDb(row)]));
  } catch {
    return null;
  }
}
