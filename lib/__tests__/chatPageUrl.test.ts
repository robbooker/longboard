import { expect, it } from "vitest";
import { chatPageId, chatPageName } from "@/lib/chatPageUrl";
import { chatPagePath, chatPopoutPath } from "@/lib/chatPopout";
import { chatPhoneDeepLink } from "@/lib/chatPhoneNav";

const builtIn = ["faq", "gainers-table", "news-feed", "reader", "new"];
const pages = [{ id: "0b785d41-7f0b-4365-8ce5-594c45dd956c", slug: "house-rules" }];

it("#441: a page's address names it the way its pop-out does", () => {
  for (const page of ["news-feed", "gainers-table", "faq", "reader", "house-rules"]) {
    const main = new URL(chatPagePath(page), "https://x.test");
    const popout = new URL(chatPopoutPath({ kind: "page", room: "gainers", page }), "https://x.test");
    expect(main.pathname).toBe("/chat");
    expect(main.searchParams.get("page")).toBe(popout.searchParams.get("page"));
    expect(main.searchParams.has("room")).toBe(false);
  }
  expect(chatPagePath("news-feed")).toBe("/chat?page=news-feed");
});

it("#441: page ids and ?page= names round-trip", () => {
  expect(chatPageName("news-feed", null, builtIn)).toBe("news-feed");
  expect(chatPageName(pages[0].id, pages, builtIn)).toBe("house-rules");
  expect(chatPageName(pages[0].id, null, builtIn)).toBe(null);
  expect(chatPageId("house-rules", pages, builtIn)).toBe(pages[0].id);
  expect(chatPageId("reader", pages, builtIn)).toBe("reader");
  expect(chatPageId("nope", pages, builtIn)).toBe(null);
});

it("#441: a page link on a phone opens the page, with the list under it", () => {
  expect(chatPhoneDeepLink("/chat?page=news-feed")).toBe(true);
});
