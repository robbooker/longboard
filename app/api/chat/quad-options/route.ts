import { NextResponse } from "next/server";
import { requireChatUser } from "@/lib/chatAuth";
import { loadCardOptions } from "@/lib/chatCardOptions.server";
export const dynamic = "force-dynamic";
// Quad and Six (#379) both read their pickers from here. gainersTable says whether the Gainers
// Table card is offered; Quad ignores it.
export async function GET() {
  const auth = await requireChatUser();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const loaded = await loadCardOptions(auth);
  if (!loaded.ok) return loaded.response;
  return NextResponse.json(
    { accountId: auth.user.id, ...loaded.options },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
