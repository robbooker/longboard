import type { WorkbookDefinition } from "./definitions";

export type WorkbookResponse = {
  answers: Record<string, string>;
  evidence: { date: string; action: string; reflection: string }[];
};

export function emptyResponse(workbook: WorkbookDefinition): WorkbookResponse {
  return {
    answers: Object.fromEntries(workbook.prompts.map(({ id }) => [id, ""])),
    evidence: Array.from({ length: workbook.evidenceCount }, () => ({ date: "", action: "", reflection: "" })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 5000;
}

function validDate(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Reconstruct known fields instead of persisting arbitrary client JSON.
export function parseResponse(value: unknown, workbook: WorkbookDefinition): WorkbookResponse | null {
  if (!isRecord(value) || !isRecord(value.answers) || !Array.isArray(value.evidence)) return null;
  const answers: Record<string, string> = {};
  for (const { id } of workbook.prompts) {
    const answer = value.answers[id];
    if (!isText(answer)) return null;
    answers[id] = answer;
  }
  if (value.evidence.length !== workbook.evidenceCount) return null;
  const evidence: WorkbookResponse["evidence"] = [];
  for (const item of value.evidence) {
    if (!isRecord(item) || !validDate(item.date) || !isText(item.action) || !isText(item.reflection)) return null;
    evidence.push({ date: item.date, action: item.action, reflection: item.reflection });
  }
  return { answers, evidence };
}
