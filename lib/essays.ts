import { readdir, readFile } from "fs/promises";
import path from "path";
import matter from "gray-matter";

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
};

export type EssayFile = {
  frontmatter: EssayFrontmatter;
  /** Raw MDX body. The caller compiles it via next-mdx-remote. */
  body: string;
};

const ESSAYS_DIR = path.join(process.cwd(), "content", "essays");

/** Lists every .mdx file in content/essays/. Returns bare slugs
 *  (filename without the leading "NNN-" prefix and without .mdx),
 *  matching the URL segment under /learn/[slug]. */
export async function listEssaySlugs(): Promise<string[]> {
  const entries = await readdir(ESSAYS_DIR);
  return entries
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => f.replace(/\.mdx$/, ""))
    .map((name) => name.replace(/^\d+-/, ""));
}

/** Reads every essay's frontmatter (skipping the body parse cost).
 *  Used by the index page. Sorted by `issue` desc — newest first. */
export async function listEssays(): Promise<EssayFrontmatter[]> {
  const entries = await readdir(ESSAYS_DIR);
  const files = entries.filter((f) => f.endsWith(".mdx"));
  const all = await Promise.all(
    files.map(async (f) => {
      const full = await readFile(path.join(ESSAYS_DIR, f), "utf8");
      const { data } = matter(full);
      return normalizeFrontmatter(data);
    })
  );
  return all.sort((a, b) => b.issue - a.issue);
}

/** Loads a single essay by slug. Returns null if no file matches —
 *  the page route maps that to a 404. Slug matching is filename-based:
 *  the file {NNN}-{slug}.mdx gets matched by slug == the stripped form. */
export async function loadEssay(slug: string): Promise<EssayFile | null> {
  const entries = await readdir(ESSAYS_DIR);
  const match = entries.find((f) => f.endsWith(".mdx") && f.replace(/\.mdx$/, "").replace(/^\d+-/, "") === slug);
  if (!match) return null;
  const full = await readFile(path.join(ESSAYS_DIR, match), "utf8");
  const { data, content } = matter(full);
  return { frontmatter: normalizeFrontmatter(data), body: content };
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
  };
}

/** "Apr 2026" formatting for masthead/footer meta lines. Pure function
 *  so the page route stays synchronous-looking. */
export function monthYear(published: string): string {
  const d = new Date(published);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
