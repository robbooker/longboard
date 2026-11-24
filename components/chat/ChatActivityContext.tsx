"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useChatActivity } from "./hooks/useChatActivity";

type SharedActivity = ReturnType<typeof useChatActivity> & { memberId?: string };
const Context = createContext<SharedActivity | null>(null);
/**
 * #494: a provider inside another one for the same member (each Six view card inside the Six view's
 * own, which feeds its toolbar bell) uses the outer one, so the page reads the bell once, not once
 * per card. The tree is the same either way, so nothing below remounts.
 */
export function ChatActivityProvider({ memberId, children }: { memberId?: string; children: ReactNode }) {
  const outer = useContext(Context);
  const shared = !!memberId && outer?.memberId === memberId;
  const own = useChatActivity(shared ? undefined : memberId);
  return <Context.Provider value={shared ? outer : { ...own, memberId }}>{children}</Context.Provider>;
}
export function useSharedChatActivity() {
  const activity = useContext(Context);
  if (!activity) throw new Error("Chat activity provider required");
  return activity;
}
/** The shared activity when there is one (the bell also renders outside the chat shell in tests). */
export function useOptionalSharedChatActivity() {
  return useContext(Context);
}
