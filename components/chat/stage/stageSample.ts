// #501: sample data for the stage mock-up. Everything here is made up (the tickers too) and stays on
// this device: nothing is saved. Realtime events on the existing Ably setup replace it later.
export type StageTrade = { id: string; time: string; tag: "SHORT" | "WATCH" | "COVER"; sym: string; note: string };
export type StageChapter = { id: string; time: string; label: string };
export type StageQuestion = { id: string; votes: number; text: string; by: string };

export const STAGE_HOST = { name: "Rob Booker", initials: "RB", topic: "Trading the open" };

export const STAGE_TRADES: readonly StageTrade[] = [
  { id: "t3", time: "10:06", tag: "SHORT", sym: "QBTZ", note: "starter" },
  { id: "t2", time: "10:02", tag: "WATCH", sym: "MLNK", note: "no entry" },
  { id: "t1", time: "09:42", tag: "COVER", sym: "VXRT", note: "closed" },
];

export const STAGE_LIVE_CHAPTER = "live";
export const STAGE_CHAPTERS: readonly StageChapter[] = [
  { id: "c1", time: "09:42", label: "VXRT cover" },
  { id: "c2", time: "10:02", label: "MLNK watch" },
  { id: "c3", time: "10:06", label: "QBTZ short entry" },
  { id: STAGE_LIVE_CHAPTER, time: "NOW", label: "Live" },
];

export const STAGE_QUESTIONS: readonly StageQuestion[] = [
  { id: "q1", votes: 9, text: "How do you size the starter versus the add?", by: "Igor · answering now" },
  { id: "q2", votes: 6, text: "What would make you cover early here?", by: "Jammie" },
  { id: "q3", votes: 2, text: "Can you show the Scamometer breakdown?", by: "Garth" },
];
