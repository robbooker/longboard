# Longboard — Phase 3B Handoff: Unified Theme Pass

**Date:** April 13, 2026
**Prerequisite:** Phase 3A shipped and verified in prod.
**Working dir:** `/Users/claudebot/longboard`
**Branch:** `main`
**Live URL:** https://longboardai.com

---

## Goal

Every page in Longboard respects the user's light/dark preference. Today only `/`, `/settings`, `/alpaca`, `/tradezero`, `/admin` honor the toggle. The research/terminal pages (`/workspace`, `/research/drop-and-pop`, `/surf`) are stuck on a fixed dark green-on-black palette regardless of setting.

**Two outcomes:**
1. Collapse the two parallel theme systems (`--bg/--accent/...` for dashboards and `--t-bg/--t-accent/...` for terminal pages) into one unified set of CSS variables.
2. Convert the terminal-themed pages to light/dark-aware so they track the user's preference.

---

## Decisions locked

- Unify into one variable set (drop `--t-*` namespace).
- Terminal pages convert to light/dark — no preserving "terminal" as a third theme option.
- Brand accents stay (`#d4af37` TZ gold, `#00a3ff` TZ blue) — those are sponsor lockup chrome, not theme.
- Login + `/login/forgot` should also get themed in this pass since they're still hardcoded hex per the Apr 13 outstanding-issues list.

---

## Current state (read this first)

From the Apr 13 EOD handoff:

> Note: `data-theme` attribute is now multi-use: `"light"` / `"dark"` for dashboards, `"terminal"` / `"longboard"` for research/surf. Variable namespaces (`--*` vs `--t-*`) prevent collision.

So today:
- `app/globals.css` defines two parallel CSS var sets.
- `<html data-theme="...">` is set by the layout's pre-paint script (light/dark) **and** by `components/ThemeSetter.tsx` (terminal/longboard).
- `ThemeSetter` cleanup was patched to restore localStorage on unmount so navigating through `/` or `/surf` doesn't wipe light/dark prefs.

After 3B:
- One var set (`--bg`, `--accent`, `--surface`, etc.). Terminal-namespaced vars deleted.
- `<html data-theme>` only ever holds `"light"` or `"dark"`.
- `ThemeSetter` deleted entirely (no longer needed).
- Research pages render in light or dark depending on user preference, using same vars as dashboards.

---

## Build plan — 5 commits, isolated for rollback

### Commit 1 — Audit + map terminal vars to unified vars

**No code changes. Output is a markdown report committed to `docs/theme-unification-map.md`.**

CC scans every file using `--t-*` vars and produces a mapping table:
| Terminal var | Maps to | Notes |
|---|---|---|
| `--t-bg` | `--bg` | direct |
| `--t-surface` | `--surface` | direct |
| `--t-accent` | `--accent` | direct |
| `--t-warn` | `--warning` | direct |
| `--t-danger` | `--danger` | direct |
| `--t-muted` | `--text-secondary` | semantically same |
| `--t-text` | `--text-primary` | direct |
| `--t-dim` | new `--text-tertiary`? or keep as `--text-secondary` with reduced opacity | **flag for Rob** |
| `--t-border` | `--border` | direct |

Plus a list of every file that consumes any `--t-*` var.

If any terminal var has no clean light-mode equivalent, CC flags it and proposes either (a) adding a new unified var or (b) collapsing to nearest existing var.

**Acceptance:** Rob reviews the map. CC waits for OK before commit 2.

### Commit 2 — Add any missing unified vars to globals.css

Based on the audit, add any new unified vars needed (e.g. `--text-tertiary` if the audit calls for it). Both light and dark values.

Don't touch the terminal vars yet — they stay alongside the new ones until commit 3 swaps consumers over.

### Commit 3 — Swap all terminal-var consumers to unified vars

Mechanical find-and-replace per the audit map. Files likely affected:
- `components/ThemeSetter.tsx` — will be deleted in commit 5, leave alone for now
- `app/research/drop-and-pop/**` — every component
- `app/surf/**` — every component
- `app/workspace/**` (the moved research workspace)
- Any shared research components in `components/research/*` or wherever they live

After this commit, the terminal vars are unused but still defined in `globals.css`.

Verify all 3 pages still load and look exactly the same in their current dark-terminal palette (because dark-mode unified vars match what terminal vars were).

### Commit 4 — Verify light mode looks right on research pages

Toggle to light mode, walk every research page. Anything that reads weird (low contrast, wrong color) gets fixed in this commit. Most issues will be:
- Hardcoded hex values that bypassed the theme system (search for `#0a0e0c`, `#00ff88`, `#1a1f1c` etc. in research files — anything found gets replaced with var refs)
- Components that assumed dark backgrounds and used near-black text without going through `--text-primary`
- Charts/graphs with hardcoded stroke colors

Same pass for `/login` and `/login/forgot` — both still use hardcoded hex per the outstanding issues list.

**Acceptance:** Toggle to light mode at `/settings`, then walk:
- `/workspace` — readable, no contrast problems
- `/research/drop-and-pop` — readable, no contrast problems
- `/surf` — readable, no contrast problems
- `/login` and `/login/forgot` — themed

### Commit 5 — Delete terminal vars + ThemeSetter

- Remove `--t-*` block from `app/globals.css`.
- Delete `components/ThemeSetter.tsx`.
- Remove ThemeSetter imports from any pages that were using it (likely `/`, `/surf`, maybe others — check).
- Remove the `removeAttribute` cleanup hack notes.

Verify nothing broke: walk every page in both themes one more time.

---

## Files expected to change

**New:**
- `docs/theme-unification-map.md` (commit 1, then deleted or kept as historical reference)

**Modified:**
- `app/globals.css` — add unified vars (C2), remove terminal vars (C5)
- All research/workspace/surf component files
- `app/login/page.tsx` and `app/login/forgot/page.tsx`
- Any other file the audit catches

**Deleted:**
- `components/ThemeSetter.tsx`

---

## Acceptance criteria

1. Toggle theme at `/settings` → every page in the app respects it within one navigation.
2. No flash of wrong theme on first paint (pre-paint script in `app/layout.tsx` already handles this — make sure 3B doesn't break it).
3. `grep -rln "var(--t-" app/ components/` → zero matches.
4. `grep -rln "ThemeSetter" app/ components/` → zero matches.
5. `grep -rln "#0a0e0c\|#00ff88" app/ components/` → only matches in `globals.css` (as the value of dark-mode vars), nowhere else.
6. Reading the research pages in light mode is comfortable (not just technically working — actually pleasant). If anything reads as washed-out or low-contrast, fix it.
7. Brand accents preserved: TZ blue (`#00a3ff`) and TZ gold (`#d4af37`) still appear on `/tradezero` sponsor lockup in both themes.

---

## Out of scope for 3B

- Splitting `data-theme` and `data-surface` (since terminal axis is being deleted, this becomes moot).
- Visual redesign of any page — this is a theming pass, not a design refresh.
- TradeZero card layering issue (`--surface-hi` token from Apr 13 outstanding list) — separate cleanup if light TZ feels flat after this lands.

---

## Working conventions (carried forward)
- One step at a time, explicit commands
- Each commit isolated for easy rollback
- Single-line TS generics only
- Commits stay local; Rob pushes manually via `git push origin main` from claudebot
- Don't hypothesize — give symptom + diagnostic data

---

*Save to Longboard project. New chat + this doc + "let's build Phase 3B" is enough to pick up cleanly.*
