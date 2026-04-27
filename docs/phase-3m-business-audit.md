# Phase 3M — `/business` Section Audit

**Date:** 2026-04-26
**Status:** Pre-implementation. Blocks Commit 2 until Rob signs off.

> **Filename note:** the handoff specified `docs/phase-3m-audit.md`, but that path was already taken by the audit doc from a previous Phase 3M (share cards, committed `eb36dca`, Apr 16). Phase numbering got reused. This audit lives at `phase-3m-business-audit.md` to preserve the older doc. If you'd prefer to rename the older one, easy follow-up.

This audit answers the five questions from the Phase 3M handoff plus three follow-up findings I noticed while exploring. **Recommendation summary at the bottom — read that first if you only have a minute.**

---

## Recommendation summary (TL;DR)

1. **Reuse the essay theme via `.essay-page` scope.** `/business/[slug]` wraps content in the same `.essay-page` class so all typography, drop cap, audio player styling, and chrome inherits for free.
2. **Suppress the automatic Roman § counter on H2 with a small CSS modifier** (`.essay-page .article.no-sections h2::before { content: none; counter-increment: none; }`), added to `app/learn/essay-styles.css` in Commit 4. The business article element gets `className="article no-sections"`. Single-line CSS change, no theme duplication.
3. **Extract a shared `ReadingView` component** as the handoff suggests. The essay page (`app/learn/[slug]/page.tsx`) currently composes Masthead/Hero/audio/article/Sources/Share/Footer inline — there's no extracted component. Building `components/ReadingView.tsx` that takes generic frontmatter + body lets both surfaces use the same composition without duplicating the article-rendering code. Essay page passes essay-specific chrome (issue numbers, marginalia); business page passes minimal chrome (kicker, title, dek, byline, audio).
4. **Build a parallel `lib/business.ts`.** Don't extend `lib/essays.ts` — the editorial shapes are different enough (no `issue` number, no `title_accent`, no `marginalia` etc.) that mixing them creates messy union types.
5. **`publish-audio.mjs` does NOT support custom keys.** Use the fallback path: a small one-off Node script using `@aws-sdk/client-s3` for the R2 upload. ~30-40 lines.
6. **`force-dynamic` is required** on both new routes — same convention as `/learn` and `/learn/[slug]`.

---

## Q1 — Where does the essay reading theme live?

The reading theme is **not a single component** — it's a composition:

**Layout (the chrome wrapper):**
- `app/learn/[slug]/layout.tsx` — wraps detail pages in `<div className="essay-page">` and adds `<ReadingProgress />` at the top
- Imports `app/learn/essay-styles.css` (875 lines) — the entire editorial palette + typography lives here, scoped under `.essay-page`

**Page composition** (`app/learn/[slug]/page.tsx`, lines 78-121):
- Inline composition, NOT a single `<EssayDetail>` component:
  ```
  <EssayMasthead />              ← issue number, month/year, read time
  <EssayHero />                  ← kicker, title (with accent split), dek, byline
  {audio_url && <EssayAudioPlayer src={audio_url} />}
  <main className="content">
    <Marginalia side="left" />   ← renders empty aside when notes=[]
    <article>
      <MDXRemote source={body} components={essayMdxComponents} />
      <Sources items={...} />    ← renders empty aside when items=[]
    </article>
    <Marginalia side="right" />
  </main>
  <ShareSection slug, title />
  <EssayFooter issueNo, monthYear />
  ```

**Reusability per piece for `/business/[slug]`:**

| Component | Reusable? | Notes |
|---|---|---|
| `essay-page` CSS scope | ✅ as-is | Wrap business content in same class |
| `ReadingProgress` | ✅ as-is | No props, just a top progress bar |
| `essay-styles.css` | ✅ as-is | Whole stylesheet via the scope |
| `EssayMasthead` | ❌ | Hardcodes "Longboard *Essays*" brand + issue number. Need a parallel `BusinessMasthead` (or a slot-based shared masthead — your call) |
| `EssayHero` | ❌ | Hardcodes `issueNo`, `issueLabel`, `filedUnder`, `titleAccent`. Business updates have none. Need parallel `BusinessHero` (kicker + title + dek + byline only) |
| `EssayAudioPlayer` | ✅ as-is | Just takes `src: string`. See Q2 |
| `Marginalia` | ✅ as-is, with `notes={[]}` | Returns empty `<aside>` on empty input. Could also just omit the component |
| `Sources` | ✅ as-is, with `items={[]}` | Same pattern |
| `essayMdxComponents` (Pullquote, MaximStack, Maxim, Break + passthroughs) | ✅ as-is | Business MDX won't use Pullquote/MaximStack but they're available if Rob wants them in a future update |
| `ShareSection` | ✅ as-is | Takes slug + title. Optional for business — handoff doesn't mention sharing, but no harm including |
| `EssayFooter` | ❌ | Renders "Longboard Essays · No. NNN · Month Year". Need a parallel or slimmed footer |

**Recommendation:** extract `components/ReadingView.tsx` per the handoff's explicit instruction:

```ts
type ReadingViewProps = {
  masthead: ReactNode;     // page passes <EssayMasthead> or <BusinessMasthead>
  hero: ReactNode;         // page passes <EssayHero> or <BusinessHero>
  audioUrl?: string;       // optional, renders <EssayAudioPlayer> if set
  bodyMdx: string;         // raw MDX string for <MDXRemote>
  marginalia?: EssayMarginalia[];  // empty for business
  sources?: Source[];                // empty for business
  share?: { slug: string; title: string };  // optional
  footer: ReactNode;       // page passes <EssayFooter> or <BusinessFooter>
  articleClassName?: string;  // "no-sections" for business; default essay
};
```

The essay page (`/learn/[slug]/page.tsx`) becomes a thin wrapper that builds the children + passes them in. Same for the business page. Zero duplicated render logic.

**Trade-off:** this touches the just-stable Phase 3L `/learn/[slug]/page.tsx`. The risk is small (refactor to thin wrapper, no behavior change), but I want to flag it so it's not a surprise. Visual diff against `/learn/*` should be zero after the refactor.

---

## Q2 — Where is the audio player? Confirms it reads `audio_url`?

**Location:** `components/essays/EssayAudioPlayer.tsx`. Default export, props are just `{ src: string }`. 128 lines, zero dependencies on essay frontmatter — purely a generic audio player styled to the editorial aesthetic.

**Frontmatter wiring** (essay page, line 109):
```tsx
{frontmatter.audio_url && <EssayAudioPlayer src={frontmatter.audio_url} />}
```

The component itself doesn't read frontmatter — the page does. So our business page does the same:
```tsx
{frontmatter.audio_url && <EssayAudioPlayer src={frontmatter.audio_url} />}
```

**Renders cleanly when set:** yes. Component uses `preload="metadata"` so the duration populates before playback starts. Click-to-seek bar, play/pause toggle, mono time readout. CSS lives in `essay-styles.css` under `.essay-audio` — also scoped to `.essay-page`, so reusing the wrapper class gets the player styling for free.

**Suggested reuse name:** keep `EssayAudioPlayer`. It's not actually essay-specific — just named that way historically. Renaming to `AudioPlayer` would touch the essay page imports unnecessarily. Leave the name.

---

## Q3 — Where do essay frontmatter types live?

**Location:** `lib/essays.ts` (246 lines). Exports `EssayFrontmatter`, `EssayFile`, `Source`, `EssayMarginalia` types plus `listEssays`, `loadEssay`, `listEssaySlugs`, plus Daily-homepage-specific helpers (`pickDailyLead`, `rankForRail`, `dailyExcerpt`, `leadIntro`, `monthYear`).

**Conventions worth mirroring in `lib/business.ts`:**

1. **`gray-matter` + `readdir`** for parsing MDX frontmatter from `content/essays/`. Same pattern works for `content/business/`.
2. **`isPublished()` from `lib/publishing`** to gate by `publish_at`. The handoff explicitly asks for this — business updates respect `publish_at` for any future scheduled posts.
3. **`shouldBypassSchedule(opts)`** — admin-aware bypass for the `includeScheduled` parameter. Pulls `getCurrentUser()` and checks role. Defensive against unauth — silently returns false on auth errors. Mirror this exactly so admin preview works the same on `/business`.
4. **`normalizeFrontmatter(data)`** — coerces gray-matter's loose `Record<string, unknown>` into a typed shape, including handling YAML's quirky `published: 2026-04-26` Date-object parsing. The business shape needs the same treatment.

**`BusinessUpdate` frontmatter shape** (per the handoff Commit 2 spec):
```ts
type BusinessUpdate = {
  slug: string;
  title: string;
  kicker?: string;          // e.g. "Business Update"
  dek?: string;             // optional one-liner under title
  published: string;        // human-readable, "April 26, 2026"
  publish_at?: string;      // ISO 8601 with TZ offset
  read_minutes: number;
  audio_url?: string;
};
```

No `issue`, no `title_accent`, no `marginalia`, no `sources`, no `daily_*` fields. Strictly simpler.

**Why a parallel `lib/business.ts` (not extending essays):** the shapes are 70% disjoint, the editorial intent is different, and the `/business` index doesn't need the Daily-homepage helpers (`pickDailyLead`, `rankForRail`, etc.). Forcing them into a single union type would just push complexity into every consumer. Cheaper to duplicate the small shared parts (`shouldBypassSchedule`, `normalizeFrontmatter` skeleton) than to weave the types together.

**One small reuse opportunity:** the `monthYear()` formatter in `lib/essays.ts` is generic ("Apr 2026" from any date string). Either move it to `lib/dates.ts` (small refactor, also touches Phase 3L code), or duplicate the 4-line function into `lib/business.ts`. **Recommend duplicate** — keeps the refactor surface small.

---

## Q4 — How does `/learn` index list essays?

**File:** `app/learn/page.tsx`. It's the **Longboard Daily homepage**, not a flat essay list — heavy editorial chrome (masthead, lede grid, three-col features, "more from", floor notes, pull-quote band, newsletter, footer). The pattern that maps to a `/business` index is much simpler.

**The actual essay-listing pattern (relevant subset):**

```ts
import { listEssays } from "@/lib/essays";

export const dynamic = 'force-dynamic';

export default async function Page() {
  const essays = await listEssays({ includeScheduled: true });
  return (
    <div>
      {essays.map((fm) => (
        <Link key={fm.slug} href={`/learn/${fm.slug}`}>
          <h3>{fm.title}</h3>
          <p>{fm.dek}</p>
          <p>Issue {fm.issue} · {fm.read_minutes} min</p>
        </Link>
      ))}
    </div>
  );
}
```

**For `/business` index:** apply this skeleton with business frontmatter fields (no `issue` — use `published` date instead) and the `essay-page` wrapper class so the typography matches. The handoff says: "Renders the same chrome as `/learn` (page header, container, theme)." I read that as the **theme**, not the full Daily-homepage layout (which has ribbons, floor notes, etc. that don't apply). I'll build a clean index page styled with the essay theme but without the Daily homepage's editorial scaffolding.

**Sort order:** `listBusinessUpdates()` returns updates sorted by `publish_at` desc (newest first). Same convention as `listEssays()` which sorts by `issue` desc.

---

## Q5 — Is `force-dynamic` needed?

**Yes.** Both `/learn` (`app/learn/page.tsx:18`) and `/learn/[slug]` (`app/learn/[slug]/page.tsx:16`) declare `export const dynamic = 'force-dynamic'`. The reason is in `lib/essays.ts:79-80`: `shouldBypassSchedule()` calls `getCurrentUser()` which calls `cookies()` from `next/headers`. Cookie reads are dynamic by definition — Next can't statically generate or ISR-cache pages that depend on per-request session state.

`/business` and `/business/[slug]` will hit the same path through `shouldBypassSchedule()` for admin preview. They need `force-dynamic` for the same reason.

---

## Follow-up findings (not in the handoff's questions)

### F1 — Roman § automatic counter on H2

The essay theme automatically renders a "§ I", "§ II" Roman numeral above every `<h2>` via `.essay-page .article h2::before` (essay-styles.css:313):

```css
.essay-page .article h2::before {
  counter-increment: section;
  content: "§ " counter(section, upper-roman);
  ...
}
```

The handoff says "**No Roman §** for business updates."

**Solution:** add one CSS rule in Commit 4:

```css
.essay-page .article.no-sections h2::before {
  content: none;
  counter-increment: none;
}
```

Then the business page renders `<article className="article no-sections">`. Drop cap and other H2 typography stay; the Roman § disappears.

This is 4 lines of CSS, additive, no risk to `/learn/*`.

### F2 — `publish-audio.mjs` does NOT support custom keys

**Input paths (corrected from the handoff):**
- Source markdown: `docs/phase-3m-source.md` (handoff embedded the body inline; Rob has the canonical version here — Commit 3 copies from this file verbatim, no paraphrasing)
- Audio file: `/Users/Shared/Business-Update-4-26-26.m4a` (handoff said `~/Downloads/`; Rob moved it to `/Users/Shared/`)
- R2 output key: `business-update-2026-04-26.m4a`

I checked the script (`scripts/publish-audio.mjs:325-338`):
```js
.requiredOption("--episode <N>", "episode number (1-999)", parseEpisode)
...
const outputKey = `${pad3(episodeNo)}.m4a`;
```

The script is hardcoded to:
- `--episode <N>` required, validated as 1-999 integer
- R2 key derived as `NNN.m4a`
- Looks for `content/essays/NNN-*.mdx` to update frontmatter
- Auto-commits with "chore: add audio for issue NNN"

None of this fits the business-update flow. **Use the fallback path** the handoff suggests: a one-off Node script using `@aws-sdk/client-s3`. I'll keep it under 40 lines, take `--file` and `--key` args, run ffmpeg re-encode (same target: 96kbps mono AAC, ~10MB output), upload, print the public URL. No frontmatter writes, no auto-commit. Run it manually for this build; live alongside the existing script as `scripts/publish-audio-custom.mjs` for future non-episode uploads.

**Alternative I considered:** extending `publish-audio.mjs` to accept `--key` directly + `--no-frontmatter` + `--no-commit` flags. Rejected because the handoff explicitly says: "don't expand the publish script's scope here." Keep it focused on the essay flow.

### F3 — Main site nav: where to add "Business"

`/learn` lives in `components/DashboardNav.tsx:20` as `learnLink`. It renders for everyone (signed in or not) — anon users see only the Learn link; signed-in users see Workspace/Alpaca/TradeZero/Learn (+ Admin if admin).

**Plan for Commit 5:** add `businessLink = { href: "/business", label: "Business" }` adjacent to `learnLink`, included in both the anon and authed link arrays. Active state via the existing `pathname.startsWith(href)` check at line 70. This treats `/business` and `/business/*` consistently.

---

## Files that will change (proposed)

**New:**
- `docs/phase-3m-business-audit.md` — this file (Commit 1)
- `lib/business.ts` (Commit 2)
- `content/business/` directory (Commit 2)
- `content/business/business-update-2026-04-26.mdx` (Commit 3)
- `scripts/publish-audio-custom.mjs` (Commit 3, ~30-40 lines, one-off but reusable)
- `components/ReadingView.tsx` (Commit 4 — extracted shared composition)
- `components/business/BusinessMasthead.tsx` (Commit 4)
- `components/business/BusinessHero.tsx` (Commit 4)
- `components/business/BusinessFooter.tsx` (Commit 4)
- `components/business/UpdateList.tsx` (Commit 4 — right-side update list with active highlighting)
- `app/business/page.tsx` (Commit 4)
- `app/business/[slug]/page.tsx` (Commit 4)
- `app/business/[slug]/layout.tsx` (Commit 4 — same shape as `app/learn/[slug]/layout.tsx`, wraps in `essay-page` + ReadingProgress)

**Modified:**
- `app/learn/[slug]/page.tsx` (Commit 4 — refactor to use `ReadingView`)
- `app/learn/essay-styles.css` (Commit 4 — add `.no-sections` rule)
- `components/DashboardNav.tsx` (Commit 5 — add Business link)

**No changes to:**
- `lib/essays.ts` (untouched — business has its own module)
- `lib/publishing.ts` (reuses `isPublished` as-is)
- `components/essays/*` (all reused as-is in the new ReadingView composition)

---

## Open questions for Rob before Commit 2

1. **`ReadingView` extraction (Q1 / TL;DR #3):** confirm OK to refactor `app/learn/[slug]/page.tsx` to use a shared `ReadingView` component. Visual diff should be zero on `/learn/*` after the refactor; I'll spot-check both light and dark before pushing. If you'd rather keep `/learn/[slug]` exactly as-is and accept some duplication on `/business/[slug]`, say so — duplication is small (~50 lines).

2. **Right-side update list — sticky on desktop?** The handoff says "Sticky on desktop if the essay layout has a stickyable column; otherwise below-fold is fine for v1 — note it as a followup." Looking at the essay layout: it's a centered single-column article with marginalia in left/right slots (`.content` is `display: grid` with `grid-template-columns` for the marginalia + article). The marginalia slots ARE positioned, so a sticky right rail in place of right-marginalia is feasible. I'd recommend **sticky on desktop, below-content on mobile** for v1 — it's only marginally more code than the below-fold version and matches the editorial precedent of marginalia sitting in that slot.

3. **`ShareSection` on business updates?** Handoff doesn't say either way. Essays have it (Twitter/X share + copy link). Business updates probably want it too — Rob is going to want to share these from his social channels. **Recommend include**, opt out later if it feels off-brand.

4. **`scripts/publish-audio-custom.mjs` vs inline script in commit:** the handoff says "A 20-line Node script using `@aws-sdk/client-s3` is fine; don't expand the publish script's scope here." A persisted `scripts/publish-audio-custom.mjs` is reusable for future non-essay uploads (other audio content types we'll inevitably add). Alternative is a one-off ad-hoc script run from `/tmp` and not committed. **Recommend committed** — small file, future-proof.

5. **Audit doc filename collision** (mentioned at top): the handoff named it `phase-3m-audit.md`, but that file already exists from a previous Phase 3M (share cards, committed Apr 16). I wrote this audit to `phase-3m-business-audit.md` to preserve the older one. If you want me to rename the older file (e.g. to `phase-3m-share-cards-audit.md`) and use `phase-3m-audit.md` for this one, easy follow-up — say the word and I'll do it before Commit 2. Same git history; just `git mv`.

---

## Verification I plan to run before each subsequent commit

- **Commit 2:** `npx tsc --noEmit` clean. Add a smoke test that calls `listBusinessUpdates()` against an empty `content/business/` and asserts it returns `[]` without throwing.
- **Commit 3:** verify the audio file plays at `https://audio.longboardai.com/business-update-2026-04-26.m4a` in a browser. `loadBusinessUpdate("business-update-2026-04-26")` parses without errors locally.
- **Commit 4:** `npx tsc --noEmit` + `npm run build` clean. Visit `/business` and `/business/business-update-2026-04-26` in light + dark + statement themes. Confirm Roman § does NOT appear on H2s. Confirm audio plays. Confirm right-side list highlights the active update.
- **Commit 5:** `npx tsc --noEmit` + `npm run build` clean. Confirm Business nav link visible logged out + logged in, active state on `/business` and `/business/foo`.

---

*Awaiting Rob's go-ahead before Commit 2.*
