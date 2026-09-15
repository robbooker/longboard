import { afterEach, expect, it, vi } from "vitest";
import { loadGifs, parseLibraryGif } from "../giphyLibrary";
const media = "https://media2.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif?cid=provider&rid=giphy.gif";
const item = { id: "JIX9t2j0ZTN9S", title: "Cat typing", images: { original: { url: media }, original_still: { url: media }, fixed_width_small_still: { url: media } } };
afterEach(() => vi.unstubAllGlobals());
it("preserves GIPHY media URLs exactly", () => {
  expect(parseLibraryGif(item).url).toBe(media);
  expect(parseLibraryGif(item).pageUrl).toBe("https://giphy.com/gifs/JIX9t2j0ZTN9S");
});
it("rejects malformed provider data and unexpected media hosts", () => {
  expect(() => parseLibraryGif({ images: item.images })).toThrow();
  expect(() => parseLibraryGif({ ...item, images: { ...item.images, original: { url: "https://evil.test/tracker.gif" } } })).toThrow();
});
it("uses trending or exact search terms with bounded pages and a content rating", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [item], pagination: { total_count: 20 } }) });
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  const page = await loadGifs("cats & dogs", 12, signal);
  const url = fetcher.mock.calls[0][0] as URL;
  expect(url.pathname).toBe("/v1/gifs/search");
  expect(url.searchParams.get("q")).toBe("cats & dogs");
  expect(url.searchParams.get("rating")).toBe("pg");
  expect(page.nextOffset).toBe(13);
  expect(page.hasMore).toBe(true);
  await loadGifs("", 0, signal);
  expect(fetcher.mock.calls[1][0].pathname).toBe("/v1/gifs/trending");
});
it("reports rate limits without returning a broken page", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
  await expect(loadGifs("cats", 0, new AbortController().signal)).rejects.toThrow("busy");
});
