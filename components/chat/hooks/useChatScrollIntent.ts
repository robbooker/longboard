"use client";
import { useEffect, type RefObject } from "react";
import type { ChatScrollIntent } from "@/lib/chatScrollFollow";

/** Keep held thumb/touch gestures alive, then allow a brief native momentum tail.
 * The geometry/delta helper still rejects layout changes and no-op interactions. */
export function useChatScrollIntent(intent: RefObject<ChatScrollIntent | null>) {
  useEffect(() => {
    const state = intent;
    const finish = (event: Event) => {
      const gesture = state.current?.gesture;
      if (gesture && (gesture.kind === "touch") === event.type.startsWith("touch"))
        gesture.until = Date.now() + 1000;
    };
    const blur = () => {
      state.current = null;
    };
    const events = ["pointerup", "pointercancel", "mouseup", "touchend", "touchcancel"] as const;
    events.forEach((event) => document.addEventListener(event, finish, true));
    window.addEventListener("blur", blur);
    return () => {
      events.forEach((event) => document.removeEventListener(event, finish, true));
      window.removeEventListener("blur", blur);
      state.current = null;
    };
  }, [intent]);
}
