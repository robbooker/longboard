---
name: longboard-landing-install
description: Install a Claude-Design landing or thank-you page (HTML/JSX export) into the Longboard Next.js app. Triggers when a JSX/HTML mockup is dropped at the repo root and the user wants it wired up as a route — phrases like "install this as the home page", "wire up this thank-you page", "drop this in as /", "make this a route", "we need to add a new landing". Use this skill before touching any file. Codifies the Phase 3N (BubblesHome) and Phase 3O (ThankYou) install pattern.
version: 1.0.0
---

# longboard-landing-install

Codifies the install pattern for a Claude-Design landing/marketing/thank-you
page into the Longboard Next.js App Router app. Walks the same five-phase
flow we used in Phase 3N (BubblesHome at `/`) and Phase 3O (ThankYou at
`/thanks`). The goal is 10 minutes from "Rob dropped a JSX file" to "first
commit ready," not 90.

## When to use

- Rob drops a JSX or HTML file at the repo root that looks like a marketing
  page — landing, thank-you, pricing, signup-confirmation, post-purchase,
  etc. Filename is usually a kebab-case or PascalCase descriptor like
  `directionBubbles.jsx`, `thankyou.jsx`, `Longboard_Pricing_v2.html`.
- The conversation contains phrases like:
  - "install this as the home page"
  - "wire up this thank-you page"
  - "drop this in as /"
  - "make this a route at /<thing>"
  - "we need to add a new landing"
  - "this is from Claude Design — production-ready"
- Source files are described as "Claude Design output," "design exports,"
  or "HTML mockups intended for production."

## When NOT to use

- Component-level work inside an existing page (a tweak to a section of
  `/learn/[slug]`, a copy edit on the live `/`). Use the normal CC workflow.
- Edits to the live `/`, `/thanks`, `/learn`, or any other shipped route
  that doesn't involve a fresh design import.
- Anything that would touch the protected files list (below) without
  explicit, named permission from Rob.
- Work the user explicitly says is a one-off prototype not destined for
  production.

## Workflow — five phases

The skill maps onto Commit 0 (audit) + three implementation commits + a
final wrap. Total target: ~10 min on a clean asset-free page, ~30 min if
a hero image needs compression and forms need wiring.

### Phase 1 — Audit (Commit 0, blocks Commit 1)

Before touching any file, produce a short audit doc at
`docs/phase-{NN}-{name}-audit.md` answering five questions tailored to
the page being installed. The doc gates Commit 1 — Rob green-lights it
before any code lands. The five-question template lives in
`references/handoff-template.md` under "Audit first" and was used
verbatim for both Phase 3N and Phase 3O.

The audit covers: (1) where the target route lives or will live in the
app router tree, (2) how `DashboardNav` will be suppressed on the new
route, (3) any conflict with `globals.css` / Tailwind / theme system /
the global `.scanline` overlay, (4) hero image path + compression plan
if applicable, (5) which design-system props get locked at install vs
stay flexible.

### Phase 2 — Lock decisions with Rob

Wait for explicit approval on the audit. Don't proceed on silence — this
is the single highest-leverage gate in the whole flow. Most rework in
Phase 3N/3O came from props or pathnames that weren't locked before code
started.

### Phase 3 — Install (Commit 1: TSX conversion + asset move + nav wiring)

The biggest commit. Convert the source JSX to TSX, drop locked props
from the function signature, move any hero image into `/public/`, wire
the page into the App Router with a server-component page that exports
metadata + a client component that owns the UI, update internal nav
links to use Next `Link` for real routes / `<span>` for placeholders,
and add the new pathname to the `DashboardNav` suppression list. Recipe
in `references/bubbles-pattern.md`.

### Phase 4 — Mobile responsive (Commit 2)

The Claude Design exports almost always ship desktop-only. Add a
local-scoped `<style>` block with a `--{prefix}-hpad` CSS custom
property (48px desktop, 24px mobile) and `@media (max-width: 768px)`
overrides for: stacked nav, single-column grids, headline scaling,
gutters. The `--bub-hpad` (BubblesHome) and `--ty-hpad` (ThankYou)
patterns in `references/bubbles-pattern.md` are the canonical examples.

### Phase 5 — Cleanup + form wiring if applicable (Commit 3)

Two sub-recipes, applied if the page has them:

- **Cleanup:** orphaned components from a previous landing, `<head>`
  metadata polish, `app/(marketing)` route group migration if multiple
  marketing pages now exist.
- **Form wiring:** if the page has email-capture forms, wire them to
  `/api/subscribe` (Kit V4) — separate state per form, error slot with
  reserved `min-height`, redirect to `/thanks` on success. The
  CtaEmailForm extraction in `components/home/BubblesHome.tsx` is the
  reference implementation.

If the page has neither (e.g. a content-only thank-you), Commit 3 is
just metadata polish + final tsc/build clean and you wrap.

## Constraints (global)

- **Branch-protected `main`.** Always work on `feat/<descriptor>`.
  Push to the feature branch and open a PR; Rob reviews the Vercel
  preview URL before merge.
- **Single-line TS generics only.** Multi-line `Promise<\n | A \n | B \n>`
  shapes get corrupted by zsh bracketed-paste. Keep generic parameters
  on one line.
- **Merge commits, not squash.** Each commit (audit, install, mobile,
  cleanup) is a clean rollback unit on a live trading surface. The
  history is intentionally granular.
- **Per-commit rollback isolation.** Each commit must build and pass
  `tsc --noEmit` on its own. No "fix in next commit" handoffs across
  commit boundaries.
- **Image compression target ~500 KB – 1 MB** for any hero image.
  BubblesHome's hero went from 4.6 MB → 841 KB via `sharp` (quality 80,
  resized to 2480px wide for 2× retina at the 1240px container).
  Recipe in `references/bubbles-pattern.md`.
- **Audit (Commit 0) blocks Commit 1.** No exceptions, even for
  "obvious" installs. The audit is where the prop-locking and pathname
  decisions happen.
- **Don't auto-push.** Commits stay local until Rob says push.
- **Run the styling audit after styling changes** — see CLAUDE.md.
  Any new `var(--ink|--cream|--amber|--hairline|--font-display|--font-micro)`
  reference outside `app/command/` is a leak from the Command Center
  scope and will fall back to browser defaults.

## Protected files — DO NOT MODIFY without explicit instruction

Copied verbatim from `CLAUDE.md`. If a task seems to require touching
one of these, stop and ask Rob first.

- `app/globals.css` — site-wide CSS variables, color palette, font stack
- `app/layout.tsx` — root font imports, theme init script
- `app/learn/essay-styles.css` — essay editorial typography (Fraunces, Source Serif 4)
- `app/learn/daily.css` — daily research page
- `tailwind.config.ts` — shared design tokens

When building a new feature surface, scope all styling to a class on
that surface (`.bub-home`, `.ty-page`, `.command-page`). Define any new
CSS variables locally under that scope, NOT in `globals.css`.

## References

- `references/bubbles-pattern.md` — annotated breakdown of how the live
  `/` install (BubblesHome) actually works in the repo today. The
  canonical recipe for the TSX conversion, server/client split,
  metadata, nav wiring, scanline suppression, and image compression.
- `references/handoff-template.md` — copy-pasteable
  `LONGBOARD-PHASE-{NN}-HANDOFF-{DATE}.md` template with `{placeholders}`.
  Mirrors the Phase 3N and Phase 3O handoff structure.
