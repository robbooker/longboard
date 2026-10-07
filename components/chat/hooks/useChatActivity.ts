"use client";
import { emptyChatActivity, type ChatActivity } from "@/lib/chatActivity";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useChatIdentity, useChatUpdates } from "../ChatUpdates";
export function useChatActivity(memberId?: string) {
  const updates = useChatUpdates();
  const identity = useChatIdentity(),
    instance = useId();
  const owner = JSON.stringify([identity?.accountId ?? "", memberId ?? ""]);
  const scope = useRef({ owner, number: 0 });
  if (scope.current.owner !== owner) scope.current = { owner, number: scope.current.number + 1 };
  // Keep an old coordinator read out of a new owner, including A → B → A.
  // This opaque view is stable for this mounted ownership scope, never an auth input.
  const view = `${instance}-${scope.current.number}`,
    key = JSON.stringify([owner, view]);
  const current = useRef(key);
  current.current = key;
  const mounted = useRef(false),
    generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{ key: string; data: ChatActivity; error: string }>(() => ({
    key,
    data: emptyChatActivity,
    error: "",
  }));
  const load = useCallback(async () => {
    if (!memberId) return;
    const version = ++generation.current;
    const active = () => mounted.current && current.current === key && version === generation.current;
    try {
      const path = `/api/chat/activity?view=${encodeURIComponent(view)}`;
      const response = await (updates ? updates.read(path) : fetch(path, { cache: "no-store" }));
      const result = await response.json();
      if (!active()) return;
      if (!response.ok) throw new Error(result.error || "Notifications unavailable.");
      setSnapshot({ key, data: result, error: "" });
    } catch (e) {
      if (active())
        setSnapshot((previous) => ({
          key,
          data: previous.key === key ? previous.data : emptyChatActivity,
          error: e instanceof Error ? e.message : "Notifications unavailable.",
        }));
    }
  }, [memberId, key, view, updates]);
  const read = useCallback(
    async (body: Record<string, unknown>) => {
      if (!mounted.current || current.current !== key || !memberId)
        throw new Error("Your chat session changed. Please try again.");
      const response = await fetch("/api/chat/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!mounted.current || current.current !== key)
        throw new Error("Your chat session changed. Please try again.");
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Could not mark read.");
      }
      // A GET begun before this successful mutation cannot restore its old unread state.
      generation.current++;
      if (updates) updates.invalidate("activity", "inbox");
      else await load();
      if (!mounted.current || current.current !== key)
        throw new Error("Your chat session changed. Please try again.");
    },
    [key, memberId, load, updates],
  );
  useEffect(() => {
    mounted.current = true;
    const stop = memberId ? updates?.watch(load, ["activity"], true, 10000, 30000) : undefined;
    if (memberId && !updates) void load();
    const invalidate = () => {
      mounted.current = false;
      generation.current++;
    };
    return () => {
      invalidate();
      stop?.();
    };
  }, [memberId, load, updates]);
  return {
    data: snapshot.key === key ? snapshot.data : emptyChatActivity,
    error: snapshot.key === key ? snapshot.error : "",
    read,
  };
}
