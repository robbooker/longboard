# Longboard — Working Conventions for Claude Code

This file is read automatically by Claude Code at the start of every session.
Both Rob's and Garth's CC sessions should follow these rules.

## Branch and PR discipline

- Do not commit directly to `main`. Always work on a feature branch.
- After making commits, push to the feature branch and open a PR.
  Do not push to `main`.
- The repo owner reviews the Vercel preview URL before merging.

## Protected styling surfaces — DO NOT MODIFY without explicit instruction

The following files are shared across multiple pages and have an
established editorial identity. Do NOT modify them unless the user
explicitly names the file in their instructions. If a task seems to
require touching one of these, stop and ask first.

- `app/globals.css` — site-wide CSS variables, color palette, font stack
- `app/layout.tsx` — root font imports, theme init script
- `app/learn/essay-styles.css` — essay editorial typography (Fraunces, Source Serif 4)
- `app/learn/daily.css` — daily research page
- `tailwind.config.ts` — shared design tokens

When building or modifying a feature surface (e.g. Command Center,
dashboards, a new section), scope all styling to a class on that surface
(e.g. `.command-page`, `.alpaca-page`). Define any new CSS variables
locally under that scope, NOT in `globals.css`.

If a feature genuinely needs a new global token, propose it in the PR
description and wait for approval before adding it to `globals.css`.

## Fonts — do not change without permission

- Site default is IBM Plex Mono, imported in `app/layout.tsx`. Do not remove it.
- Essays use Fraunces + Source Serif 4 + JetBrains Mono, imported in
  `app/learn/essay-styles.css`. Do not change them.
- Command Center uses Helvetica Neue / Georgia / Courier New, scoped under
  `.command-page` in `app/command/command.css`.

## Commit and push pattern

- Commit each logical change separately for clean rollback (live trading surface).
- Single-line TypeScript generics only — multi-line `Promise<\n | A \n | B \n>`
  shapes get corrupted by zsh bracketed-paste.
- Don't push to `main`. Push to a feature branch and open a PR.

## Before finishing a styling task

After making styling changes, run this audit:

    grep -rln "var(--ink\|var(--cream\|var(--amber\|var(--hairline\|var(--font-display\|var(--font-micro)" app/ components/

If any matches appear OUTSIDE `app/command/`, they reference vars that
only exist in the Command Center scope and will fall back to browser
defaults on other pages. Either remove the references or scope them
properly. Report any matches in the final summary.

## Admin morning-email archive

The `morning_email_archive` table snapshots every successful brief from
`/admin/morning-email` (id, sent_date, subject, stocks_json, qa_json, html,
generated_by, generated_by_email, created_at). Multiple rows per `sent_date`
are expected — each is a distinct generation, distinguished by `created_at`.
RLS is on with no policies; all access goes through service role +
`requireAdmin` in `/api/admin/morning-email/*` routes.
`/admin/morning-email/history` lists, views (srcDoc'd from the stored `html`),
and hard-deletes rows. Generation is the only write surface — no edit, no
resend from history.
