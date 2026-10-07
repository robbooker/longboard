"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useChatActivity } from "./hooks/useChatActivity";

const Context = createContext<ReturnType<typeof useChatActivity> | null>(null);
export function ChatActivityProvider({ memberId, children }: { memberId?: string; children: ReactNode }) {
  const activity = useChatActivity(memberId);
  return <Context.Provider value={activity}>{children}</Context.Provider>;
}
export function useSharedChatActivity() {
  const activity = useContext(Context);
  if (!activity) throw new Error("Chat activity provider required");
  return activity;
}
