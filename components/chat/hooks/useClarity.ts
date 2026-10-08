"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type ClarityReviewResult = {
  intent: string;
  suggestedMessage: string;
  whyChanged: string;
  ambiguityDetected: boolean;
  ambiguityNote: string | null;
};
export type ClarityOriginal = {
  message_id: string;
  original_body: string;
  suggested_body: string | null;
  intent: string | null;
  why_changed: string | null;
  ambiguity_note: string | null;
  used_suggestion: boolean;
};
/** Sent with the final DM so the server can store the sender-only record. */
export type ClarityPayload = {
  original: string;
  suggested: string | null;
  intent: string | null;
  whyChanged: string | null;
  ambiguityNote: string | null;
  usedSuggestion: boolean;
};
export type ClarityReviewState = {
  /** The exact draft that was reviewed; the review is discarded if the draft changes. */
  draft: string;
  result: ClarityReviewResult;
  suggestion: string;
  variant: number;
};

/**
 * "Make clearer" for the Liz <-> Rob DM. Availability comes from the server, which answers
 * 404 for every other conversation. Late responses are ignored once the conversation or the
 * draft changes, and nothing here ever sends a message.
 */
export function useClarity(conversationId: string | null, draft: string) {
  const [enabled, setEnabled] = useState(false);
  const [originals, setOriginals] = useState<Record<string, ClarityOriginal>>({});
  const [review, setReview] = useState<ClarityReviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const current = useRef({ conversationId, draft });
  current.current = { conversationId, draft };

  const refresh = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      const response = await fetch(`/api/chat/clarity?conversation=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      if (current.current.conversationId !== id) return;
      if (!response.ok) {
        setEnabled(false);
        setOriginals({});
        return;
      }
      const data = (await response.json()) as { originals?: ClarityOriginal[] };
      setEnabled(true);
      setOriginals(Object.fromEntries((data.originals ?? []).map((row) => [row.message_id, row])));
    } catch {
      /* Keep the last known state; the composer still works without the feature. */
    }
  }, []);

  useEffect(() => {
    request.current++;
    setEnabled(false);
    setOriginals({});
    setReview(null);
    setBusy(false);
    setError("");
    void refresh(conversationId);
  }, [conversationId, refresh]);

  // Editing the draft after a review invalidates that review.
  useEffect(() => {
    setReview((value) => (value && value.draft !== draft ? null : value));
  }, [draft]);

  const makeClearer = useCallback(async (variant = 0) => {
    const id = current.current.conversationId;
    const text = current.current.draft;
    if (!id || !text.trim()) return;
    const token = ++request.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/chat/clarity/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, draft: text, variant }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "The review couldn't run. Your draft is unchanged.");
      // A newer request, a room switch or an edited draft all make this response stale.
      if (
        token !== request.current ||
        current.current.conversationId !== id ||
        current.current.draft !== text
      )
        return;
      const result = data.result as ClarityReviewResult;
      setReview({ draft: text, result, suggestion: result.suggestedMessage, variant });
    } catch (e) {
      if (token === request.current) setError(e instanceof Error ? e.message : "The review couldn't run.");
    } finally {
      if (token === request.current) setBusy(false);
    }
  }, []);

  const cancel = useCallback(() => {
    request.current++;
    setBusy(false);
    setReview(null);
    setError("");
  }, []);

  const payload = useCallback(
    (usedSuggestion: boolean): ClarityPayload | null =>
      review
        ? {
            original: review.draft,
            suggested: review.result.suggestedMessage,
            intent: review.result.intent,
            whyChanged: review.result.whyChanged,
            ambiguityNote: review.result.ambiguityNote,
            usedSuggestion,
          }
        : null,
    [review],
  );

  return {
    enabled,
    originals,
    review,
    busy,
    error,
    setSuggestion: (suggestion: string) => setReview((value) => (value ? { ...value, suggestion } : value)),
    makeClearer,
    regenerate: () => makeClearer((review?.variant ?? 0) + 1),
    cancel,
    payload,
    refresh: () => refresh(conversationId),
  };
}
