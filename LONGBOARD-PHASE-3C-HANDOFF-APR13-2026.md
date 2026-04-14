# Longboard — Phase 3C Handoff: Unified Nav + User Menu

**Date:** April 13, 2026
**Prerequisite:** Phase 3B shipped and verified in prod.
**Working dir:** `/Users/claudebot/longboard`
**Branch:** `main`
**Live URL:** https://longboard-ruddy.vercel.app

---

## Goal

One consistent header on every page. Move per-page header chrome (theme toggle, account email, logout) into a dropdown user menu. Logo becomes the universal way home.

---

## Decisions locked

- **Logo** (`LONGBOARD.AI`) → links to `/` (marketing page) on every page, regardless of auth state.
- **Research link**: removed entirely from nav. The logo replaces it.
- **Nav links** (logged in only): `Workspace`, `Alpaca`, `TradeZero`, `Admin` (admins only).
- **Nav links** (logged out): none. Just logo + Sign In button.
- **User menu** (logged in only) — dropdown on the right side of nav:
  - Email (display only, top)
  - Theme: Light / Dark (toggle row)
  - Settings (link to `/settings`)
  - Logout
- **Same `DashboardNav` on every page** including `/` and `/login`.
- Theme toggle in `/settings` page **stays** — user menu version is a convenience duplicate, not a replacement.

---

## Current state (read this first)

`components/DashboardNav.tsx` today:
- Renders on `/alpaca`, `/tradezero`, `/admin`, `/settings`, `/workspace` (probably — verify).
- Has links: LONGBOARD.AI logo (currently → `/`), Research (→ `/workspace`?), Alpaca, TradeZero (Live).
- Right side: user email + Logout button.
- Active-state highlighting based on current route.
- Shows Admin link conditionally based on `/api/auth/me` role.
- **Not** rendered on `/` (marketing) — that page has its own minimal nav.
- **Not** rendered on `/login` or `/login/forgot`.

Marketing page (`/`) has its own custom nav today: logo + ("Go to Workspace →" if logged in, "Sign In" if not).

---

## Build plan — 4 commits, isolated for rollback

### Commit 1 — Refactor DashboardNav: remove Research, add user menu

- Remove the "Research" nav link entirely.
- Update logo link: `/` (was probably `/` already, but verify and lock).
- Replace right-side `email + Logout` with a `<UserMenu />` dropdown component (new file: `components/UserMenu.tsx`).
- `UserMenu` props: `email`, `role`, `onLogout`, `theme`, `onThemeChange`.
- Dropdown contents:
  - Email (text, dim color, no action)
  - Divider
  - Theme row: "Theme" label + toggle (sun/moon icons or "Light / Dark" pills — designer's choice, IBM Plex Mono, themed via CSS vars)
  - Settings link
  - Logout button
- Click outside / Escape closes the dropdown.
- Keyboard accessible (Tab, Enter, Escape).
- Use existing CSS vars (`--bg`, `--surface`, `--border`, `--text-primary`, `--accent`, `--danger`).

**Theme state:** the menu reads/writes `localStorage["longboard-theme"]` and updates `<html data-theme="...">` directly, same pattern as the existing `/settings` toggle. No new state plumbing needed.

### Commit 2 — Render DashboardNav on every page

- Lift `<DashboardNav />` into `app/layout.tsx` so it renders on all routes automatically.
- Remove individual `<DashboardNav />` imports/renders from each page that has one (`/alpaca`, `/tradezero`, `/admin`, `/settings`, `/workspace`).
- Remove the marketing page's custom nav from `app/page.tsx`.
- Add nav to `/login` and `/login/forgot` (just by virtue of the layout change).
- `/onboarding` — also gets it. That's fine; user is technically authenticated by then anyway.

**Nav variants based on auth state:**
- Logged out: logo + Sign In button (right side, no user menu).
- Logged in: logo + Workspace/Alpaca/TradeZero/Admin links + UserMenu.
- Auth state fetched via existing `/api/auth/me` (already used by current nav).

### Commit 3 — Verify nav looks right on every page in both themes

- Walk every page in light mode, then dark mode.
- Active-state highlighting: confirm current route is highlighted correctly on Workspace/Alpaca/TradeZero/Admin links.
- UserMenu dropdown: opens/closes correctly, theme toggle works instantly, no flash.
- `/` and `/login` look right with the new nav (previously they didn't have one — make sure spacing/visual hierarchy still works).
- Mobile: dropdown should still be usable. If the nav links wrap or overflow under 768px, collapse them into the user menu (or accept a small mobile-nav fix as a follow-up).

### Commit 4 — Cleanup

- Delete any now-unused page-level nav code (e.g. marketing page's custom logo + Sign In button).
- Search for orphaned imports of removed components.
- Run `tsc` clean.

---

## Files expected to change

**New:**
- `components/UserMenu.tsx`

**Modified:**
- `components/DashboardNav.tsx` — remove Research link, integrate UserMenu
- `app/layout.tsx` — render DashboardNav globally
- `app/alpaca/page.tsx`, `app/tradezero/page.tsx`, `app/admin/AdminClient.tsx` (or wherever), `app/settings/SettingsClient.tsx`, `app/workspace/page.tsx` — remove individual DashboardNav imports
- `app/page.tsx` — remove custom marketing nav

---

## Acceptance criteria

1. Every page has the same `DashboardNav` at the top.
2. Logo on every page → links to `/`.
3. No "Research" link anywhere in nav.
4. Logged-out user sees: logo + Sign In button. No nav links, no user menu.
5. Logged-in user sees: logo + Workspace/Alpaca/TradeZero (+ Admin if admin) + UserMenu.
6. UserMenu opens on click, closes on click-outside or Escape.
7. UserMenu shows: email, Theme toggle, Settings link, Logout button.
8. Theme toggle in UserMenu flips theme instantly across all pages without reload.
9. Active nav link is visually highlighted on the current page.
10. Both themes look right on every page.
11. `/settings` theme toggle still works (not removed).

---

## Out of scope for 3C

- Mobile hamburger menu (collapse-to-menu) — if mobile nav overflows, fix in a follow-up.
- Avatar/profile picture (no user-uploaded images yet).
- Notification bell / dropdown — separate phase if/when we have notifications.
- Replacing the `/settings` theme toggle (the UserMenu version is a convenience, not a replacement).

---

## Working conventions (carried forward)
- One step at a time, explicit commands
- Each commit isolated for easy rollback
- Single-line TS generics only
- Commits stay local; Rob pushes manually via `git push origin main` from claudebot
- Don't hypothesize — give symptom + diagnostic data

---

*Save to Longboard project. New chat + this doc + "let's build Phase 3C" is enough to pick up cleanly.*
