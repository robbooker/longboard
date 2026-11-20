"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

// Keep Next's own history fields intact; this entry only owns the reply panel.
export function useReplyNavigation(room: string, navigationOwner?: string, local = false) {
  const generatedOwner = useId();
  const owner = navigationOwner ?? generatedOwner;
  const [target, setTarget] = useState<string | null>(null);
  const [depth, setDepth] = useState(0);
  const [stack, setStack] = useState<string[]>([]);
  const [mobile, setMobile] = useState(false);
  // #479: history.back()/go() land later (at popstate), and until then history.state still holds
  // the thread entry. Steps already asked for, so a second close in that gap (Latest closing the
  // thread, then Escape) doesn't step again and leave the chat for the page before it.
  const pendingSteps = useRef(0);
  const seenDepth = useRef(0);
  useEffect(() => {
    const media = window.matchMedia("(max-width:1099px)");
    const resize = () => setMobile(media.matches);
    resize();
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  // Before paint: a room shown again after being kept hidden (SHELL-KEEP) must not flash the
  // thread it had open; the history entry says which thread, if any, is open now.
  useLayoutEffect(() => {
    if (local) return;
    const restore = () => {
      const entry = window.history.state?.chatReply;
      const ours = entry?.owner === owner && entry?.room === room;
      const nextDepth = ours ? entry.depth : 0;
      pendingSteps.current = nextDepth
        ? Math.max(0, pendingSteps.current - Math.max(0, seenDepth.current - nextDepth))
        : 0;
      seenDepth.current = nextDepth;
      setTarget(ours ? entry.target : null);
      setDepth(nextDepth);
    };
    restore();
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
      // A room kept hidden (SHELL-KEEP) closes its thread meanwhile; showing it reads the entry again.
      pendingSteps.current = 0;
      seenDepth.current = 0;
      setTarget(null);
      setDepth(0);
    };
  }, [owner, room, local]);
  const open = useCallback(
    (id: string) => {
      if (local) {
        setStack((s) => [...s, id]);
        return;
      }
      const current = window.history.state?.chatReply;
      if (current?.owner === owner && current?.room === room && current?.target === id) return;
      const nextDepth = current?.owner === owner && current?.room === room ? current.depth + 1 : 1;
      window.history.pushState(
        { ...window.history.state, chatReply: { owner, room, target: id, depth: nextDepth } },
        "",
      );
      // A new entry: what is open is this one, whatever was asked for before it.
      pendingSteps.current = 0;
      seenDepth.current = nextDepth;
      setTarget(id);
      setDepth(nextDepth);
    },
    [owner, room, local],
  );
  // A reply reached by search or a bell alert opens with its whole chain behind it, outermost
  // first, so Back steps up one level at a time as if the reader had browsed there.
  const openPath = useCallback(
    (ids: string[]) => {
      if (local) {
        setStack((s) => [...s, ...ids.slice(ids.indexOf(s.at(-1) ?? "") + 1)]);
        return;
      }
      const current = window.history.state?.chatReply;
      const ours = current?.owner === owner && current?.room === room;
      const rest = ids.slice(ours ? ids.indexOf(current.target) + 1 : 0);
      if (!rest.length) return;
      let nextDepth = ours ? current.depth : 0;
      for (const id of rest)
        window.history.pushState(
          { ...window.history.state, chatReply: { owner, room, target: id, depth: ++nextDepth } },
          "",
        );
      pendingSteps.current = 0;
      seenDepth.current = nextDepth;
      setTarget(rest.at(-1)!);
      setDepth(nextDepth);
    },
    [owner, room, local],
  );
  // Thread levels still open once the steps already asked for have landed (null: not our entry).
  const remaining = useCallback(() => {
    const entry = window.history.state?.chatReply;
    return entry?.owner === owner && entry?.room === room ? entry.depth - pendingSteps.current : null;
  }, [owner, room]);
  const back = useCallback(() => {
    if (local) {
      setStack((s) => s.slice(0, -1));
      return;
    }
    const left = remaining();
    if (left !== null && left <= 0) return;
    if (left !== null) pendingSteps.current++;
    window.history.back();
  }, [local, remaining]);
  const close = useCallback(() => {
    if (local) {
      setStack([]);
      return;
    }
    const left = remaining();
    if (left === null) {
      setTarget(null);
      setDepth(0);
    } else if (left > 0) {
      pendingSteps.current += left;
      window.history.go(-left);
    }
  }, [local, remaining]);
  return {
    target: local ? (stack.at(-1) ?? null) : target,
    depth: local ? stack.length : depth,
    mobile: local || mobile,
    open,
    openPath,
    back,
    close,
  };
}
