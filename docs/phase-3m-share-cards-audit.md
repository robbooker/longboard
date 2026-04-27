# Phase 3M — Audit

**Status:** pre-implementation audit. Commit 0 of the Phase 3M plan. No code changes in this commit.
**Date:** 2026-04-16
**Author:** CC

Six open questions from the handoff. Answers below. Rob's
green-light on this doc gates Commit 1.

---

## 1. Rendering engine — **Puppeteer**

Option (a). Headless Chrome screenshots of the card HTML template.

**Why:** fidelity. The mockup at `mockups/longboard-share-cards-v3.html`
is the pixel-level reference. Puppeteer renders it with a real
browser engine — no CSS-subset surprises, no Satori font-loading
gotchas, no "why doesn't `position: absolute` work like it does in
Chrome" debugging. The trade-off (Chromium download size, 2–3s per
card) is irrelevant for a build-time CLI that runs locally, not on
Vercel.

50 cards × 2.5s ≈ 2 min. Acceptable.

Satori (option b) would be defensible if we needed runtime
generation, but we don't — the handoff locks this as a manual CLI.
@vercel/og (option c) is a runtime wrapper around Satori; overkill
for build-time bulk work.

**Dependency:** `puppeteer` (npm). Chromium comes bundled. No
additional system deps beyond what `npm install` handles.

---

## 2. Script execution — **manual CLI**

Option (a). `npm run generate-cards -- --all` or
`npm run generate-cards -- --slug <slug>`.

**Why:** same reasoning as Phase 3K's audio publish script — manual
invocation keeps the workflow predictable and debuggable. Rob runs
it after writing or editing an essay. No build-step injection, no
pre-commit hook.

Can promote to a Vercel build step later if it proves reliable and
the 2-min build-time overhead is acceptable. For v1, local only.

---

## 3. Quote selection — **hybrid with frontmatter override**

Option (c). Default behavior: use `share_quote_a` and
`share_quote_b` from frontmatter. Fallback behavior when absent:
auto-parse the first two `<Maxim>` or `<Pullquote>` blocks from
the MDX body.

In practice Rob will backfill `share_quote_a` / `share_quote_b`
on all 8 essays during C1, using the exact strings from the v3
mockup. The auto-parse fallback exists for new essays where Rob
forgets to set the fields — it'll produce something usable rather
than a blank card.

**Frontmatter shape per essay (optional fields):**

```yaml
share_quote_a: "The quote for Treatment A (cream card)."
share_quote_b: "The quote for Treatment B (dark card)."
```

---

## 4. Kicker line — **new `share_kicker` field, fallback to `issue_label`**

The existing `kicker` field is "An essay, mostly about feelings" —
that's the Levine-voice hero kicker on the essay page, not a
card-sized topic tag. The mockup uses short labels like
"On automation", "On self-knowledge".

The closest existing field is `issue_label` ("Automation",
"Self-efficacy", "Leadership"). These are usable but not identical
to the mockup's phrasing, so:

- **New optional field:** `share_kicker`.
  Example: `share_kicker: "On automation"`.
- **Fallback:** `"On " + issue_label.toLowerCase()` when
  `share_kicker` is absent. Produces "On automation", "On
  leadership", "On self-efficacy" — close enough for essays where
  Rob doesn't override.

Rob backfills the mockup's exact `share_kicker` values on all 8
essays during C1.

---

## 5. Output file naming + OG integration

**File naming:** `public/og/{slug}-{treatment}-{size}.png`

| Treatment | Size | Suffix | Use |
| --- | --- | --- | --- |
| A (cream) | 1200×630 | `-a-og.png` | OG / Twitter / LinkedIn |
| A (cream) | 1080×1080 | `-a-square.png` | Instagram feed |
| A (cream) | 1080×1920 | `-a-story.png` | Instagram story |
| B (dark) | 1200×630 | `-b-og.png` | Alt OG / social posting |
| B (dark) | 1080×1080 | `-b-square.png` | Instagram feed (alt) |
| B (dark) | 1080×1920 | `-b-story.png` | Instagram story (alt) |

**OG integration:** Phase 3I shipped a dynamic `opengraph-image.tsx`
route in `app/learn/[slug]/` that renders OG cards via Satori at
request time. Phase 3M replaces this with a static reference to the
generated Treatment A OG PNG.

Concrete change (in C3):
- Update `generateMetadata()` in `app/learn/[slug]/page.tsx` to set
  `openGraph.images` explicitly to `/og/{slug}-a-og.png`.
- Delete `app/learn/[slug]/opengraph-image.tsx` — the generated
  static PNG replaces it. The index-level
  `app/learn/opengraph-image.tsx` stays (it's a generic card for
  the Daily homepage, not essay-specific).
- Twitter card meta (`summary_large_image`) points at the same
  Treatment A OG PNG.

**Instagram variants:** served statically from `/og/`, no meta tags.
Rob downloads manually for posting.

---

## 6. Idempotency — **overwrite, no hash check**

Option (a). Re-running the script with the same inputs overwrites
existing PNGs silently. No hash-based skip logic. 50 cards in
2 min is fast enough that the complexity of input-change detection
isn't worth it for v1.

---

## Cross-cutting confirmations

### Frontmatter additions per essay (C1 backfill)

Three new optional fields:

```yaml
share_kicker: "On automation"         # short topic tag for cards
share_quote_a: "Treatment A quote."   # explicit cream-card quote
share_quote_b: "Treatment B quote."   # explicit dark-card quote
```

All three fall back gracefully when absent, so existing/future
essays don't break. C1 backfills exact mockup values on all 8.

### Existing OG route disposition

`app/learn/[slug]/opengraph-image.tsx` (Phase 3I) gets deleted in
C3 once the static PNGs are generated and the metadata points at
them. The index OG route (`app/learn/opengraph-image.tsx`) is
untouched — it's not essay-specific.

### Mockup dependency

`mockups/longboard-share-cards-v3.html` isn't in the repo yet.
Same pattern as Phase 3L: Rob drops it in before C1 so the card
template can be ported pixel-accurately.

---

## Gate

Commit 1 does not start until Rob green-lights this doc **and**
drops `mockups/longboard-share-cards-v3.html` into the repo.
