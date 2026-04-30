import type { MorningEmailDraft, MorningEmailStock, QaMessage } from "./types";

const NEGATIVE_DIRECTION_WORDS = ["down", "dropping", "falling", "declining", "sinking", "tumbling"];

function findNegativeWords(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const w of NEGATIVE_DIRECTION_WORDS) {
    if (new RegExp(`\\b${w}\\b`, "i").test(text)) found.add(w);
  }
  return Array.from(found);
}

function tickerLabel(s: MorningEmailStock): string {
  return s.ticker || "(no ticker)";
}

export function runLocalQa(draft: MorningEmailDraft): QaMessage[] {
  const out: QaMessage[] = [];
  const stocks = draft.stocks;

  if (stocks.length !== 5) {
    out.push({
      level: "warning",
      message: `Expected exactly 5 stocks; draft has ${stocks.length}.`,
    });
  }

  for (const s of stocks) {
    const label = tickerLabel(s);

    if (s.change_pct <= 0) {
      out.push({ level: "warning", message: `${label}: change ${s.change_pct.toFixed(2)}% is not a positive mover.` });
    }
    if (!Number.isFinite(s.last) || s.last <= 0) {
      out.push({ level: "error", message: `${label}: missing valid price.` });
    }
    if (!s.catalyst || !s.catalyst.trim()) {
      out.push({ level: "warning", message: `${label}: catalyst is empty.` });
    }
    if (s.change_pct > 0) {
      const found = findNegativeWords(`${s.catalyst} ${s.sentiment} ${s.evidence_notes}`);
      if (found.length > 0) {
        out.push({
          level: "warning",
          message: `${label}: positive-mover copy contains negative direction word(s): ${found.join(", ")}.`,
        });
      }
    }
    if (s.source_urls.length === 0) {
      out.push({ level: "warning", message: `${label}: no source URLs recorded.` });
    }
    if (s.confidence === "Low") {
      out.push({ level: "warning", message: `${label}: Low confidence.` });
    }
    if (s.risk_flags.length > 0) {
      out.push({
        level: "warning",
        message: `${label}: risk flags require review — ${s.risk_flags.join(", ")}.`,
      });
    }
  }

  return out;
}
