// Mock research bundle for the smoke test. Realistic enough that
// Claude has something to reason about — not a stress test, just a
// sanity check that the pipeline end-to-end accepts the shape and
// produces a valid decision JSON.

import type { ResearchBundle } from "./research-bundle";

export const MOCK_BUNDLE: ResearchBundle = {
  as_of: new Date().toISOString(),
  as_of_date_et: "2026-04-20",
  top_news: [
    {
      title: "Fed holds rates steady, signals two cuts possible by year-end",
      url: "https://example.com/reuters/fed-holds-steady",
      published_at: new Date(Date.now() - 4 * 3600_000).toISOString(),
      highlights: [
        "FOMC statement emphasized labor-market cooling.",
        "Powell: 'more confident, not yet sufficient' on inflation.",
      ],
      source: "reuters.com",
    },
    {
      title: "Semiconductor names jump on NVDA-adjacent supply chain news",
      url: "https://example.com/bloomberg/chips-rally",
      published_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
      highlights: [
        "TSMC cited higher AI-accelerator demand for H2.",
        "AVGO, AMD, SMCI all +3% pre-market.",
      ],
      source: "bloomberg.com",
    },
    {
      title: "Retail sales print softer than consensus, dampens consumer discretionary",
      url: "https://example.com/wsj/retail-sales-soft",
      published_at: new Date(Date.now() - 11 * 3600_000).toISOString(),
      highlights: [
        "Control-group retail sales -0.2% M/M vs +0.3% consensus.",
        "TGT, WMT, HD trading lower pre-market.",
      ],
      source: "wsj.com",
    },
  ],
  earnings_today: [
    {
      ticker: "NFLX",
      report_date: "2026-04-19",
      when: "after-hours",
      eps_estimate: 4.12,
      revenue_estimate: 10_400_000_000,
    },
    {
      ticker: "UAL",
      report_date: "2026-04-20",
      when: "pre-market",
      eps_estimate: 0.78,
      revenue_estimate: 12_500_000_000,
    },
    {
      ticker: "LMT",
      report_date: "2026-04-20",
      when: "pre-market",
      eps_estimate: 6.30,
      revenue_estimate: 17_200_000_000,
    },
    {
      ticker: "GM",
      report_date: "2026-04-20",
      when: "pre-market",
      eps_estimate: 2.15,
      revenue_estimate: 41_000_000_000,
    },
  ],
  pre_market_movers: [
    { ticker: "AVGO", change_pct: 3.4, price: 1742.50, volume: 1_200_000, prev_close: 1685.20 },
    { ticker: "AMD",  change_pct: 2.9, price: 168.10,  volume: 4_500_000, prev_close: 163.40 },
    { ticker: "SMCI", change_pct: 4.2, price:  48.20,  volume: 6_800_000, prev_close:  46.26 },
    { ticker: "NVDA", change_pct: 1.8, price: 125.40,  volume: 8_300_000, prev_close: 123.18 },
    { ticker: "UAL",  change_pct: -2.1, price:  47.60, volume: 900_000,   prev_close:  48.62 },
    { ticker: "TGT",  change_pct: -1.6, price: 155.10, volume: 650_000,   prev_close: 157.62 },
    { ticker: "NFLX", change_pct: 5.7, price: 694.20,  volume: 2_100_000, prev_close: 656.80 },
    { ticker: "LMT",  change_pct: -0.8, price: 486.40, volume: 320_000,   prev_close: 490.30 },
  ],
  errors: [],
};
