import { readdir, readFile } from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { isPublished } from "@/lib/publishing";
import { getCurrentUser } from "@/lib/auth";

/** Frontmatter shape for a /business update. Strictly simpler than
 *  EssayFrontmatter — no issue numbers, no marginalia, no sources, no
 *  Daily-homepage helpers. The editorial template is "lede + H2
 *  sections + closing", and the .essay-page .article.no-sections CSS
 *  modifier suppresses the auto Roman § counter on H2 (Phase 3M Q1/F1). */
export type BusinessUpdate = {
  slug: string;
  title: string;
  /** Small caps tag above the title, e.g. "Business Update". Optional. */
  kicker?: string;
  /** One-liner under the title. Optional. */
  dek?: string;
  /** Human-readable date string, e.g. "April 26, 2026". Used for byline. */
  published: string;
  /** ISO 8601 with TZ offset for scheduled publishing. If absent, the
   *  update is treated as already published. If in the future, hidden
   *  from non-admin viewers (admins bypass via includeScheduled). */
  publish_at?: string;
  read_minutes: number;
  /** Permanent R2 URL for the M4A recording. Optional — updates without
   *  audio just skip the player. */
  audio_url?: string;
};

export type BusinessUpdateFile = {
  frontmatter: BusinessUpdate;
  /** Raw MDX body. The caller compiles it via next-mdx-remote. */
  body: string;
};

const BUSINESS_DIR = path.join(process.cwd(), "content", "business");

type ListOpts = { includeScheduled?: boolean };

/** Returns true when includeScheduled is requested AND the current
 *  viewer is an admin. Mirrors lib/essays.ts:shouldBypassSchedule —
 *  silently returns false on auth errors so unauthenticated requests
 *  never see scheduled content. */
async function shouldBypassSchedule(opts?: ListOpts): Promise<boolean> {
  if (!opts?.includeScheduled) return false;
  try {
    const result = await getCurrentUser();
    return result.ok && result.user.role === "admin";
  } catch {
    return false;
  }
}

/** Lists every business update visible to the caller, newest first.
 *
 *  Returns [] gracefully when content/business/ doesn't exist yet —
 *  this is the smoke-test surface that Phase 3M Commit 2 verifies, and
 *  it lets the /business index page render cleanly before any updates
 *  are published.
 *
 *  Pass { includeScheduled: true } from admin-visible surfaces; the
 *  option is ignored for non-admin viewers. */
export async function listBusinessUpdates(opts?: ListOpts): Promise<BusinessUpdate[]> {
  const bypass = await shouldBypassSchedule(opts);
  let entries: string[];
  try {
    entries = await readdir(BUSINESS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const files = entries.filter((f) => f.endsWith(".mdx"));
  const all = await Promise.all(
    files.map(async (f) => {
      const full = await readFile(path.join(BUSINESS_DIR, f), "utf8");
      const { data } = matter(full);
      return normalizeFrontmatter(data);
    })
  );
  const visible = bypass ? all : all.filter((u) => isPublished(u.publish_at));
  return visible.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

/** Loads a single update by slug. Returns null if no file matches or
 *  if the update has a future publish_at — the page route maps null
 *  to a 404. Pass { includeScheduled: true } for admin preview. */
export async function loadBusinessUpdate(
  slug: string,
  opts?: ListOpts,
): Promise<BusinessUpdateFile | null> {
  let entries: string[];
  try {
    entries = await readdir(BUSINESS_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  // Business filenames are exactly "{slug}.mdx" — no leading numeric
  // prefix like the essay convention. Slug match is therefore strict.
  const match = entries.find((f) => f.endsWith(".mdx") && f.replace(/\.mdx$/, "") === slug);
  if (!match) return null;
  const full = await readFile(path.join(BUSINESS_DIR, match), "utf8");
  const { data, content } = matter(full);
  const fm = normalizeFrontmatter(data);
  if (!isPublished(fm.publish_at)) {
    const bypass = await shouldBypassSchedule(opts);
    if (!bypass) return null;
  }
  return { frontmatter: fm, body: content };
}

/** Coerces gray-matter's loose `Record<string, unknown>` into
 *  BusinessUpdate with predictable types. Handles YAML's quirky
 *  `published: 2026-04-26` Date-object parsing and normalizes
 *  publish_at to a string for clean serialization. Same shape as
 *  lib/essays.ts:normalizeFrontmatter, simpler payload. */
function normalizeFrontmatter(data: Record<string, unknown>): BusinessUpdate {
  const published = data.published instanceof Date
    ? data.published.toISOString().slice(0, 10)
    : String(data.published ?? "");
  return {
    slug: String(data.slug),
    title: String(data.title),
    kicker: typeof data.kicker === "string" && data.kicker.length > 0 ? data.kicker : undefined,
    dek: typeof data.dek === "string" && data.dek.length > 0 ? data.dek : undefined,
    published,
    publish_at: typeof data.publish_at === "string" && data.publish_at.length > 0
      ? data.publish_at
      : data.publish_at instanceof Date
        ? data.publish_at.toISOString()
        : undefined,
    read_minutes: Number(data.read_minutes),
    audio_url: typeof data.audio_url === "string" && data.audio_url.length > 0 ? data.audio_url : undefined,
  };
}

/** Sort key: prefer publish_at (ISO with TZ) for chronological ordering;
 *  fall back to the human-readable published string. ISO strings sort
 *  correctly under localeCompare. Caller uses descending order. */
function sortKey(u: BusinessUpdate): string {
  return u.publish_at ?? u.published ?? "";
}

/** "Apr 2026" formatting for masthead/footer meta lines. Pure function
 *  so the page route stays synchronous-looking. Duplicated from
 *  lib/essays.ts to avoid a cross-module dependency just for date
 *  formatting — both modules can move to a shared lib/dates.ts later
 *  if a third caller appears. */
export function monthYear(published: string): string {
  const d = new Date(published);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
