import type { Metadata } from "next";
import ThankYou from "@/components/home/ThankYou";

export const metadata: Metadata = {
  title: "Welcome to the Brief — Longboard",
  description: "You're in. Your first morning brief lands at 9:15 AM Eastern.",
};

export default function Page() {
  return <ThankYou />;
}
