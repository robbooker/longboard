import * as Ably from "ably";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,9}$/;

function sanitizeTicker(input: string | null): string | null {
  if (!input) return null;
  const ticker = input.trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

export async function GET(request: NextRequest) {
  const ticker = sanitizeTicker(request.nextUrl.searchParams.get("symbol"));
  const resolution = request.nextUrl.searchParams.get("res") ?? "1m";

  if (!ticker) {
    return NextResponse.json(
      { error: "invalid_symbol" },
      { status: 400 },
    );
  }

  if (resolution !== "1m") {
    return NextResponse.json(
      { error: "unsupported_resolution" },
      { status: 400 },
    );
  }

  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ably_not_configured" },
      { status: 503 },
    );
  }

  const channel = `private:chart:${ticker}:1m`;
  let tokenDetails: Awaited<ReturnType<Ably.Rest["auth"]["requestToken"]>>;
  try {
    const rest = new Ably.Rest(apiKey);
    tokenDetails = await rest.auth.requestToken({
      clientId: `chart-${ticker.toLowerCase()}`,
      capability: { [channel]: ["subscribe"] },
      ttl: 10 * 60 * 1000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `ably_token_request_failed: ${message}` },
      { status: 502 },
    );
  }

  return NextResponse.json(tokenDetails, {
    headers: { "cache-control": "no-store" },
  });
}
