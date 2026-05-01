# handoff-template.md — copy-pasteable Phase XX handoff

## How to use this template

When Rob asks for a new landing/marketing/thank-you page install:

1. Copy the template below into a new file at the **repo root** named
   `LONGBOARD-PHASE-{NN}-{NAME}-{MMM}{DD}-{YYYY}.md`. Examples from the
   real repo: `LONGBOARD-PHASE-3N-HANDOFF-APR30-2026.md`,
   `LONGBOARD-PHASE-3O-HANDOFF-MAY01-2026.md`.
2. Replace every `{placeholder}` with the actual value. The
   placeholders are bash-style and easy to grep — `grep -o '{[^}]*}'` will
   list every one before you start.
3. Delete sections that don't apply (e.g. "Image compression" for an
   asset-free page like `/thanks`; "Form wiring" for a page with no
   email-capture forms).
4. Hand the doc to Rob for review **before** writing any code. The
   audit (Commit 0) gates the first implementation commit.

The audit-first-then-three-commits structure is the same shape used
for both Phase 3N (BubblesHome at `/`) and Phase 3O (ThankYou at
`/thanks`). Don't deviate without a reason.

---

## TEMPLATE — copy from here down

```markdown
# Longboard — Phase {NN} Handoff: {Page Name}

**Date:** {Month DD, YYYY}
**Prerequisite:** `main` clean at `{commit-sha}` ({short note about what's just landed}).
**Working dir:** `/Users/claudebot/longboard`
**Branch:** `feat/{descriptor}`
**Live URL:** https://www.longboardai.com/{route}

---

## Goal

{One paragraph. What page is being installed, where it lives in the
route tree, why it exists, what aesthetic family it belongs to (paper-
white bubbles family, command-center scope, learn editorial, etc.). If
it's replacing a previous page, name the predecessor.}

---

## Source files (Rob is dropping these into the repo)

- `{filename1.jsx}` — {one-line description; usually "the React component"}
- `{filename2.html}` — {standalone preview, reference only}
- `{filename3.png}` — {hero image if applicable, with current uncompressed size}

(All untracked at the repo root. Do not commit these source files —
they're the design-export artifacts. The TSX conversion goes into the
app router tree; the image moves into `/public/`.)

---

## What we need

1. {Drop the design in as the new {route} page.}
2. {Wire {button label} → {route}.}
3. {Change {label} in the internal nav to {new label} → {route}.}
4. {Leave {placeholder} as a dead link (`<span>` placeholder, not `<a href="#">`).}
5. {Suppress global `DashboardNav` on {route} — extend the existing pathname check.}
6. {Form submit handlers: stay as `e.preventDefault()` placeholders OR wire to `/api/subscribe`. Pick one and say which.}
7. {Any specific copy edits or address changes — e.g. swap brief@longboard.ai → rob@lightningstocks.io.}

---

## Audit first (Commit 0 — no code yet)

Before writing any code, produce `docs/phase-{NN}-{name}-audit.md`
answering:

1. **Where does the {route} route live (or where will it live)?**
   `app/{route}/page.tsx`? `app/(marketing)/{route}/page.tsx`? Confirm
   the path and whether anything currently exists there to replace.

2. **How is `DashboardNav` rendered today, and what's the cleanest
   suppression for {route}?**
   Today it's unconditionally rendered from `app/layout.tsx` and
   early-returns null inside the component on a hard-coded pathname
   list. The current list is in `components/DashboardNav.tsx`. Propose
   the exact one-line update.

3. **Does `globals.css`, Tailwind, the theme system, or the global
   `.scanline` overlay interfere with the design's inline styles?**
   Skim `app/globals.css` and `app/layout.tsx`. Flag the scanline if
   the design is paper-white. Flag any `::selection` color mismatches.

4. **{Hero image path + compression plan}** — if the design ships an
   image. Source path now (likely repo root), target path
   (`/public/{asset}.png`), how the JSX `<img src>` reference needs
   to change (leading slash), and a compression plan if the source is
   > 1 MB. Target ~500 KB – 1 MB. (Skip this question entirely if the
   page has no hero image.)

5. **Which design-system props get locked at install?**
   Read the source JSX function signature. List every prop and
   classify each as: drop (no live effect), inline (one value used,
   bake it in), or keep (legitimately variable across renders — rare
   for a live page). Reference: BubblesHome locked `headlineVariant`,
   `typePair`, all four `show*` toggles, and dropped `mode`, `accent`,
   `portraitSrc`.

**Wait for Rob to OK the audit before Commit 1.**

---

## Build plan — 3 commits after audit

### Commit 1 — install ({TSX conversion + asset move + nav wiring})

- Move `{asset}.png` → `/public/{asset}.png` (if applicable).
- {Compress the asset to ~500 KB – 1 MB if needed — see
  `references/bubbles-pattern.md` §8.}
- Create `app/{route}/page.tsx` (server component, exports metadata).
- Create `components/home/{Name}.tsx` (`"use client"`, owns the UI).
  Convert the source JSX to TSX. Drop / inline locked props per audit.
- Update internal nav links: real routes use Next `<Link>`,
  placeholders use `<span>`. Wire {Member sign in} → `/login` if applicable.
- Extend the `DashboardNav` pathname check to suppress on `{route}`.
- Suppress `.scanline` via local `<style>` block scoped to the page.
- `tsc --noEmit` clean, `next build` clean.

**Acceptance:** the new route renders end-to-end at the Vercel preview;
no global nav appears; no scanline in dark mode; all `Link` destinations
resolve.

### Commit 2 — mobile responsive

- Add `--{prefix}-hpad` CSS custom property to the page wrapper. 48px
  desktop, 24px mobile. Apply via `padding: "{Y}px var(--{prefix}-hpad)"`
  on every section.
- `@media (max-width: 768px)` overrides: stacked nav, single-column
  grids (3-up, 2-up, sample-email two-col), headline scaling, gap
  collapses. Recipe in `references/bubbles-pattern.md` §8.
- Visual QA on mobile + desktop at the Vercel preview. Test light AND
  dark theme — paper-white pages should look identical in both.

**Acceptance:** the page reads cleanly at 320px / 375px / 768px / 1240px
breakpoints. No horizontal scroll. Headlines don't dwarf the screen.

### Commit 3 — {cleanup AND/OR form wiring}

**Cleanup sub-recipe (always):**
- Remove or archive predecessor components if orphaned. **Search before
  deleting** — use `grep -rln '<Name>' app/ components/` to confirm
  no other references.
- `<head>` metadata polish if the page-level metadata needs to differ
  from the layout-level fallback.
- Final `tsc --noEmit` + `next build` clean.

**Form wiring sub-recipe (only if the page has email-capture forms):**
- Replace every `onSubmit={(e) => e.preventDefault()}` with a real
  handler that POSTs to `/api/subscribe`.
- Each form owns its own `useState` for `submitting` + `error` —
  no shared state between forms.
- On `{ok: true}` → `window.location.href = "/thanks"`.
- On `{ok: false, error}` → inline error in a reserved-`min-height`
  slot below the input row. Messages: `"Please enter a valid email."`
  for `invalid_email`, `"Something went wrong. Try again in a moment."`
  for everything else.
- Disable input + button during in-flight; swap button label to
  "SENDING…" / "Sending…".

**Acceptance:** real Kit V4 subscriber created end-to-end; success
redirects to `/thanks`; error states display without layout shift.

---

## Constraints / conventions

- **Single-line TS generics only** — zsh paste corruption rule.
- **Don't auto-push.** Commits stay local; Rob pushes the branch and
  opens the PR manually.
- **Audit (Commit 0) blocks Commit 1** on Rob's explicit green-light.
- **Don't touch protected files** without named permission:
  - `app/globals.css`, `app/layout.tsx`, `app/learn/essay-styles.css`,
    `app/learn/daily.css`, `tailwind.config.ts`.
- **Run the styling audit** after every styling change:

  ```
  grep -rln "var(--ink\|var(--cream\|var(--amber\|var(--hairline\|var(--font-display\|var(--font-micro)" app/ components/
  ```

  Any matches outside `app/command/` are leaks from the Command Center
  scope. Report in the final summary.
- **One question/instruction at a time** when reporting back.
- **Don't hypothesize bug causes** — give symptoms + diagnostic data
  if anything goes sideways.

---

## Out of scope for {NN}

- {Wiring the email form to Kit/Resend} — IF this is a phase that
  intentionally defers form wiring. Otherwise delete.
- {Building the missing `/pricing` or `/podcast` pages} — placeholder
  routes stay as `<span>` until separate phases.
- {Theme support for the new page} if the design is paper-white-always.
- {Replacing or rewriting the hero illustration.}
- {Any change to `/learn`, `/login`, or other existing pages.}

---

*Save this doc to the Longboard project root. New chat + this doc +
"let's build Phase {NN}" is enough to pick up cleanly.*
```

---

## Worked examples in the repo

- `LONGBOARD-PHASE-3N-HANDOFF-APR30-2026.md` — BubblesHome at `/` (with
  hero image; no form wiring; orphan cleanup of Phase 3A landing).
  This is the canonical reference for an image-bearing install.

The Phase 3O install (ThankYou at `/thanks` + Kit V4 wiring on `/`) was
delivered as a single chat-pasted handoff rather than a saved
`LONGBOARD-PHASE-3O-HANDOFF-*.md` file. The shipped commits
(`feat/thanks-and-kit` branch) are the reference for: an asset-free
install (no hero image, so the §6/§7 image sections of `bubbles-pattern.md`
are N/A), and the form-wiring sub-recipe in §10.

Reading the Phase 3N handoff alongside this template should make the
placeholder substitutions obvious.
