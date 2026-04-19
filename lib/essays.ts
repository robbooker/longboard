import { readdir, readFile } from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { isPublished } from "@/lib/publishing";
import { getCurrentUser } from "@/lib/auth";

export type EssayMarginalia = { label: string; body: string };

export type EssayFrontmatter = {
  issue: number;
  slug: string;
  title: string;
  title_accent: string;
  kicker: string;
  dek: string;
  filed_under: string;
  issue_label: string;
  read_minutes: number;
  /** ISO date, e.g. "2026-04-15". Stored as a Date if YAML parsed it
   *  that way, but normalized to a string by loadEssay so the shape
   *  handed to components is consistent. */
  published: string;
  marginalia?: EssayMarginalia[];
  sources?: string[];
  /** Permanent R2 URL for the M4A recording. Optional — essays
   *  without audio just skip the player. */
  audio_url?: string;
  /** Duration of the audio recording in whole seconds. Set by
   *  publish-audio via ffprobe. Used by the podcast RSS feed for
   *  `<itunes:duration>`. */
  audio_duration_seconds?: number;
  /** ISO 8601 datetime with timezone offset for scheduled publishing.
   *  If absent, essay is treated as already published. If in the
   *  future, essay is hidden from all surfaces until the time passes. */
  publish_at?: string;
  /** Editorial flag for the Daily homepage. At most one essay should
   *  carry `daily_featured: true`; ties resolve to highest issue. */
  daily_featured?: boolean;
  /** Lower = higher position in the Daily right-rail "most read"
   *  list. Essays without a rank sort after ranked ones by issue desc. */
  daily_rank?: number;
  /** Pull-quote used in the Daily right-rail "Latest essay" block
   *  and the bottom pull-quote band. Optional; falls back to the
   *  essay's dek if absent. */
  daily_excerpt?: string;
  /** Short topic tag for share cards (e.g. "On automation"). Falls
   *  back to "On {issue_label}" when absent. */
  share_kicker?: string;
  /** Exact quote for Treatment A (cream) share card, including `<em>`
   *  emphasis. Falls back to first Pullquote/Maxim in the body. */
  share_quote_a?: string;
  /** Exact quote for Treatment B (dark) share card. Same conventions. */
  share_quote_b?: string;
};

export type EssayFile = {
  frontmatter: EssayFrontmatter;
  /** Raw MDX body. The caller compiles it via next-mdx-remote. */
  body: string;
};

const ESSAYS_DIR = path.join(process.cwd(), "content", "essays");

type ListOpts = { includeScheduled?: boolean };

/** Returns true when includeScheduled is requested AND the current
 *  viewer is an admin. Silently returns false on auth errors so
 *  unauthenticated requests never see scheduled content. */
async function shouldBypassSchedule(opts?: ListOpts): Promise<boolean> {
  if (!opts?.includeScheduled) return false;
  try {
    const result = await getCurrentUser();
    return result.ok && result.user.role === "admin";
  } catch {
    return false;
  }
}

/** Lists slugs of published essays. Reads frontmatter to check
 *  `publish_at` — unpublished essays are excluded so their routes
 *  don't get statically generated. */
export async function listEssaySlugs(): Promise<string[]> {
  const essays = await listEssays();
  return essays.map((e) => e.slug);
}

/** Reads every essay's frontmatter (skipping the body parse cost).
 *  Used by the index page. Sorted by `issue` desc — newest first.
 *  Pass `{ includeScheduled: true }` from admin-visible surfaces;
 *  the option is ignored for non-admin viewers. */
export async function listEssays(opts?: ListOpts): Promise<EssayFrontmatter[]> {
  const bypass = await shouldBypassSchedule(opts);
  const entries = await readdir(ESSAYS_DIR);
  const files = entries.filter((f) => f.endsWith(".mdx"));
  const all = await Promise.all(
    files.map(async (f) => {
      const full = await readFile(path.join(ESSAYS_DIR, f), "utf8");
      const { data } = matter(full);
      return normalizeFrontmatter(data);
    })
  );
  const visible = bypass ? all : all.filter((e) => isPublished(e.publish_at));
  return visible.sort((a, b) => b.issue - a.issue);
}

/** Loads a single essay by slug. Returns null if no file matches or
 *  if the essay has a future `publish_at` — the page route maps null
 *  to a 404. Pass `{ includeScheduled: true }` for admin preview. */
export async function loadEssay(slug: string, opts?: ListOpts): Promise<EssayFile | null> {
  const entries = await readdir(ESSAYS_DIR);
  const match = entries.find((f) => f.endsWith(".mdx") && f.replace(/\.mdx$/, "").replace(/^\d+-/, "") === slug);
  if (!match) return null;
  const full = await readFile(path.join(ESSAYS_DIR, match), "utf8");
  const { data, content } = matter(full);
  const fm = normalizeFrontmatter(data);
  if (!isPublished(fm.publish_at)) {
    const bypass = await shouldBypassSchedule(opts);
    if (!bypass) return null;
  }
  return { frontmatter: fm, body: content };
}

/** Coerces the raw gray-matter object into EssayFrontmatter with
 *  predictable types. YAML parses `published: 2026-04-15` as a Date,
 *  but we want a string downstream — both for rendering and for JSON
 *  serialization across the server/client boundary. */
function normalizeFrontmatter(data: Record<string, unknown>): EssayFrontmatter {
  const published = data.published instanceof Date
    ? data.published.toISOString().slice(0, 10)
    : String(data.published ?? "");
  return {
    issue: Number(data.issue),
    slug: String(data.slug),
    title: String(data.title),
    title_accent: String(data.title_accent ?? ""),
    kicker: String(data.kicker),
    dek: String(data.dek),
    filed_under: String(data.filed_under),
    issue_label: String(data.issue_label),
    read_minutes: Number(data.read_minutes),
    published,
    marginalia: Array.isArray(data.marginalia) ? (data.marginalia as EssayMarginalia[]) : [],
    sources: Array.isArray(data.sources) ? (data.sources as string[]) : [],
    audio_url: typeof data.audio_url === "string" && data.audio_url.length > 0 ? data.audio_url : undefined,
    audio_duration_seconds: typeof data.audio_duration_seconds === "number" && Number.isFinite(data.audio_duration_seconds) ? data.audio_duration_seconds : undefined,
    publish_at: typeof data.publish_at === "string" && data.publish_at.length > 0
      ? data.publish_at
      : data.publish_at instanceof Date
        ? data.publish_at.toISOString()
        : undefined,
    daily_featured: data.daily_featured === true ? true : undefined,
    daily_rank: typeof data.daily_rank === "number" && Number.isFinite(data.daily_rank) ? data.daily_rank : undefined,
    daily_excerpt: typeof data.daily_excerpt === "string" && data.daily_excerpt.length > 0 ? data.daily_excerpt : undefined,
    share_kicker: typeof data.share_kicker === "string" && data.share_kicker.length > 0 ? data.share_kicker : undefined,
    share_quote_a: typeof data.share_quote_a === "string" && data.share_quote_a.length > 0 ? data.share_quote_a : undefined,
    share_quote_b: typeof data.share_quote_b === "string" && data.share_quote_b.length > 0 ? data.share_quote_b : undefined,
  };
}

/** Picks the Daily lead story. Prefers essays with `daily_featured:
 *  true`; ties resolve to the highest issue. Falls back to the
 *  highest-issue essay overall when no essay is flagged. Returns
 *  null when the essay set is empty. */
export function pickDailyLead(essays: EssayFrontmatter[]): EssayFrontmatter | null {
  if (essays.length === 0) return null;
  const featured = essays
    .filter((e) => e.daily_featured === true)
    .sort((a, b) => b.issue - a.issue);
  if (featured.length > 0) return featured[0];
  return [...essays].sort((a, b) => b.issue - a.issue)[0];
}

/** Orders essays for the Daily right-rail "most read" list. Essays
 *  with `daily_rank` come first, ascending by rank. Unranked essays
 *  follow, descending by issue. Caller slices to desired length —
 *  per the "render what exists" rule we never pad. */
export function rankForRail(essays: EssayFrontmatter[]): EssayFrontmatter[] {
  const ranked = essays
    .filter((e) => typeof e.daily_rank === "number")
    .sort((a, b) => (a.daily_rank as number) - (b.daily_rank as number));
  const unranked = essays
    .filter((e) => typeof e.daily_rank !== "number")
    .sort((a, b) => b.issue - a.issue);
  return [...ranked, ...unranked];
}

/** Returns the `daily_excerpt` frontmatter field when set, else the
 *  essay's dek. Never returns empty — the pull-quote band can't
 *  render a blank. */
export function dailyExcerpt(fm: EssayFrontmatter): string {
  return fm.daily_excerpt ?? fm.dek;
}

/** Extracts the first few prose paragraphs from an MDX body, in
 *  order, with JSX + markdown markers stripped. Used for the Daily
 *  lead story body. Returns up to `count` paragraphs.
 *
 *  MDX paragraphs are blank-line-delimited. The first paragraph
 *  in our essays is typically wrapped in `<p className="lede">`;
 *  the wrapper is unwrapped and its content counted as the first
 *  paragraph. Other JSX blocks (Pullquote, MaximStack, …) are
 *  skipped so the intro stays prose. */
export function leadIntro(body: string, count = 2): string[] {
  const parts = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length >= count) break;
    const ledeMatch = p.match(/^<p\s+className="lede">([\s\S]*?)<\/p>$/);
    if (ledeMatch) {
      out.push(cleanParagraph(ledeMatch[1]));
      continue;
    }
    if (p.startsWith("<") || p.startsWith("#")) continue;
    out.push(cleanParagraph(p));
  }
  return out;
}

/** Strips residual HTML/JSX tags + Markdown emphasis markers +
 *  collapses whitespace. Used by leadIntro for each paragraph. */
function cleanParagraph(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Apr 2026" formatting for masthead/footer meta lines. Pure function
 *  so the page route stays synchronous-looking. */
export function monthYear(published: string): string {
  const d = new Date(published);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
