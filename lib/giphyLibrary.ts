import { chatGifFromUrl, type ChatGif } from "./chatGifs";

// GIPHY requires browser-side requests. This is a public client API key.
export const GIPHY_API_KEY = process.env.NEXT_PUBLIC_GIPHY_API_KEY || "";
export type LibraryGif = ChatGif & { title: string; thumbnail: string };

function mediaUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid GIF response");
  const url = new URL(value);
  if (url.protocol !== "https:" || !/^media[0-4]?\.giphy\.com$/.test(url.hostname) || url.username || url.password || url.port) throw new Error("Invalid GIF response");
  return value; // Preserve provider URLs, including query parameters.
}
export function parseLibraryGif(value: unknown): LibraryGif {
  const row = value as { id?: string; title?: string; images?: Record<string, { url?: string }> };
  if (typeof row?.id !== "string") throw new Error("Invalid GIF response");
  const gif = chatGifFromUrl(`https://giphy.com/gifs/${row?.id}`);
  if (!gif || !row.images) throw new Error("Invalid GIF response");
  return { ...gif, title: row.title || "GIF", url: mediaUrl(row.images.original?.url),
    stillUrl: mediaUrl(row.images.original_still?.url), thumbnail: mediaUrl(row.images.fixed_width_small_still?.url ?? row.images.fixed_width_still?.url) };
}
export async function loadGifs(query: string, offset: number, signal: AbortSignal) {
  const url = new URL(`https://api.giphy.com/v1/gifs/${query ? "search" : "trending"}`);
  url.search = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: "12", offset: String(offset), rating: "pg", ...(query ? { q: query, lang: "en" } : {}) }).toString();
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 429 ? "GIF search is busy. Please try again shortly." : "GIF search is unavailable. Please try again.");
  const data = await response.json();
  if (!Array.isArray(data.data)) throw new Error("GIF search is unavailable. Please try again.");
  const items: LibraryGif[] = data.data.map(parseLibraryGif);
  const nextOffset = offset + data.data.length;
  return { items, nextOffset, hasMore: items.length > 0 && nextOffset < Math.min(data.pagination?.total_count ?? nextOffset, query ? 4999 : 499) };
}
export async function loadGif(id: string, signal: AbortSignal) {
  const url = new URL(`https://api.giphy.com/v1/gifs/${encodeURIComponent(id)}`);
  url.searchParams.set("api_key", GIPHY_API_KEY);
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("GIF unavailable");
  return parseLibraryGif((await response.json()).data);
}
