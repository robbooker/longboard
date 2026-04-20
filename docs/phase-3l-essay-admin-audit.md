# Phase 3L audit — essay admin list + /learn search

**Date:** 2026-04-20
**Scope:** pre-Commit-2 audit per the handoff. Does not include implementation.
**Author:** Claude Code

> **Filename note:** `docs/phase-3l-audit.md` was already taken by the April 15 audit for the Daily homepage build (the prior "3L" that shipped as commit `7c1def4`). This audit uses a distinct filename to avoid clobbering that history. Rename / rearrange as you like.

Answers to the six audit questions, then a short list of drift-from-handoff items Rob should resolve before Commit 2 starts.

---

## Q1 — `/learn` location and data source

**File:** `app/learn/page.tsx` (the Daily homepage, commit `7c1def4`).

**Marked `export const dynamic = 'force-dynamic'`** — re-reads filesystem on every request. No static generation.

**Data source is the filesystem, via `@/lib/essays`.** No Supabase read anywhere in the Daily layout. The page calls:

- `listEssays({ includeScheduled: true })` — `readdir` + `readFile` + `gray-matter` over `content/essays/*.mdx`, sorted by `issue` desc. `includeScheduled` is silently ignored for non-admin viewers.
- `pickDailyLead(essays)` — prefers `daily_featured: true`, falls back to highest issue.
- `loadEssay(leadSlug, { includeScheduled: true })` — re-reads the lead file to extract body prose for the drop-cap intro.
- `rankForRail(essays)` — ranked (by `daily_rank` asc) then unranked (by issue desc).
- `leadIntro(body, 2)` — manual split on blank lines, strips JSX + md emphasis for the drop-cap paragraphs.

Also pulls `listFloorNotes()` (separate from essays) and renders `<FeaturedPodcasts>` (separate component).

**Perf shape:** 20 frontmatter parses + 1 full body parse on every request. Fast in practice (all local files, small). This is the current cost baseline to compare any migration against.

## Q2 — MDX frontmatter shape

Source of truth: `EssayFrontmatter` in `lib/essays.ts:17-62`. All 20 files conform; no per-file drift observed.

**Required fields** (always present, per `normalizeFrontmatter`):
`issue`, `slug`, `title`, `kicker`, `dek`, `filed_under`, `issue_label`, `read_minutes`, `published` (normalized to `YYYY-MM-DD` string).

**Optional fields:**
- `title_accent` — tail of title that renders italic (empty string when absent).
- `marginalia` — array of `{label: string, body: string}`. **Note:** the handoff SQL example assumes `{note, anchor}` — that shape is wrong. See Addendum A.
- `sources` — array of `{author, title, year, gloss, url?}`.
- `audio_url`, `audio_duration_seconds` — R2 M4A URL + ffprobe-derived duration.
- `publish_at` — ISO 8601 with tz offset; future dates hide essay from public surfaces (admins see via `includeScheduled`).
- `daily_featured: true` — **not used by any current essay.** `pickDailyLead` falls back to highest issue.
- `daily_rank` — integer. Ranked: 005–009, 011–020 (no rank on 010). **Unranked on the Daily rail: 001, 002, 003, 004, 010.**
- `daily_excerpt` — pull-quote override; falls back to `dek`.
- `share_kicker`, `share_quote_a`, `share_quote_b` — share-card copy.

All 20 files parse cleanly through `normalizeFrontmatter` — no per-file variation risk.

## Q3 — custom MDX body components

Complete list, from `components/essays/mdx-components.tsx`:

| Component | Props | Shape |
|---|---|---|
| `<Pullquote>` | children only | wrapper, prose inside |
| `<MaximStack>` | children only | wrapper of `<Maxim>` elements |
| `<Maxim>` | children only | wrapper, prose inside |
| `<Break>` | none | fleuron divider, no content |

**No component takes prose as a prop** (Marginalia and Sources are rendered from frontmatter, not body). Body-text extraction is straightforward: strip component tags, keep inner prose.

Other body constructs to handle:
- `<p className="lede">...</p>` — wrapper for the drop-cap paragraph. Strip tag, keep text.
- `<em>`, `<strong>`, `<a>` — standard inline HTML. Strip for search body (see Addendum B on `ts_headline` safety).
- `<sup>N</sup>` — source-ref superscripts (e.g., in 008). Strip.
- Markdown `*italic*`, `**bold**`, `_italic_`, `##` headings, escaped dollar signs `\$`. Normalize to plain text.
- `import` statements at top of MDX files — none observed across 20 files. Safe to assume none today; the sync script should still guard (skip any leading `^import ` line).

`<Break>` has no content — emits only hardcoded fleuron chars. Drop the tag entirely; no text to preserve.

## Q4 — MDX render pipeline

`next-mdx-remote/rsc` → `<MDXRemote source={body} components={essayMdxComponents} />` in `app/learn/[slug]/page.tsx:113`.

Body is fed as a raw string (output of `gray-matter.content`). No AST step, no remark/rehype plugins currently wired. Components come from `essayMdxComponents` (Q3).

**Implication for the sync script:** we can't cleanly reuse the MDX render pipeline to extract plain text (RSC is server-only, no headless render). Cheapest correct approach: regex-based tag stripping in the sync script. The set of tags is small and closed (see Q3), so this is low-risk. Alternative — pulling in `@mdx-js/mdx` + `remark-mdx` + a custom AST walker — is significantly more code and a second MDX toolchain to maintain. Recommend regex.

## Q5 — `/admin` structure

**Current:** flat page at `app/admin/page.tsx` → `<AdminClient>` with three inline sections (Users / Invites / Signup Requests).

**Precedent for nested:** `/admin/audit` already exists as its own route (`app/admin/audit/page.tsx` + `AuditClient.tsx`), linked from `AdminClient.tsx:226-236` via an "Audit Log →" button top-right of the admin page.

**Recommendation:** match the audit precedent — new nested route at `app/admin/essays/page.tsx` + `EssaysAdminClient.tsx`, linked from `/admin` with an "Essays →" button next to the existing "Audit Log →" button. No need to touch `DashboardNav` — the existing "Admin" link lands on `/admin`, where the user navigates to the essays sub-page. This also keeps `AdminClient` from growing a fourth long section.

Pattern to copy verbatim: `app/admin/audit/page.tsx` (8 lines of auth gate → render client component). Tables should reuse the `tableWrap`/`tableStyle`/`thStyle`/`tdStyle` constants from `AdminClient.tsx:583-591` for visual parity.

## Q6 — should the Daily homepage read from Supabase this phase?

**Recommendation: no. Leave the filesystem read alone.**

Reasons:
1. Filesystem read is fast — small essays, local disk, ~20 files. No user-visible latency.
2. `/learn` is `dynamic = 'force-dynamic'`. Migrating to Supabase adds a round-trip per request (slower than fs), unless we also add caching logic — scope creep.
3. Filesystem is already the source of truth; Supabase is only ever a derived index. Keeping the read path on the source avoids any possibility of stale Supabase data showing on the Daily layout.
4. The handoff explicitly defaults to "leave alone" and this audit finds nothing to contradict that.

Consequence: the Daily layout (hero + features grid + rail + pull-quote band) stays exactly as-is. Commit 5 adds the search UI *alongside* that layout; it does not replace the data path.

---

## Addenda — drift from handoff that needs Rob's call

### A. Marginalia shape: handoff SQL is wrong

Handoff's Commit 2 schema has:

```sql
setweight(to_tsvector('english',
  coalesce(
    (select string_agg(value->>'note', ' ') from jsonb_array_elements(marginalia)),
    ''
  )
), 'B')
```

Real frontmatter shape is `{label: string, body: string}`, not `{note, anchor}`. Proposed fix — aggregate both fields so labels (e.g. "On size", "Premise") and body prose both contribute to the B-weight bucket:

```sql
setweight(to_tsvector('english',
  coalesce(
    (select string_agg(
      coalesce(value->>'label','') || ' ' || coalesce(value->>'body',''),
      ' '
    ) from jsonb_array_elements(marginalia)),
    ''
  )
), 'B')
```

Confirm this is what you want before Commit 2.

### B. `ts_headline` + stored body need to be plain text

`ts_headline` wraps matches in `<b>...</b>`. If the stored `body` contains inline HTML (e.g., `<em>`, `<sup>`), the output may interleave those tags with the highlight tags, producing malformed HTML that `dangerouslySetInnerHTML` would render awkwardly — especially if a match boundary crosses an existing tag.

Proposed rule: the sync script stores `body` as **fully plain text** — JSX tags stripped, markdown emphasis unwrapped, whitespace collapsed. Consequence: snippets lose italics (acceptable — they're 15–30 word previews and the full essay is one click away). This also gives us a clean, predictable `<b>`-only highlight output and makes `dangerouslySetInnerHTML` safe.

Confirm.

### C. Sources not in the search vector

Handoff's search-weighting says "everything, weighted" but the SQL includes only title/dek (A), kicker/marginalia (B), body (C). `sources` (citation list in frontmatter) is excluded.

Three options:
1. Leave sources out (handoff's current SQL). Pro: simplest. Con: a search for "Kahneman" misses essays that only cite Kahneman in the sources block rather than name-dropping him in prose.
2. Include `sources.author` + `sources.title` + `sources.gloss` at weight C (same as body). Pro: citation-adjacent hits show up. Con: slightly noisier results.
3. Include at weight B (same as marginalia). Pro: scholarly hits rank high. Con: probably over-weighted — a citation isn't as on-topic as a margin note.

Recommend option 2. Low cost, matches intuition that a named author shouldn't be invisible to search.

### D. Live-essay count: 12, not 8

Handoff says "8 essays live (001–008). 009–012 drafted, not yet ported." Reality at Apr 20:

- **Live (no future `publish_at`): 001–012** (12 essays). 009–012 are ported, published, have audio, and carry `daily_rank`.
- **Scheduled (`publish_at` in the future): 013–020** (8 essays, Apr 22 through May 1).
- Total MDX files: 20.

Doesn't change the architecture. Does change:
- The admin list shows 20 rows, not 8. With `includeScheduled: true` on the server fetch, scheduled rows show too — recommend including them for the admin view (admins want to see what's queued), flagging them with a "scheduled" indicator or the `publish_at` date.
- The "orphaned from Daily" amber border applies to 001, 002, 003, 004, **and 010** (5 essays total with no `daily_rank`), not just 001–004.

### E. Vercel env injection vs local `--env-file`

Existing scripts in `package.json` run with `node --env-file=.env.local scripts/foo.mjs` for local dev. Vercel injects env vars directly into the build environment, so the `prebuild` script on Vercel must NOT use `--env-file` (the file doesn't exist in build containers).

Proposed approach:
- `package.json` adds `"prebuild": "node scripts/sync-essays.mjs"` — no `--env-file`. Vercel supplies env; CI is happy.
- For local smoke testing, run `node --env-file=.env.local scripts/sync-essays.mjs` manually. Document this in the script's header comment.

Alternative: have the script load `.env.local` itself via `dotenv` when present, fall back to `process.env` when not. Simpler for local testing, adds a dep (`dotenv`). Recommend the first approach — one-liner per context, no dep.

### F. Supabase RLS: admin reads fine under "authenticated read"

Handoff's proposed RLS: `for select using (auth.role() = 'authenticated')`. That covers both admin and non-admin authenticated users reading the essays table. `/admin/essays` uses the same `requireAdmin` API gate at the route level (not at the RLS level), consistent with how `/admin/audit` and `/admin/users` work today. No change needed — just flagging that admin-only access is enforced by the route, not the table policy.

---

## Commit 2 — ready to proceed once the six calls above are made

Pending your confirmation on:
1. **Addendum A** — marginalia aggregation wording for the tsvector.
2. **Addendum B** — strip all inline HTML/MDX from stored `body`, accept italics-free snippets.
3. **Addendum C** — include `sources.author` + `sources.title` + `sources.gloss` at weight C. (Yes / no / other.)
4. **Addendum D** — admin list shows all 20 essays including scheduled, with a scheduled indicator. (Yes / no.)
5. **Addendum E** — `prebuild` script uses bare `node scripts/sync-essays.mjs`, no `--env-file`.
6. **Scope re-confirm** — Daily homepage stays on the filesystem read path (Q6 default).

Reply with answers (or "LGTM on all"), and I'll start Commit 2 (migration SQL + sync script + prebuild wire-up).
