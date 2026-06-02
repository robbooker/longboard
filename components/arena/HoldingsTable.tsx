import { fmtPct, fmtQty, fmtUSD, fmtWeight, pctClass } from "@/lib/arena/format";
import type { Position } from "@/lib/arena/types";

type Props = {
  positions: Position[];
};

export default function HoldingsTable({ positions }: Props) {
  if (positions.length === 0) {
    return <p className="feed-card-meta">No open positions.</p>;
  }

  return (
    <div className="holdings-wrap">
      <table className="holdings-table">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Qty</th>
            <th>Avg cost</th>
            <th>Last</th>
            <th>Value</th>
            <th>Unrealized</th>
            <th>Weight</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id}>
              <td className="symbol-cell">
                {p.symbol}
                <div className="feed-card-meta">{p.name}</div>
              </td>
              <td>{fmtQty(p.quantity)}</td>
              <td>{fmtUSD(p.avgCost, 2)}</td>
              <td>{fmtUSD(p.lastPrice, 2)}</td>
              <td>{fmtUSD(p.marketValue)}</td>
              <td className={`metric-value ${pctClass(p.unrealizedPnL)}`}>
                {fmtUSD(p.unrealizedPnL)}
              </td>
              <td>{fmtWeight(p.weightPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
