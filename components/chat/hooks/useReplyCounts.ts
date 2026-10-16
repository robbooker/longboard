"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  readReplyThreads,
  replyCountIds,
  shareReplyThreads,
  type ReplyCounts,
  type ReplyThreads,
} from "@/lib/chatReplyCounts";
import { useChatIdentity, useChatUpdates } from "../ChatUpdates";
type Scope = { accountId?: string; memberId?: string; threadId?: string };
export function useReplyCounts(room: string, ids: string, initial?: ReplyCounts, scope?: Scope) {
  return useReplyThreads(room, ids, initial, scope).counts;
}
const NO_THREADS: ReplyThreads = {};
/** Reply counts plus, per thread, the latest repliers and last reply time (one read for both). */
export function useReplyThreads(
  room: string,
  ids: string,
  initial?: ReplyCounts,
  scope?: Scope,
  initialThreads?: ReplyThreads,
) {
  const updates = useChatUpdates();
  const identity = useChatIdentity();
  const requested = replyCountIds(ids).join(",");
  const owner = JSON.stringify([
    scope?.accountId ?? identity?.accountId ?? "",
    scope ? (scope.memberId ?? "") : (identity?.member?.id ?? ""),
    room,
    scope?.threadId ?? "",
    requested,
  ]);
  const instance = useId();
  const generation = useRef({ owner, number: 0 });
  if (generation.current.owner !== owner)
    generation.current = { owner, number: generation.current.number + 1 };
  // The coordinator deduplicates by URL. A new scope must not join an old read,
  // even when the same IDs return after navigating away or replacing identity.
  const view = `${instance}-${generation.current.number}`;
  const key = JSON.stringify([owner, view]);
  const current = useRef(key);
  current.current = key;
  const [snapshot, setSnapshot] = useState(() => ({
    key,
    counts: Object.fromEntries(
      replyCountIds(ids)
        .filter((id) => initial?.[id] !== undefined)
        .map((id) => [id, initial![id]]),
    ) as ReplyCounts,
    threads: Object.fromEntries(
      replyCountIds(ids)
        .filter((id) => initialThreads?.[id] !== undefined)
        .map((id) => [id, initialThreads![id]]),
    ) as ReplyThreads,
  }));
  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const { counts, threads } = await readReplyThreads(
          room,
          requested.split(","),
          (path) =>
            updates ? updates.read(path) : fetch(path, { cache: "no-store", signal: controller.signal }),
          view,
        );
        if (!controller.signal.aborted && current.current === key)
          setSnapshot((previous) => ({
            key,
            counts,
            threads: shareReplyThreads(previous.key === key ? previous.threads : NO_THREADS, threads),
          }));
      } catch {
        /* Keep the last complete snapshot only within this exact scope. */
      }
    };
    const stop = updates?.watch(load, ["room"], true, 10000, 60000);
    if (!updates) void load();
    return () => {
      controller.abort();
      stop?.();
    };
  }, [room, requested, key, view, updates]);
  // Hide a previous account/thread/ID set immediately, before effect cleanup.
  return snapshot.key === key ? snapshot : { key, counts: {} as ReplyCounts, threads: NO_THREADS };
}
