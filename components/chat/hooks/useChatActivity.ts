"use client";
import { chatReadTouchesDms, emptyChatActivity, type ChatActivity } from "@/lib/chatActivity";
import { chatBellWantsLists } from "@/lib/chatBellCounters";
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
    generation = useRef(0),
    // D-212: how many open bells want the lists. While none does, reads ask for the numbers only.
    listsWanted = useRef(0),
    // #462: when this owner last got a full answer (the lists), for the repair read.
    lastFull = useRef<{ key: string; at: number } | null>(null);
  const [snapshot, setSnapshot] = useState<{ key: string; data: ChatActivity; error: string }>(() => ({
    key,
    data: emptyChatActivity,
    error: "",
  }));
  const load = useCallback(
    async (why = "direct") => {
      if (!memberId) return;
      const version = ++generation.current;
      const active = () => mounted.current && current.current === key && version === generation.current;
      try {
        // `why` is diagnostics only (sampled in server logs); it never changes what is read.
        // #462: the closed bell also asks for the lists on its first read and every few minutes,
        // so the full inbox can correct the counters' numbers (lib/chatBellCounters.ts).
        const started = Date.now();
        const lists = chatBellWantsLists(
          listsWanted.current,
          lastFull.current?.key === key ? lastFull.current.at : undefined,
          started,
        )
          ? 1
          : 0;
        const path = `/api/chat/activity?view=${encodeURIComponent(view)}&why=${encodeURIComponent(why)}&lists=${lists}`;
        const response = await (updates ? updates.read(path) : fetch(path, { cache: "no-store" }));
        const result = await response.json();
        if (!active()) return;
        if (!response.ok) throw new Error(result.error || "Notifications unavailable.");
        // A numbers-only answer (D-212) keeps the lists from the last full read; the bell asks for
        // fresh lists the moment it opens.
        if (result.lists === false)
          setSnapshot((previous) => {
            const kept = previous.key === key ? previous.data : emptyChatActivity;
            return {
              key,
              data: { ...result, mentions: kept.mentions, dms: kept.dms, reactions: kept.reactions ?? [] },
              error: "",
            };
          });
        else {
          lastFull.current = { key, at: started };
          setSnapshot({ key, data: result, error: "" });
        }
      } catch (e) {
        if (active())
          setSnapshot((previous) => ({
            key,
            data: previous.key === key ? previous.data : emptyChatActivity,
            error: e instanceof Error ? e.message : "Notifications unavailable.",
          }));
      }
    },
    [memberId, key, view, updates],
  );
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
      // #498: a room read leaves the DM inbox alone (it reloaded the DM list on every room read).
      if (updates)
        updates.invalidate(
          ...(chatReadTouchesDms(body) ? (["activity", "inbox"] as const) : (["activity"] as const)),
        );
      else await load();
      if (!mounted.current || current.current !== key)
        throw new Error("Your chat session changed. Please try again.");
    },
    [key, memberId, load, updates],
  );
  const wantLists = useCallback(
    (wanted: boolean) => {
      listsWanted.current = Math.max(0, listsWanted.current + (wanted ? 1 : -1));
      if (wanted) void load("lists");
    },
    [load],
  );
  useEffect(() => {
    mounted.current = true;
    // Never the 2-second fast lane: unread badges refresh on room and DM signals (at most every 5 s),
    // so the timer is only a safety net (10 s without a live connection, 30 s with one).
    const stop = memberId ? updates?.watch(load, ["activity"], false, 10000, 30000) : undefined;
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
    wantLists,
  };
}
