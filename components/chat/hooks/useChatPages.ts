"use client";
import { useCallback, useEffect, useState } from "react";
import type { ChatPage, ChatPageSuggestion } from "@/lib/chatPages";

// LB-PAGES (#321): the sidebar's page list, read once per member (and again after an admin adds
// or removes a page). Guests and signed-out visitors never ask.
// #329: also the member's own suggestions and, for admins, the waiting list. Coming back to the tab
// reads them again (at most once a minute), so a count or a decision shows without a reload.

/** The page on screen, tied to the room selection it was opened at: any other room, DM or
 * search selection moves roomSelection on, which closes the page without extra wiring. */
export type OpenChatPage = { id: string; at: number };

/** The "add a page" (admin) or "suggest a page" (member) form shows in the page area under this id. */
export const NEW_CHAT_PAGE = "new";
/** The admins' list of suggestions waiting for approval shows in the page area under this id. */
export const WAITING_CHAT_PAGES = "waiting";
/** #332: the FAQ page, directly under What's New; not a row in chat_pages. */
export const FAQ_CHAT_PAGE = "faq";
/** #371: the Gainers Table, directly under the Gainers room; a table, not a row in chat_pages. */
export const GAINERS_TABLE_PAGE = "gainers-table";
/** #383: the News Feed, directly under the Gainers Table, for the same members; not a row in chat_pages. */
export const NEWS_FEED_PAGE = "news-feed";
/** #385: the Reader's library (books for club members), under the News Feed; not a row in chat_pages. */
export const READER_PAGE = "reader";

const REREAD_AFTER_MS = 60_000;
/** #388: waits before each new try of a failed first read (after the last, a tab return re-reads). */
const FIRST_READ_RETRY_MS = [2_000, 5_000, 15_000];
type PagesState = { pages: ChatPage[] | null; canManage: boolean; suggestions: ChatPageSuggestion[]; waiting: ChatPageSuggestion[] };
const EMPTY: PagesState = { pages: null, canManage: false, suggestions: [], waiting: [] };

export function useChatPages(enabled: boolean, memberId: string | undefined) {
  const [state, setState] = useState<PagesState>(EMPTY);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !memberId) {
      setState(EMPTY);
      return;
    }
    const controller = new AbortController();
    let readAt = Date.now();
    let retry: ReturnType<typeof setTimeout> | undefined;
    // #388: the first read decides whether Pages shows at all, so a passing failure (the network,
    // or a busy server: 5xx or 429) is tried again a few times instead of leaving a member's Pages
    // hidden until a reload. A refusal (4xx, e.g. no chat name yet) is an answer and is not retried.
    const read = (again: boolean, attempt = 0) => {
      readAt = Date.now();
      const retryFirst = () => {
        if (again || controller.signal.aborted || attempt >= FIRST_READ_RETRY_MS.length) return false;
        retry = setTimeout(() => read(false, attempt + 1), FIRST_READ_RETRY_MS[attempt]);
        return true;
      };
      fetch("/api/chat/pages", { cache: "no-store", signal: controller.signal })
        .then((response) => {
          if (response.ok) return response.json();
          return (response.status >= 500 || response.status === 429) && retryFirst() ? undefined : null;
        })
        .then((body: Partial<PagesState> | null | undefined) => {
          if (controller.signal.aborted || body === undefined) return;
          // A failed re-read keeps what is on screen; only the first read can leave Pages hidden.
          if (again && !Array.isArray(body?.pages)) return;
          const next: PagesState = {
            pages: Array.isArray(body?.pages) ? body.pages : null,
            canManage: body?.canManage === true,
            suggestions: Array.isArray(body?.suggestions) ? body.suggestions : [],
            waiting: Array.isArray(body?.waiting) ? body.waiting : [],
          };
          // Nothing changed: keep the same objects, so the chat doesn't redraw for a re-read.
          setState((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
        })
        .catch(() => {
          retryFirst();
        });
    };
    read(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - readAt >= REREAD_AFTER_MS) read(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, memberId, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}
