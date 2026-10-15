"use client";
import type { ChatRoom, PublicChatRoomState } from "@/lib/publicChat";
import { useEffect, useRef, useState } from "react";
import type { ActionState } from "./types";

type AdminSummary = {
  id: string;
  summary_date: string;
  message_count: number;
  model: string;
  summary_text: string;
  updated_at: string;
};

type AdminResponse = {
  isOwner?: boolean;
  room?: PublicChatRoomState;
  summaries?: AdminSummary[];
  // A summary run, or a ShortScout sync's counts.
  result?: { status?: string; summary?: AdminSummary; allow?: number; deny?: number; unavailable?: number };
  error?: string;
};

async function invokeAdmin(room: ChatRoom, body?: Record<string, unknown>): Promise<AdminResponse> {
  const response = await fetch(
    `/api/chat/admin?room=${room}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const result = (await response.json().catch(() => ({}))) as AdminResponse;
  if (response.ok) return result;
  throw new Error(result.error || "The chat admin service did not respond.");
}

/** Owner controls for a room: pause/reopen, the private summary and the ShortScout sync. */
export function useRoomAdmin({
  room,
  roomLabel,
  isAdmin,
  pane,
  setRoomStatus,
}: {
  room: ChatRoom;
  roomLabel: string;
  isAdmin: boolean;
  pane: boolean;
  setRoomStatus: (room: PublicChatRoomState) => void;
}) {
  const [isOwner, setIsOwner] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminState, setAdminState] = useState<ActionState>("default");
  const [adminAction, setAdminAction] = useState<"room" | "summary" | "shortscout" | null>(null);
  const [adminFeedback, setAdminFeedback] = useState("");
  const [adminReason, setAdminReason] = useState("");
  const [summaries, setSummaries] = useState<AdminSummary[]>([]);
  const adminTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isAdmin || pane) return;
    void invokeAdmin(room)
      .then((result) => {
        if (cancelled || !result.isOwner) return;
        setIsOwner(true);
        if (result.room) setRoomStatus(result.room);
        setSummaries(result.summaries ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [room, isAdmin, pane, setRoomStatus]);

  useEffect(
    () => () => {
      if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    },
    [],
  );

  async function setRoomOpen(isOpen: boolean) {
    if (adminAction) return;
    if (
      !isOpen &&
      !window.confirm(`Pause ${roomLabel} now? History stays readable. The other room remains available.`)
    ) {
      return;
    }
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    setAdminState("loading");
    setAdminAction("room");
    setAdminFeedback(isOpen ? "Reopening chat…" : "Pausing chat…");
    try {
      const result = await invokeAdmin(room, { action: "set_room_open", isOpen, reason: adminReason });
      if (!result.room) throw new Error("The room state did not update.");
      setRoomStatus(result.room);
      if (isOpen) setAdminReason("");
      setAdminState("success");
      setAdminFeedback(
        isOpen ? "Chat reopened. New participation is enabled." : "Chat paused. History remains readable.",
      );
      setAdminAction(null);
      adminTimerRef.current = setTimeout(() => {
        setAdminState("default");
        setAdminFeedback("");
      }, 2400);
    } catch (caught) {
      setAdminFeedback(caught instanceof Error ? caught.message : "The room state did not update.");
      setAdminState("error");
      setAdminAction(null);
    }
  }

  async function summarizeNow() {
    if (adminAction) return;
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    setAdminState("loading");
    setAdminAction("summary");
    setAdminFeedback("Creating a private summary…");
    try {
      const result = await invokeAdmin(room, { action: "summarize_now" });
      const refreshed = await invokeAdmin(room);
      setSummaries(refreshed.summaries ?? (result.result?.summary ? [result.result.summary] : summaries));
      setAdminState("success");
      setAdminFeedback(
        result.result?.status === "no_messages"
          ? "There are no messages to summarize for today."
          : "Today’s private summary is ready.",
      );
      setAdminAction(null);
      adminTimerRef.current = setTimeout(() => {
        setAdminState("default");
        setAdminFeedback("");
      }, 2400);
    } catch (caught) {
      setAdminFeedback(caught instanceof Error ? caught.message : "Buddy could not create the summary.");
      setAdminState("error");
      setAdminAction(null);
    }
  }

  // Owners' Sync now (A6): re-check every ShortScout member straight away, e.g. after a removal.
  async function syncShortScout() {
    if (adminAction) return;
    if (adminTimerRef.current) clearTimeout(adminTimerRef.current);
    setAdminState("loading");
    setAdminAction("shortscout");
    setAdminFeedback("Checking every ShortScout member…");
    try {
      const { result } = await invokeAdmin(room, { action: "sync_shortscout" });
      setAdminState(result?.unavailable ? "error" : "success");
      setAdminFeedback(
        `ShortScout synced: ${result?.allow ?? 0} active, ${result?.deny ?? 0} removed` +
          (result?.unavailable ? `, ${result.unavailable} could not be checked (try again)` : "") +
          ".",
      );
      setAdminAction(null);
      if (!result?.unavailable)
        adminTimerRef.current = setTimeout(() => {
          setAdminState("default");
          setAdminFeedback("");
        }, 6000);
    } catch (caught) {
      setAdminFeedback(caught instanceof Error ? caught.message : "Could not sync ShortScout members.");
      setAdminState("error");
      setAdminAction(null);
    }
  }

  return {
    isOwner,
    adminOpen,
    setAdminOpen,
    adminState,
    adminAction,
    adminFeedback,
    adminReason,
    setAdminReason,
    summaries,
    setRoomOpen,
    summarizeNow,
    syncShortScout,
  };
}

export type RoomAdmin = ReturnType<typeof useRoomAdmin>;
