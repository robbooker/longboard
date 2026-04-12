export async function polygonFetch<T>(path: string): Promise<T> {
  const key = process.env.POLYGON_API_KEY;

  if (!key) {
    throw new Error("POLYGON_API_KEY not configured");
  }

  const res = await fetch(`https://api.polygon.io${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Polygon ${path} returned ${res.status}: ${body}`);
  }

  return res.json();
}
