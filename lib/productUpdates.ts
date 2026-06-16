export type ProductUpdate = {
  date: string;
  label: string;
  title: string;
  summary: string;
  highlights: string[];
  links?: Array<{
    href: string;
    label: string;
  }>;
};

export const productUpdates: ProductUpdate[] = [
  {
    date: "2026-06-16",
    label: "Charts",
    title: "The Stack chart controls got sharper.",
    summary:
      "The member chart workspace now keeps more of the chart state where traders expect it, with faster symbol entry and cleaner per-chart controls.",
    highlights: [
      "Added light symbol and timeframe watermarks to each chart.",
      "Added Command+K and Ctrl+K to jump straight into symbol search.",
      "Made bottom time-axis sizing persist per symbol and timeframe.",
      "Added an RST chip on every chart to restore the default view.",
      "Enabled right price-axis drag scaling to make candles taller or shorter.",
    ],
    links: [{ href: "/charts", label: "Open charts" }],
  },
  {
    date: "2026-06-16",
    label: "Chart behavior",
    title: "Refresh behavior is now documented in-product.",
    summary:
      "The chart page checks for fresh 1m, 5m, and 4h data every 60 seconds without a reload. The 1m feed can pick up fresh bars each minute; 4h bars currently use the longer live cache window.",
    highlights: [
      "Confirmed 1m chart data refreshes without a new page load.",
      "Confirmed 4h chart requests run every minute, with a 15-minute server cache currently in front of 4h bars.",
    ],
    links: [{ href: "/charts", label: "Open charts" }],
  },
  {
    date: "2026-06-13",
    label: "Boardroom",
    title: "Talent Inventory launched for members.",
    summary:
      "Members now have a protected place to tell Longboard what they can help with, what they are building, and where they want to contribute.",
    highlights: [
      "Added the protected /talent member form.",
      "Stored one editable talent profile per authenticated user.",
      "Saved structured choices plus open-ended notes for flexible member input.",
    ],
    links: [{ href: "/talent", label: "Open Talent Inventory" }],
  },
  {
    date: "2026-06-12",
    label: "Charts",
    title: "The chart workspace added practical overlays.",
    summary:
      "The Stack view picked up compact chart-surface controls for high-signal overlays while keeping the workspace focused on the tape.",
    highlights: [
      "Added Ghost Pivot and 4H high reference controls.",
      "Added Williams Fractals as a compact overlay.",
      "Moved secondary controls onto the chart surface to conserve space.",
      "Added shared chart-bar caching to make repeat loads faster.",
    ],
    links: [{ href: "/charts", label: "Open charts" }],
  },
];
