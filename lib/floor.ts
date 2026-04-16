import { readdir, readFile } from "fs/promises";
import path from "path";
import matter from "gray-matter";

export type FloorNote = {
  timestamp: string;
  ticker?: string;
  author: string;
  /** Raw MDX body — short prose with `**bold**` + `*italic*`
   *  support. Rendered via renderFloorBody() into safe HTML. */
  body: string;
};

const FLOOR_DIR = path.join(process.cwd(), "content", "floor");

/** Lists all floor notes, most recent first. Returns an empty array
 *  when the directory is missing or empty — the Daily page renders
 *  the section conditionally, so zero notes = no band. */
export async function listFloorNotes(): Promise<FloorNote[]> {
  let entries: string[];
  try {
    entries = await readdir(FLOOR_DIR);
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith(".mdx"));
  const all = await Promise.all(
    files.map(async (f) => {
      const full = await readFile(path.join(FLOOR_DIR, f), "utf8");
      const { data, content } = matter(full);
      return normalize(data, content);
    })
  );
  return all
    .filter((n): n is FloorNote => n !== null)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function normalize(data: Record<string, unknown>, body: string): FloorNote | null {
  // YAML parses ISO datetimes into Date objects; normalize to ISO
  // string so downstream rendering is JSON-serializable and
  // timezone-stable.
  const ts = data.timestamp instanceof Date
    ? data.timestamp.toISOString()
    : typeof data.timestamp === "string" ? data.timestamp : "";
  if (!ts) return null;
  const author = typeof data.author === "string" && data.author.length > 0 ? data.author : "Rob Booker";
  const ticker = typeof data.ticker === "string" && data.ticker.length > 0 ? data.ticker : undefined;
  return { timestamp: ts, ticker, author, body: body.trim() };
}

/** Renders the HH:MM timestamp in ET. Matches the mockup's "9:34 ET"
 *  styling — no leading zero on the hour. */
export function formatFloorTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hhmm = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${hhmm} ET`;
}

/** Transforms a floor note body's `**bold**` + `*italic*` markers
 *  into `<strong>` + `<em>` HTML. Deliberately minimal — floor notes
 *  are one-line observations, not essays. The output is safe to
 *  render via dangerouslySetInnerHTML because the only tags produced
 *  are <strong> and <em>; any literal HTML in the source is
 *  escaped first. */
export function renderFloorBody(body: string): string {
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}
