export const libraryResourceTypes = [
  "presentation",
  "pdf",
  "indicator",
  "video",
  "replay",
  "worksheet",
  "link",
] as const;

export type LibraryResourceType = (typeof libraryResourceTypes)[number];

export type LibraryResourceStatus = "ready" | "pending";

export type LibraryResource = {
  id: string;
  title: string;
  type: LibraryResourceType;
  description: string;
  tags: string[];
  date: string;
  href: string | null;
  status: LibraryResourceStatus;
  featured?: boolean;
  format?: string;
  sourceNote?: string;
};

export const libraryTypeLabels: Record<LibraryResourceType, string> = {
  presentation: "Slides",
  pdf: "PDF",
  indicator: "Indicator",
  video: "Video",
  replay: "Replay",
  worksheet: "Worksheet",
  link: "Link",
};

export const libraryResources: LibraryResource[] = [
  {
    id: "houston-slides",
    title: "Houston Session Slides",
    type: "presentation",
    description:
      "Slide deck from the Houston Longboard session, kept here as a durable member reference.",
    tags: ["Houston", "Live class", "Slides"],
    date: "2026-06-10",
    href: "/houston/slides",
    status: "ready",
    featured: true,
    format: "HTML slides",
    sourceNote: "Existing Longboard asset",
  },
  {
    id: "houston-session-page",
    title: "Houston Session Resource Page",
    type: "link",
    description:
      "Session landing page with the current Houston workshop material and context.",
    tags: ["Houston", "Workshop", "Members"],
    date: "2026-06-10",
    href: "/houston",
    status: "ready",
    format: "Page",
    sourceNote: "Existing Longboard asset",
  },
  {
    id: "webinar-june-8",
    title: "June 8 Webinar Recap",
    type: "replay",
    description:
      "Recap page for the June 8 webinar, available while the fuller video and file archive is assembled.",
    tags: ["Webinar", "Replay", "Recap"],
    date: "2026-06-09",
    href: "/webinar-june8.html",
    status: "ready",
    featured: true,
    format: "HTML recap",
    sourceNote: "Existing Longboard asset",
  },
  {
    id: "rvol-april-lab",
    title: "RVOL April Lab",
    type: "worksheet",
    description:
      "Archived lab page for the April RVOL work. Useful as a reference alongside the live scanner.",
    tags: ["RVOL", "Lab", "Scanner"],
    date: "2026-05-02",
    href: "/lab/rvol-april.html",
    status: "ready",
    format: "Lab page",
    sourceNote: "Existing Longboard asset",
  },
  {
    id: "wir-may-2",
    title: "WIR May 2 Packet",
    type: "link",
    description:
      "Weekly intelligence reference packet available as an archived Longboard page.",
    tags: ["WIR", "Market prep", "Packet"],
    date: "2026-05-02",
    href: "/wir/2026-05-02.html",
    status: "ready",
    format: "HTML packet",
    sourceNote: "Existing Longboard asset",
  },
  {
    id: "pdf-archive-slot",
    title: "Member PDF Archive",
    type: "pdf",
    description:
      "Reserved slot for downloadable PDFs once the protected file inventory is attached.",
    tags: ["PDF", "Downloads", "Archive"],
    date: "2026-06-11",
    href: null,
    status: "pending",
    format: "PDF downloads",
    sourceNote: "Attach protected PDFs before release",
  },
  {
    id: "ep-momentum-v27",
    title: "EP Momentum v27 HTF Breakouts",
    type: "indicator",
    description:
      "TradingView Pine indicator slot reserved for the EP Momentum v27 HTF Breakouts script.",
    tags: ["TradingView", "Pine", "Momentum", "Breakouts"],
    date: "2026-06-11",
    href: null,
    status: "pending",
    featured: true,
    format: "Pine Script",
    sourceNote: "Attach protected script download before release",
  },
  {
    id: "command-2-starter-video",
    title: "Command 2 Starter Video",
    type: "video",
    description:
      "Video slot for the first member walkthrough of Command Center, Scanner, charts, and daily workflow.",
    tags: ["Command 2", "Start here", "Video"],
    date: "2026-06-11",
    href: null,
    status: "pending",
    featured: true,
    format: "Video link",
    sourceNote: "Add watch URL",
  },
];
