import type { Metadata } from "next";
import StackChartsWorkspace from "@/components/charts/StackChartsWorkspace";
import "@/components/charts/stack-charts.css";

export const metadata: Metadata = {
  title: "The Stack · Longboard Charts",
  description: "Multi-timeframe Longboard chart workspace.",
};

export const dynamic = "force-dynamic";

export default function ChartsPage() {
  return <StackChartsWorkspace initialSymbol="NVDA" />;
}
