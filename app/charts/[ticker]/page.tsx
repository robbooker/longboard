import type { Metadata } from "next";
import StackChartsWorkspace from "@/components/charts/StackChartsWorkspace";
import "@/components/charts/stack-charts.css";

type Props = {
  params: Promise<{ ticker: string }>;
};

export const dynamic = "force-dynamic";

function normalizeTicker(input: string | undefined): string {
  const ticker = (input ?? "").trim().replace(/^\$/, "").toUpperCase();
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(ticker) ? ticker : "NVDA";
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ticker } = await params;
  const symbol = normalizeTicker(ticker);
  return {
    title: `${symbol} · The Stack · Longboard Charts`,
    description: `${symbol} across preset 1m, 5m, and 4h Longboard charts.`,
  };
}

export default async function SymbolChartsPage({ params }: Props) {
  const { ticker } = await params;
  return <StackChartsWorkspace initialSymbol={normalizeTicker(ticker)} />;
}
