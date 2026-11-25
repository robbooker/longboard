"use client";
// #509: whether this screen gets the phone's viewing room for stage mode (a phone held either way
// up; rotating it does not change the answer, so the video is not restarted). `enabled` false asks
// the browser nothing.
import { useLayoutEffect, useState } from "react";
import { STAGE_PHONE_QUERY } from "@/lib/chatStageLive";

export function useStagePhone(enabled: boolean) {
  const [phone, setPhone] = useState(false);
  useLayoutEffect(() => {
    if (!enabled) {
      setPhone(false);
      return;
    }
    const media = window.matchMedia(STAGE_PHONE_QUERY);
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [enabled]);
  return phone;
}
