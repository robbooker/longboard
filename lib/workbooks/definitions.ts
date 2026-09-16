export type WorkbookDefinition = {
  slug: string;
  title: string;
  subtitle: string;
  event: string;
  introduction: string[];
  comparison: { backwards: string; forwards: string };
  prompts: { id: string; title: string; hint: string; placeholder: string }[];
  commitmentId: string;
  evidenceTitle: string;
  evidenceHint: string;
  evidenceCount: number;
  closing: string;
};

export const workbooks: WorkbookDefinition[] = [{
  slug: "act-your-way",
  title: "You can't think your way into acting differently",
  subtitle: "But you can act your way into thinking differently.",
  event: "Rob Booker Short Selling Mastermind · Houston",
  introduction: ["It's an old line from the rooms of Alcoholics Anonymous, and it has kept people sober for seventy years: you cannot wait to feel differently before you behave differently. Waiting to feel ready is how people stay stuck. You take the action first — you show up, you make the call, you do the next right thing — and the new thinking arrives later, as a result of the action, not a prerequisite for it. They also say \"fake it till you make it\" and \"bring the body and the mind will follow.\" Same idea. Behavior is the lever. Belief is downstream.", "Traders have this exactly backwards. We wait to feel confident before sizing properly. We wait to feel disciplined before following the rules. We wait until we're \"in a good headspace\" to journal, or to review the losers, or to trade the plan instead of the feeling. So we sit there waiting for a mental state that only ever shows up after the behavior it was supposed to produce.", "You will not think your way out of revenge trading, and you will not think your way into patience. You act patient — you sit on your hands one time, one session, when everything in you wants to click — and the next day it costs a little less. The new self-image gets built from evidence you gave yourself, not from insight."],
  comparison: {
    backwards: "Feel confident → then size correctly → then become a disciplined trader. (Waiting room. Nothing happens here.)",
    forwards: "Size correctly today, whether or not you feel like it → collect the evidence → the confidence and the identity follow.",
  },
  prompts: [
    { id: "feeling", title: "What am I waiting to feel before I'll act?", hint: 'Confident, ready, certain, calm, "in the zone," recovered from the last loss — name it.', placeholder: "I'm waiting to feel…" },
    { id: "behavior", title: "What would I be doing right now if I already felt that way?", hint: "Be specific and behavioral — a stranger should be able to see it happening.", placeholder: "You would see me…" },
    { id: "action", title: "The action I'm taking anyway — before the feeling shows up.", hint: "One behavior, small enough that you'll actually do it on Monday whether you feel like it or not.", placeholder: "Even before I feel ready, I will…" },
    { id: "showing-up", title: "Bring the body.", hint: "What do I show up to even on the bad days? The check-in written, the journal filled, the review done, the meeting attended, the partner texted.", placeholder: "On the bad days, I still show up to…" },
  ],
  commitmentId: "action",
  evidenceTitle: "The first three times I acted before I felt it.",
  evidenceHint: "Fill this in over your first two weeks. This is the proof your new thinking gets built from.",
  evidenceCount: 3,
  closing: '"Act as if" isn’t pretending. It’s doing the thing a disciplined trader would do, today, on the evidence you don’t have yet — and letting the evidence catch up.',
}];

export function getWorkbook(slug: string) {
  return workbooks.find((workbook) => workbook.slug === slug);
}
