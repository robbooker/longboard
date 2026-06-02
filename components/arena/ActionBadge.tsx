import type { TradeSide } from "@/lib/arena/types";

type Props = {
  side: TradeSide;
};

export default function ActionBadge({ side }: Props) {
  const cls = side.toLowerCase();
  return <span className={`action-badge ${cls}`}>{side}</span>;
}
