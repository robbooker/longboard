export function tzAccountPath(subpath: string): string {
  const accountId = process.env.TZ_ACCOUNT_ID;
  if (!accountId) throw new Error("TZ_ACCOUNT_ID not configured");
  return subpath.replace("{id}", accountId);
}

export async function tzProxyFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = process.env.TZ_PROXY_URL;
  const apiKey = process.env.TZ_PROXY_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("TradeZero proxy not configured (TZ_PROXY_URL / TZ_PROXY_API_KEY)");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`TradeZero ${path} returned ${res.status}: ${body}`);
  }

  return res.json();
}
