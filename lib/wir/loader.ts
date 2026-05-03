import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { GapEvent, WIRWeek } from "./types";

/**
 * Server-side WIR data loader.
 *
 * Reads frozen JSON snapshots committed under public/wir/data/. Each
 * snapshot corresponds to one published Week-in-Review report.
 *
 * Why a JSON file in /public and not an API route:
 *   - The dataset is a frozen historical artifact (94 events, ~50KB).
 *   - It changes once a week, never on the request path.
 *   - Reading from disk in a server component is faster than a self-fetch
 *     and avoids the route-handler boilerplate.
 *
 * The data is also served statically at /wir/data/<file>.json which is
 * convenient for client-side debugging and parity with how
 * public/wir/2026-05-02.html consumes it.
 *
 * If we ever want multi-week archive UI, swap loadDefaultWIRWeek for a
 * lookup by week_start.
 */

const DATA_DIR = path.join(process.cwd(), "public", "wir", "data");

/** The week we ship with /lab/chart v1. Bump when we publish the next WIR. */
export const DEFAULT_WIR_FILE = "2026-05-02.json";

export async function loadWIRWeek(filename: string): Promise<WIRWeek> {
  const filePath = path.join(DATA_DIR, filename);
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as WIRWeek;

  // Defensive: ensure events is an array. If the file is just an array of
  // events (the raw gap_events_week.json shape), wrap it.
  if (Array.isArray(parsed)) {
    const events = parsed as unknown as GapEvent[];
    return inferWeekShape(events);
  }
  if (!parsed.events || !Array.isArray(parsed.events)) {
    throw new Error(
      `WIR file ${filename} missing 'events' array (got keys: ${Object.keys(parsed).join(", ")})`
    );
  }
  return parsed;
}

/**
 * Best-effort fallback when the JSON is just an array of GapEvents (i.e.
 * the raw gap_events_week.json shape with no envelope). Derives week
 * boundaries from the events themselves.
 */
function inferWeekShape(events: GapEvent[]): WIRWeek {
  if (events.length === 0) {
    return { week_start: "", week_end: "", label: "", events: [] };
  }
  const dates = events.map((e) => e.gap_date).sort();
  const week_start = dates[0];
  const week_end = dates[dates.length - 1];
  return {
    week_start,
    week_end,
    label: `${formatLabel(week_start)} - ${formatLabel(week_end)}`,
    events,
  };
}

function formatLabel(iso: string): string {
  // "2026-04-27" -> "Apr 27"
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[m - 1]} ${d}`;
}

export async function loadDefaultWIRWeek(): Promise<WIRWeek> {
  return loadWIRWeek(DEFAULT_WIR_FILE);
}
