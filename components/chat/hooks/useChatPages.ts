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

const REREAD_AFTER_MS = 60_000;
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
    const read = (again: boolean) => {
      readAt = Date.now();
      fetch("/api/chat/pages", { cache: "no-store", signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: Partial<PagesState> | null) => {
          if (controller.signal.aborted) return;
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
        .catch(() => {});
    };
    read(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - readAt >= REREAD_AFTER_MS) read(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, memberId, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}
