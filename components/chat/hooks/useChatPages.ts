"use client";
import { useCallback, useEffect, useState } from "react";
import type { ChatPage } from "@/lib/chatPages";

// LB-PAGES (#321): the sidebar's page list, read once per member (and again after an admin adds
// or removes a page). Guests and signed-out visitors never ask.

/** The page on screen, tied to the room selection it was opened at: any other room, DM or
 * search selection moves roomSelection on, which closes the page without extra wiring. */
export type OpenChatPage = { id: string; at: number };

/** The admin's "add a page" form shows in the page area under this id. */
export const NEW_CHAT_PAGE = "new";

export function useChatPages(enabled: boolean, memberId: string | undefined) {
  const [pages, setPages] = useState<ChatPage[] | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !memberId) {
      setPages(null);
      setCanManage(false);
      return;
    }
    const controller = new AbortController();
    fetch("/api/chat/pages", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { pages?: ChatPage[]; canManage?: boolean } | null) => {
        if (controller.signal.aborted) return;
        setPages(Array.isArray(body?.pages) ? body.pages : null);
        setCanManage(body?.canManage === true);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [enabled, memberId, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { pages, canManage, reload };
}
