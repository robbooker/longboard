#!/usr/bin/env node
/**
 * Longboard essay sync — reads content/essays/*.mdx and upserts each
 * essay into the Supabase `essays` table (schema at
 * supabase/migrations/20260420_essays.sql).
 *
 * Runs as `prebuild` on every Vercel build. Vercel injects env vars
 * directly, so the script is invoked with bare `node scripts/sync-essays.mjs`.
 * For local smoke tests, use:
 *
 *   node --env-file=.env.local scripts/sync-essays.mjs
 *
 * Exits non-zero on any error so the build fails loudly. Idempotent —
 * running twice in a row produces the same table state.
 *
 * Search-body extraction: per Phase 3L audit Addendum B, the `body`
 * column stores fully plain text (JSX tags stripped, markdown emphasis
 * unwrapped, whitespace collapsed) so Postgres `ts_headline` emits
 * clean `<b>`-wrapped output that's safe for dangerouslySetInnerHTML.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import matter from "gray-matter";

const ESSAYS_DIR = path.join(process.cwd(), "content", "essays");

function assertEnv(name) {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.error(`[sync-essays] missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = assertEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = assertEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

/** Strip MDX/JSX tags, markdown emphasis, collapse whitespace. The tag
 *  set we need to handle is closed and small — see Phase 3L audit Q3.
 *  Attribute syntax in essays is simple (className only, no embedded `>`
 *  or multi-line attributes), so a non-greedy regex for `<…>` is safe. */
function stripProse(raw) {
  return raw
    // Defense-in-depth: drop any leading `import` line.
    .replace(/^import\s[^\n]*\n/gm, "")
    // Strip markdown link syntax, preserve the label text.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Strip JSX/HTML open + close + self-closing tags.
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    // Strip markdown bold/italic markers.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Strip leading-hash heading markers.
    .replace(/^#+\s*/gm, "")
    // MDX escapes dollar signs as \$ to avoid interpolation; undo.
    .replace(/\\\$/g, "$")
    // Collapse any run of whitespace (incl. newlines) into a single space.
    .replace(/\s+/g, " ")
    .trim();
}

/** Flatten marginalia into a single text blob at weight B — label +
 *  body concatenated, inline HTML within body stripped. */
function marginaliaSearchText(ms) {
  if (!Array.isArray(ms)) return "";
  return ms
    .map((m) => `${m?.label ?? ""} ${m?.body ?? ""}`)
    .join(" ")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Flatten sources into a single text blob at weight C — author +
 *  title + gloss per source, concatenated. */
function sourcesSearchText(ss) {
  if (!Array.isArray(ss)) return "";
  return ss
    .map((s) => `${s?.author ?? ""} ${s?.title ?? ""} ${s?.gloss ?? ""}`)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePublished(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && v.length > 0) return v.slice(0, 10);
  return null;
}

function normalizePublishAt(v) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "string" && v.length > 0) return v;
  return null;
}

async function loadRows() {
  const entries = await readdir(ESSAYS_DIR);
  const files = entries.filter((f) => f.endsWith(".mdx")).sort();
  const rows = [];
  for (const f of files) {
    const full = await readFile(path.join(ESSAYS_DIR, f), "utf8");
    const { data, content } = matter(full);
    const slug = typeof data.slug === "string" ? data.slug.trim() : "";
    if (!slug) {
      console.error(`[sync-essays] missing or empty slug in ${f}`);
      process.exit(1);
    }
    if (typeof data.issue !== "number" || !Number.isFinite(data.issue)) {
      console.error(`[sync-essays] missing or invalid issue in ${f}`);
      process.exit(1);
    }
    if (typeof data.title !== "string" || data.title.length === 0) {
      console.error(`[sync-essays] missing or empty title in ${f}`);
      process.exit(1);
    }
    rows.push({
      slug,
      issue: data.issue,
      title: data.title,
      kicker: typeof data.kicker === "string" && data.kicker.length > 0 ? data.kicker : null,
      dek: typeof data.dek === "string" && data.dek.length > 0 ? data.dek : null,
      published: normalizePublished(data.published),
      read_minutes: typeof data.read_minutes === "number" && Number.isFinite(data.read_minutes) ? data.read_minutes : null,
      audio_url: typeof data.audio_url === "string" && data.audio_url.length > 0 ? data.audio_url : null,
      daily_rank: typeof data.daily_rank === "number" && Number.isFinite(data.daily_rank) ? data.daily_rank : null,
      publish_at: normalizePublishAt(data.publish_at),
      marginalia: Array.isArray(data.marginalia) ? data.marginalia : [],
      sources: Array.isArray(data.sources) ? data.sources : [],
      body: stripProse(content),
      marginalia_search: marginaliaSearchText(data.marginalia),
      sources_search: sourcesSearchText(data.sources),
      synced_at: new Date().toISOString(),
    });
  }
  return rows;
}

async function main() {
  console.log(`[sync-essays] reading from ${ESSAYS_DIR}`);
  const rows = await loadRows();
  console.log(`[sync-essays] parsed ${rows.length} essays`);

  const { error: upsertErr } = await supabase
    .from("essays")
    .upsert(rows, { onConflict: "slug" });

  if (upsertErr) {
    console.error(`[sync-essays] upsert failed:`, upsertErr);
    process.exit(1);
  }
  console.log(`[sync-essays] upserted ${rows.length} rows`);

  const slugs = rows.map((r) => r.slug);
  const { data: existing, error: listErr } = await supabase
    .from("essays")
    .select("slug");
  if (listErr) {
    console.error(`[sync-essays] list failed:`, listErr);
    process.exit(1);
  }
  const stale = (existing ?? [])
    .map((r) => r.slug)
    .filter((s) => !slugs.includes(s));
  if (stale.length > 0) {
    const { error: delErr } = await supabase
      .from("essays")
      .delete()
      .in("slug", stale);
    if (delErr) {
      console.error(`[sync-essays] delete failed:`, delErr);
      process.exit(1);
    }
    console.log(`[sync-essays] deleted ${stale.length} stale row(s): ${stale.join(", ")}`);
  } else {
    console.log(`[sync-essays] no stale rows to delete`);
  }

  console.log(`[sync-essays] done`);
}

main().catch((err) => {
  console.error(`[sync-essays] unhandled error:`, err);
  process.exit(1);
});
