import { describe, expect, it } from "vitest";
import { chatGifFromText, chatGifFromUrl } from "../chatGifs";

describe("chat GIF links", () => {
  it("normalizes share links and strips tracking parameters", () => {
    expect(chatGifFromUrl("https://giphy.com/gifs/happy-cat-JIX9t2j0ZTN9S?utm_source=chat")?.url)
      .toBe("https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif");
  });
  it("supports direct media, embed and modern media URLs", () => {
    for (const url of ["https://media2.giphy.com/media/JIX9t2j0ZTN9S/200.gif", "https://giphy.com/embed/JIX9t2j0ZTN9S", "https://media.giphy.com/media/v1.YWJjZA==/JIX9t2j0ZTN9S/giphy.gif"]) {
      expect(chatGifFromUrl(url)?.id).toBe("JIX9t2j0ZTN9S");
    }
  });
  it("does not embed arbitrary hosts, credentials, protocols or paths", () => {
    for (const url of ["http://giphy.com/gifs/JIX9t2j0ZTN9S", "https://giphy.com.evil.test/gifs/JIX9t2j0ZTN9S", "https://evil.test/cat.gif", "https://me@giphy.com/gifs/JIX9t2j0ZTN9S", "javascript:alert(1)", "https://giphy.com:8080/gifs/JIX9t2j0ZTN9S", "https://giphy.com/explore/cats", "https://giphy.com/gifs/%2e%2e", "https://media.giphy.com/media/JIX9t2j0ZTN9S/file.svg"]) expect(chatGifFromUrl(url)).toBeNull();
  });
  it("finds one GIF alongside captions and other links without altering stored text", () => {
    expect(chatGifFromText("Nice! https://example.com https://giphy.com/gifs/JIX9t2j0ZTN9S. Another https://giphy.com/gifs/abcdef")?.id).toBe("JIX9t2j0ZTN9S");
    expect(chatGifFromText("Just a message")).toBeNull();
  });
});
