"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  batches,
  keyOf,
  ReactionsContext,
  request,
  saveReaction,
  summaryStore,
  type ReactionSummary,
  type ReactionTarget,
} from "./MessageReactions";

// #336: supplies MessageReactions for the links on a shared Pages list, in place of the chat's
// provider (which follows rooms and DMs). The list's own read seeds it; while the page is in front
// of the member, the links on screen are read again every 5 s, the chat's pace when it has no live
// connection, so other people's reactions show up. Nothing runs once the page is closed or hidden.

const REREAD_MS = 5000;

export default function LinkReactionProvider({
  seed,
  children,
}: {
  seed: Record<string, ReactionSummary[]> | null;
  children: ReactNode;
}) {
  const [store] = useState(summaryStore);
  const targets = useRef(new Map<string, { target: ReactionTarget; count: number }>());
  const version = useRef(0);
  const reading = useRef(false);
  const alive = useRef(true);
  // The list's own answer shows the chips at once; a link it has no reactions for needs no entry.
  useEffect(() => {
    if (!seed) return;
    store.update((current) => ({
      ...current,
      ...Object.fromEntries(Object.entries(seed).map(([id, rows]) => [keyOf({ kind: "link", messageId: id }), rows])),
    }));
  }, [seed, store]);
  const read = useCallback(async () => {
    const list = [...targets.current.values()].map(({ target }) => target);
    if (reading.current || document.hidden || !list.length) return;
    reading.current = true;
    const revision = version.current;
    try {
      await Promise.all(
        batches(list).map(async (batch) => {
          const result = await request({ kind: "link", action: "read", messageIds: batch.map((t) => t.messageId) });
          // Not over a tap made while this read was out.
          if (alive.current && revision === version.current)
            store.update((current) => ({
              ...current,
              ...Object.fromEntries(batch.map((t) => [keyOf(t), result[t.messageId] ?? []])),
            }));
        }),
      );
    } catch {
      // What's on screen stays; the next read tries again.
    } finally {
      reading.current = false;
    }
  }, [store]);
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => void read(), REREAD_MS);
    const visible = () => void read();
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [read]);
  const context = useMemo(
    () => ({
      store,
      register: (target: ReactionTarget) => {
        const key = keyOf(target);
        const item = targets.current.get(key);
        targets.current.set(key, { target, count: (item?.count ?? 0) + 1 });
        return () => {
          const item = targets.current.get(key);
          if (item && item.count > 1) item.count--;
          else targets.current.delete(key);
        };
      },
      set: async (target: ReactionTarget, emoji: ReactionSummary["emoji"], active: boolean) => {
        version.current++;
        const result = await saveReaction(target, emoji, active);
        version.current++;
        if (alive.current) store.update((current) => ({ ...current, [keyOf(target)]: result[target.messageId] ?? [] }));
      },
    }),
    [store],
  );
  return <ReactionsContext.Provider value={context}>{children}</ReactionsContext.Provider>;
}
