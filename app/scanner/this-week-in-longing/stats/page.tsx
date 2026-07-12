import type { Metadata } from "next";
import LongingStatsClient from "./LongingStatsClient";

export const metadata: Metadata = {
  title: "This Week in Longing — Stats | Longboard",
  description: "Timing, liquidity, and follow-through statistics for Longboard 5-minute RVOL signals.",
};

export default function ThisWeekInLongingStatsPage() {
  return <LongingStatsClient />;
}
