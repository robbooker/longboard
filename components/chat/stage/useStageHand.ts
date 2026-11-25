"use client";
// #508: "Raise hand" for one room's live video. Everything the desktop stage's top bar and the
// admin's "Hands up" list need, and nothing tied to either: the phone viewing room can use the same
// hook. The hands themselves come from the live video connection (stageHandStore.ts); raising and
// lowering go through /api/chat/stage/hand, and the answer arrives back over that connection.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ChatRoom } from "@/lib/publicChat";
import { stageHandMember, stageHands, type StageHand } from "@/lib/chatStageHand";
import { noStageHands, stageHandsSnapshot, subscribeStageHands } from "./stageHandStore";

export type StageHandState = {
  /** This viewer is connected to the room's live video, so a hand can be raised. */
  connected: boolean;
  /** This viewer's own hand is up (in this tab or another of theirs). */
  raised: boolean;
  /** How many people have a hand up (a person watching in two tabs counts once). */
  count: number;
  /** Who, oldest first. Only ever filled for an admin: a member's page keeps no names. */
  hands: readonly StageHand[];
  busy: boolean;
  error: string;
  /** Raise or lower this viewer's own hand. */
  toggle: () => void;
  /** Admin: lower one person's hand. */
  lower: (hand: StageHand) => void;
  /** Admin: lower every hand. */
  lowerAll: () => void;
};

/** How long a just-pressed button shows what was asked for while LiveKit's own word is on its way. */
const WISH_MS = 4_000;

export function useStageHand(room: ChatRoom, admin: boolean): StageHandState {
  const videoRoom = `chat-${room}`;
  const snapshot = useSyncExternalStore(subscribeStageHands, () => stageHandsSnapshot(videoRoom), noStageHands);
  const { identity, participants } = snapshot;
  const all = useMemo(() => stageHands(participants), [participants]);
  const me = identity ? stageHandMember(identity) : null;
  // A connection of this page's that was lost with its hand up: until LiveKit drops it, that hand is
  // not this viewer's any more (a fresh connection starts with the hand down), and it is lowered.
  const [stale, setStale] = useState<readonly string[]>([]);
  const mine = useMemo(
    () => (me ? (all.find((hand) => hand.member === me)?.identities ?? []).filter((id) => !stale.includes(id)) : []),
    [all, me, stale],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [wish, setWish] = useState<boolean | null>(null);
  const actual = mine.length > 0;
  useEffect(() => {
    if (wish === null) return;
    if (wish === actual) return setWish(null);
    const timer = setTimeout(() => setWish(null), WISH_MS);
    return () => clearTimeout(timer);
  }, [wish, actual]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/chat/stage/hand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ room, ...body }),
      });
      if (response.ok) return "";
      const answer = (await response.json().catch(() => null)) as { error?: unknown } | null;
      return typeof answer?.error === "string" ? answer.error : "failed";
    },
    [room],
  );

  // This page's previous connection, and whether its hand was up when it went.
  const last = useRef<{ identity: string | null; raised: boolean }>({ identity: null, raised: false });
  useEffect(() => {
    const before = last.current;
    if (before.identity && before.identity !== identity) {
      setWish(null);
      setError("");
      if (before.raised) {
        const gone = before.identity;
        setStale((list) => [...list.slice(-4), gone]);
        void post({ identities: [gone], raised: false }).catch(() => undefined);
      }
      last.current = { identity: null, raised: false };
    }
    if (identity) last.current = { identity, raised: participants.some((p) => p.identity === identity && p.hand) };
  }, [identity, participants, post]);

  const run = useCallback(
    async (body: Record<string, unknown>, failed: string, done?: () => void) => {
      setBusy(true);
      setError("");
      try {
        const problem = await post(body);
        if (!problem) return done?.();
        setError(
          problem === "not_live"
            ? "You can raise a hand once the live video is playing."
            : problem === "rate_limited"
              ? "That was a lot of hand raising. Give it a minute."
              : failed,
        );
      } catch {
        setError(failed);
      } finally {
        setBusy(false);
      }
    },
    [post],
  );

  const raised = wish ?? actual;
  const toggle = useCallback(() => {
    if (!identity || busy) return;
    if (raised)
      void run({ identities: mine.length ? mine : [identity], raised: false }, "Couldn’t lower your hand. Please try again.", () => setWish(false));
    else void run({ identity, raised: true }, "Couldn’t raise your hand. Please try again.", () => setWish(true));
  }, [identity, busy, raised, mine, run]);
  const lower = useCallback(
    (hand: StageHand) => void run({ identities: hand.identities, raised: false }, "Couldn’t lower that hand. Please try again."),
    [run],
  );
  const lowerAll = useCallback(() => void run({ all: true, raised: false }, "Couldn’t lower the hands. Please try again."), [run]);

  // A member's own hand counts at once, before LiveKit's word arrives, so the count never lags the button.
  return {
    connected: !!identity,
    raised,
    count: me ? all.filter((hand) => hand.member !== me).length + (raised ? 1 : 0) : all.length,
    hands: admin ? all : [],
    busy,
    error,
    toggle,
    lower,
    lowerAll,
  };
}
