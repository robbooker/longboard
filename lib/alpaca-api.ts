import type { AlpacaCreds } from "@/lib/brokerKeys";

/** Performs an authenticated request against the Alpaca REST API.
 *  Creds are supplied by the caller (routes decrypt them from the vault
 *  via getAlpacaCredsForUser) — we no longer read env vars here. */
export async function alpacaFetch<T>(path: string, creds: AlpacaCreds, init?: RequestInit): Promise<T> {
  const res = await fetch(`${creds.baseUrl}${path}`, {
    ...init,
    headers: {
      "APCA-API-KEY-ID": creds.apiKey,
      "APCA-API-SECRET-KEY": creds.apiSecret,
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
