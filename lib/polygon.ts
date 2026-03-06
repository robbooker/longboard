import type { GainersData } from "@/types/polygon";

export async function fetchGainers(): Promise<GainersData> {
  const res = await fetch("/api/gainers", { cache: "no-store" });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to fetch gainers (${res.status})`);
  }

  return res.json();
}
