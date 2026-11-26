// #528 Gainer Balloons: where each balloon is moored. Three wings around an open middle: China and
// Hong Kong on the left, other non-U.S. companies across the back, the U.S. on the right. Inside a
// wing the biggest stories take the inner rows and the middle of each row, and a final pass pushes
// any two moorings apart until none crowd. The same stocks always give the same field.
import { LAYOUT } from "./config";
import type { CountryTier } from "./config";
import type { StockMetadata } from "./data";

const DEG2RAD = Math.PI / 180;

export type Anchor = { id: number; ticker: string; sector: CountryTier; x: number; z: number; clearance: number };

/** How big a story a stock is: volume, with a lift for float turned over. */
function prominence(s: StockMetadata) {
  const volScore = Math.log10(Math.max(s.dayVolume || 10_000, 10_000));
  const rotBonus = s.floatShares ? Math.log1p((s.dayVolume || 0) / s.floatShares) * 0.55 : 0.25;
  return volScore + rotBonus;
}

/** Row seats from the middle outwards: 0 -> the centre seat, then alternating either side. */
export function centreOutSeats(n: number): number[] {
  const middle = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
}

export function computeLayout(stocks: StockMetadata[]): Anchor[] {
  const groups: Record<CountryTier, StockMetadata[]> = { china: [], non_us: [], us: [] };
  for (const s of stocks) groups[s.tier].push(s);
  const anchors: Anchor[] = new Array(stocks.length);

  for (const key of Object.keys(groups) as CountryTier[]) {
    const list = groups[key].sort((a, b) => prominence(b) - prominence(a) || a.ticker.localeCompare(b.ticker));
    const sector = LAYOUT.sectors[key];
    const startRad = sector.startDeg * DEG2RAD;
    const endRad = sector.endDeg * DEG2RAD;
    const spanRad = endRad - startRad;

    let remaining = list;
    for (let rowIdx = 0; remaining.length > 0; rowIdx++) {
      const r = LAYOUT.innerRadius + rowIdx * LAYOUT.rowSpacing;
      // The inner row gets a little more room per balloon.
      const spacing = LAYOUT.minAnchorSpacing * (rowIdx === 0 ? 1.18 : 1.04);
      const count = Math.min(remaining.length, Math.max(2, Math.floor((r * spanRad) / spacing)));
      const row = remaining.slice(0, count);
      remaining = remaining.slice(count);

      const edgePad = Math.min(0.11, spanRad * 0.08);
      const usableStart = startRad + edgePad;
      const usableEnd = endRad - edgePad;
      const stagger = rowIdx % 2 === 1 && count > 1 ? 0.025 : 0;
      const seats = centreOutSeats(count);
      row.forEach((s, rank) => {
        const seat = seats[rank];
        const t = count === 1 ? 0.5 : seat / (count - 1);
        const angle = usableStart + (usableEnd - usableStart) * t + stagger * (seat % 2 === 0 ? 1 : -1);
        anchors[s.id] = {
          id: s.id,
          ticker: s.ticker,
          sector: key,
          x: Math.sin(angle) * r,
          z: -Math.cos(angle) * r * LAYOUT.zStretch,
          // The heaviest stories keep more room around them.
          clearance: LAYOUT.minAnchorSpacing * (s.dayVolume > 20_000_000 ? 1.24 : s.dayVolume > 5_000_000 ? 1.1 : 1),
        };
      });
    }
  }

  for (let iter = 0; iter < 24; iter++) {
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      for (let j = i + 1; j < anchors.length; j++) {
        const b = anchors[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz) || 0.001;
        const minDist = Math.max(a.clearance, b.clearance);
        if (dist < minDist) {
          const push = (minDist - dist) * 0.35;
          const nx = dx / dist;
          const nz = dz / dist;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
  }
  return anchors;
}
