"use client";

import { useEffect, useState } from "react";
import Command2Nav from "@/components/command2/Command2Nav";
import { type Command2MenuUser } from "@/components/command2/Command2UserMenu";
import { computeLiveTime, FALLBACK_LIVE_TIME, type LiveTime } from "@/components/command2/liveTime";

// Thin client wrapper over Command2Nav for surfaces that don't already
// own a live-time poller. /command2 has its own (CommandCenterV2 needs
// the same clock for its ticker strip + page header), so it uses
// Command2Nav directly. Other surfaces — essay detail pages, future
// public read-only views — render this and get the ticking nav for free.

type Props = {
  currentUser: Command2MenuUser | null;
  activeTab?: "command" | "charts" | "learn" | "settings";
};

export default function Command2NavLive({ currentUser, activeTab }: Props) {
  const [mounted, setMounted] = useState(false);
  const [live, setLive] = useState<LiveTime>(FALLBACK_LIVE_TIME);

  useEffect(() => {
    setMounted(true);
    const tick = () => setLive(computeLiveTime());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const display = mounted ? live : FALLBACK_LIVE_TIME;

  return <Command2Nav activeTab={activeTab} currentUser={currentUser} live={display} />;
}
