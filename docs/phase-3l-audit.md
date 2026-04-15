# Phase 3L — Audit

**Status:** pre-implementation audit. Commit 0 of the Phase 3L plan. No code changes in this commit.
**Date:** 2026-04-15
**Author:** CC

The handoff for Phase 3L lists seven open questions for the audit
phase. This doc records CC's recommendation on each, with reasoning.
Rob's green-light on this doc gates Commit 1.

One thing that's not on the seven-question list but matters: the
handoff points at `mockups/longboard-daily.html` as the pixel-level
source of truth for layout. **That file is not in the repo yet.**
Commit 1 (the layout shell) can start without it if Rob is OK with
CC working from the written description alone, but for tight fidelity
the mockup needs to land first. Flagging here so it's not a
last-minute block.

---

## 1. Lead-story selection — **flag with fallback**

`daily_featured: true` frontmatter flag on one essay; latest by issue
number when no flag is set. Matches the handoff's recommendation.

**Why:** gives Rob editorial control without a CMS. Fallback to
"latest" means if Rob forgets to set the flag the page still renders
the right thing.

**Constraint:** if two essays have `daily_featured: true`, pick the
one with the higher issue number. Cheap, deterministic, no schema
ambiguity.

---

## 2. Tape ribbon — **static placeholder**

Option (a): hardcoded SPY/QQQ/VIX/MARA text in the ribbon for v1.
Real Polygon wiring deferred to 3L.5.

**Why:** same reasons the handoff gives — don't hammer Polygon for
unauthenticated visitors, don't block the Daily launch on a
data-pipeline decision. The ribbon is visual chrome in v1; the
editorial content is the story.

**Concrete:** ticker values shown as written in the mockup, with a
`{/* TODO(3L.5): wire to Polygon snapshot */}` comment above the
block so future-me finds it easily.

---

## 3. Hosts grid — **cut entirely**

Option (a): no hosts grid in v1. Bellafiore / Raschke / "Floor Tapes"
were placeholder content in the mockup — none of those shows exist.

**Why:** empty or "coming soon" sections kill credibility. The page
still reads complete without this band — lead story, features,
pull-quote, newsletter form all carry the weight.

When there's a real show to populate the band (3N's `/watch` phase),
the hosts grid reappears; for now it doesn't exist.

---

## 4. From the Floor — **MDX collection**

Option (a): `content/floor/*.mdx` with date + ticker + author
frontmatter and a short body. `lib/floor.ts` reader following the
same pattern as `lib/essays.ts`. Top 4 most-recent entries render in
the black band.

**Why:** lowest effort, gives Rob full editorial control, matches the
rest of the content workflow (essays, future floor notes, all as
MDX files committed via git). No admin UI, no auth surface, no
Supabase table. Rob drops a file in, rebuilds, it appears.

**Alternative not chosen:** Supabase-backed with `/admin/floor` form
(option b) — overkill for text snippets Rob writes once a day. Cutting
to 3L.5 (option c) is fine too if Commit 4 feels heavy; not my call.

**Scaffold details:**

```
content/floor/
  README.md         (contract doc, mirrors content/essays/README.md)
  .gitkeep
```

Frontmatter shape:
```yaml
---
timestamp: 2026-04-15T09:34:00-04:00
ticker: MARA
author: Rob Booker
---
```

Body is the short prose line. Reader sorts descending by `timestamp`,
slices to 4, renders as the mockup's black band.

---

## 5. Newsletter form — **Supabase-backed**

Option (a): new `newsletter_subscribers` table, POST via
`/api/newsletter/subscribe`, service-role write. Resend integration
deferred.

**Why:** the job today is to collect emails. Sending to them is a
separate shape of work (Audience management, unsubscribe handling,
bounce processing) that deserves its own phase. A plain Supabase
table gets Rob the list and defers nothing that matters for v1.

**API route contract:**

- Method: POST only.
- Body: `{ email: string }`.
- Server-side email validation (simple regex, defer "is this really
  deliverable" to actual send-time).
- Capture `user_agent` from request headers.
- Capture `ip_hash` as `sha256(ip + NEWSLETTER_IP_SALT)` —
  privacy-preserving, useful if we ever need to reject abuse patterns,
  never stores raw IPs. Salt goes in `.env.local`.
- On email already present, return 200 with
  `{ ok: true, already_subscribed: true }` — UI shows a friendly
  message, no duplicate row.
- On validation failure, 400 `{ error: 'invalid_email' }`.
- On DB error, 500 `{ error: 'server_error' }`.

---

## 6. Surface theming — **scoped `.daily-page` wrapper**

Option (b): all cream/ink/moss vars scoped inside a `.daily-page`
container class in `/learn`. Rest of the app's light/dark system is
untouched.

**Why:** architecturally cleanest. Alternatives:

- (a) `data-surface="daily"` — adds another overloaded `data-*` axis.
  Phase 3B's open items list already flags `data-theme` overloading
  as a concern; stacking a third axis on top would be a regression.
- (c) Repaint light mode cream everywhere — changes the dashboard's
  appearance for users who don't go anywhere near `/learn`. Outright
  broken.

**Concrete shape:** `app/learn/daily.css` imported by the new
`/learn` page. All selectors prefixed `.daily-page …`. Variables
defined on `.daily-page` itself:

```css
.daily-page {
  --paper: #f4efe6;
  --ink: #1a1a1a;
  --ink-soft: #333;
  --muted: #666;
  --moss: #1f3d2a;
  --moss-deep: #0f2017;
  --rust: #8b3a1f;
  --rule: rgba(0, 0, 0, 0.12);
  ...
}
```

Essay detail pages (`/learn/[slug]`) use the existing `.essay-page`
scope from Phase 3H — Daily and Essay scopes are siblings, both
scoped, no bleed between them. This matches how the editorial
aesthetic already lives.

---

## 7. Most-read ranking — **`daily_rank` with issue-desc fallback**

Option (b): optional `daily_rank: <number>` frontmatter field per
essay (lower = higher in the rail). Essays without a rank sort by
issue desc after the ranked ones.

**Why:** same logic as Q1 — editorial control without a CMS. Fallback
to issue desc means if Rob doesn't set any ranks, the rail reads as
"newest first" exactly like the current list.

**Deterministic ordering:**
1. Essays with `daily_rank` set, ascending by rank (1, 2, 3, …).
2. Unranked essays after, descending by `issue`.
3. Truncate to top 4 for the rail.

---

## Cross-cutting confirmations

### Frontmatter additions

Three optional fields per essay, all with sensible defaults:

```yaml
daily_featured: true        # at most one essay; picks highest issue if ambiguous
daily_rank: 1               # lower = higher in most-read rail
daily_excerpt: "…"          # used in rail pull-quote + bottom pull-quote band
```

`daily_excerpt` falls back to the first sentence of the essay body
if absent — the pull-quote band should never be empty.

### Data shape consumers

The new `/learn` page needs, at build time:

- All essays' frontmatter (same pipeline as current Phase 3H reader).
- All floor entries if Q4 stays MDX.

No client-side data fetching. Everything resolves at
`generateStaticParams`-like time for the index page itself, which is a
plain server component rendered once per build.

### Routes unchanged

- `/learn/[slug]` — essay detail pages stay exactly as Phase 3H/3J
  shipped them. Only Commit 5 touches them, and only to add a single
  "← Back to Daily" link.
- `DashboardNav`'s "Learn" link still points to `/learn` (now the
  Daily homepage). No nav change.

### Mockup dependency

Flag up top: `mockups/longboard-daily.html` isn't in the repo. The
handoff says "when in doubt, match the mockup pixel-for-pixel." CC
can start Commit 1 with the written description alone — ribbon +
masthead + lead+rail grid + three-column features + pull-quote +
newsletter — but for final pixel fidelity the mockup needs to land
before QA at Commit 6.

---

## Gate

Commit 1 does not start until Rob green-lights this doc and (ideally)
drops the mockup into `mockups/longboard-daily.html`.
