import { tokenizeChatMessage } from "./publicChat";

export type ChatGif = { id: string; url: string; stillUrl: string; pageUrl: string };

/** Only derive media URLs from a GIPHY ID, never embed arbitrary user URLs. */
export function chatGifFromUrl(value: string): ChatGif | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  let id: string | undefined;
  if (["giphy.com", "www.giphy.com"].includes(url.hostname)) {
    const match = url.pathname.match(/^\/(?:gifs|embed)\/([\w-]+)\/?$/);
    id = match?.[1].split("-").at(-1);
  } else if (/^media[0-4]?\.giphy\.com$/.test(url.hostname)) {
    id = url.pathname.match(/^\/media\/(?:v1\.[A-Za-z0-9_=.-]+\/)?([A-Za-z0-9]+)\/[A-Za-z0-9_]+\.(?:gif|webp|mp4)$/)?.[1];
  }
  if (!id || !/^[A-Za-z0-9]{6,64}$/.test(id)) return null;
  return {
    id,
    url: `https://media.giphy.com/media/${id}/giphy.gif`,
    stillUrl: `https://media.giphy.com/media/${id}/giphy_s.gif`,
    pageUrl: `https://giphy.com/gifs/${id}`,
  };
}

export function chatGifFromText(body: string): ChatGif | null {
  for (const part of tokenizeChatMessage(body)) {
    if (part.kind === "link") {
      const gif = chatGifFromUrl(part.href);
      if (gif) return gif;
    }
  }
  return null;
}
