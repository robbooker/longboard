const ALPACA_BASE = process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";

export async function alpacaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_API_SECRET;

  if (!key || !secret) {
    throw new Error("Alpaca API keys not configured");
  }

  const res = await fetch(`${ALPACA_BASE}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Alpaca ${path} returned ${res.status}: ${body}`);
  }

  return res.json();
}
