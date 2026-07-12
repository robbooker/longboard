import type { Metadata } from "next";
import ThisWeekInLongingClient from "./ThisWeekInLongingClient";

export const metadata: Metadata = {
  title: "This Week in Longing | Longboard",
  description: "Weekly performance review of Longboard 5-minute RVOL signals.",
};

export default function ThisWeekInLongingPage() {
  return <ThisWeekInLongingClient />;
}
