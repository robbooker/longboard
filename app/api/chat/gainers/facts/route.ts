import { createChatAdminClient } from "@/lib/chatAdmin";
import { gainersAuthorized } from "@/lib/chatGainers";
import { easternDay, factsNeeded, parseGainersFacts, type GainersTableDbRow } from "@/lib/chatGainersFacts";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** #371: the lookup program's own token. It reaches only this route: today's tickers and their facts. */
function refused(request: NextRequest) {
  const secret = process.env.CHAT_GAINERS_LOOKUP_TOKEN;
  if (!secret || secret.length < 32) return json({ error: "lookup_not_configured" }, 503);
  if (!gainersAuthorized(request.headers.get("authorization"), secret))
    return json({ error: "unauthorized" }, 401);
  return null;
}

/** GET: today's (Eastern) gainers tickers that still need a lookup, newest alert first. */
export async function GET(request: NextRequest) {
  const denied = refused(request);
  if (denied) return denied;
  const db = createChatAdminClient();
  if (!db) return json({ error: "lookup_unavailable" }, 503);
  const day = easternDay();
  const { data, error } = await db.rpc("chat_gainers_table", { p_day: day });
  if (error) return json({ error: "lookup_unavailable" }, 503);
  const now = Date.now();
  const needs = ((data ?? []) as GainersTableDbRow[]).flatMap((row) => {
    const fields = factsNeeded(row, now);
    return fields ? [{ ticker: row.ticker, fields }] : [];
  });
  return json({ day, needs });
}

/** POST: one ticker's lookup result. Saving never replaces a known value with an empty one. */
export async function POST(request: NextRequest) {
  const denied = refused(request);
  if (denied) return denied;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? ""))
    return json({ error: "invalid_content_type" }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "invalid_json" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        return json({ error: "payload_too_large" }, 413);
      }
      chunks.push(value);
    }
  } catch {
    return json({ error: "invalid_body" }, 400);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const facts = parseGainersFacts(payload);
  if (!facts) return json({ error: "invalid_facts" }, 400);
  const db = createChatAdminClient();
  if (!db) return json({ error: "lookup_unavailable" }, 503);
  const { error } = await db.rpc("save_chat_gainers_facts", {
    p_ticker: facts.ticker,
    p_country: facts.country,
    p_cash_usd: facts.cashUsd,
    p_cash_months_left: facts.cashMonthsLeft,
    p_cash_flow_positive: facts.cashFlowPositive,
    p_inst_own_pct: facts.instOwnPct,
    p_not_found: facts.notFound,
  });
  if (error) return json({ error: "lookup_unavailable" }, 503);
  return json({ saved: true, ticker: facts.ticker });
}
