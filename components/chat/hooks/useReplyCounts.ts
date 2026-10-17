"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  readReplyThreads,
  replyCountIds,
  shareReplyThreads,
  type ReplyCounts,
  type ReplyThreads,
} from "@/lib/chatReplyCounts";
import { mergeReplySummaries, numberedReplyConversation } from "@/lib/chatEventStreamRows";
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
    // Counts full reads applied, so a partial read can tell one landed while it was out.
    let fullReads = 0;
    const load = async () => {
      try {
        const { counts, threads } = await readReplyThreads(
          room,
          requested.split(","),
          (path) =>
            updates ? updates.read(path) : fetch(path, { cache: "no-store", signal: controller.signal }),
          view,
        );
        if (!controller.signal.aborted && current.current === key) {
          fullReads++;
          setSnapshot((previous) => ({
            key,
            counts,
            threads: shareReplyThreads(previous.key === key ? previous.threads : NO_THREADS, threads),
          }));
        }
      } catch {
        /* Keep the last complete snapshot only within this exact scope. */
      }
    };
    // EVENT-STREAM step 2: re-read just the conversations a numbered row touched and merge their
    // summaries. A change that lands during a read is read again afterwards (never joined to the
    // read already in flight), so the last change is always covered.
    const touched = new Set<string>();
    let draining = false,
      partial = 0;
    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        while (touched.size && !controller.signal.aborted) {
          const ids = [...touched].sort();
          touched.clear();
          const before = fullReads;
          try {
            const read = await readReplyThreads(
              room,
              ids,
              (path) => updates!.read(path),
              `${view}.${++partial}`,
            );
            if (controller.signal.aborted || current.current !== key) return;
            // A full read landed meanwhile and may predate the change: read these again.
            if (before !== fullReads) {
              ids.forEach((id) => touched.add(id));
              continue;
            }
            setSnapshot((previous) => {
              if (previous.key !== key) return previous;
              const merged = mergeReplySummaries(previous, ids, read);
              return {
                key,
                counts: merged.counts,
                threads: shareReplyThreads(previous.threads, merged.threads),
              };
            });
          } catch {
            // The full read repairs it (its timer, or the next numbered change).
            updates?.refresh(load, "row");
          }
        }
      } finally {
        draining = false;
      }
    };
    // EVENT-STREAM step 2: while the room is in step its numbered rows say which conversations
    // changed, so only that conversation's summary is re-read, and the timer relaxes to five minutes.
    const stop = updates?.watch(load, ["room"], true, 10000, 60000, "rooms", room);
    if (!updates) void load();
    const ids = new Set(requested.split(","));
    const row = (event: Event) => {
      const conversation = numberedReplyConversation((event as CustomEvent).detail, room, ids);
      if (!conversation || !updates) return;
      if (conversation === "all") return updates.refresh(load, "row");
      touched.add(conversation);
      void drain();
    };
    window.addEventListener("chat-room-event", row);
    return () => {
      controller.abort();
      stop?.();
      window.removeEventListener("chat-room-event", row);
    };
  }, [room, requested, key, view, updates]);
  // Hide a previous account/thread/ID set immediately, before effect cleanup.
  return snapshot.key === key ? snapshot : { key, counts: {} as ReplyCounts, threads: NO_THREADS };
}
