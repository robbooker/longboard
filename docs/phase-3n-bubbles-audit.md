# Phase 3N — Bubbles Home Page · Audit

**Status:** pre-implementation audit. Commit 0 of the Phase 3N (bubbles) plan. No code changes in this commit.
**Date:** 2026-04-30
**Author:** CC
**Handoff:** `LONGBOARD-PHASE-3N-HANDOFF-APR30-2026.md`

> Note: a separate `docs/phase-3n-audit.md` exists from a renumbered/shelved
> Phase 3N effort (whisper.cpp + essay generation, dated 2026-04-16). That
> doc is preserved as-is. This audit is the bubbles home-page version.

Five questions from the handoff. Answers below. Rob's green-light on
this doc gates Commit 1.

---

## 1. Where does `/` live today?

`app/page.tsx` (single file, no route group, no `app/(marketing)/` wrapper).

It's a `"use client"` component called `LandingPage` — the Phase 3A
marketing landing. Inline-styled hero + 3 features + below-the-fold
list + Request Access form (POSTs to `/api/signup-requests`) + footer.
Uses theme CSS variables (`var(--bg)`, `var(--accent)`, etc.) so it
tracks light/dark.

**Implication for Commit 1:** the new `app/page.tsx` will replace
this file in place. The old `LandingPage` component is self-contained
(`FeatureCard` is local, the form uses inline styles, no external
imports beyond React) — nothing else in the repo imports from
`app/page.tsx` so removal is clean.

The signup form POST target `/api/signup-requests` is referenced
ONLY from this file. Whether to keep that API route or rip it out
is a Commit 3 cleanup question — flagging here so we don't forget.

---

## 2. How is `DashboardNav` rendered, and how do we suppress it on `/` only?

**Today:** unconditionally rendered from `app/layout.tsx` line 63,
inside `<body>` before `{children}`. Every route gets it. DashboardNav
itself is already a client component (`"use client"`) and already
calls `usePathname()` to highlight the active link.

**Three options considered:**

| Option | What | Pro | Con |
|---|---|---|---|
| (a) Early-return inside DashboardNav | `if (pathname === "/") return null;` at the top of the component | One-line change, no layout restructure, DashboardNav already has `usePathname()` | Component still mounts, runs the auth fetch. Minor — auth fetch is harmless on `/` (response just gets discarded). |
| (b) Pathname check in layout | Make a thin client wrapper around DashboardNav that reads pathname and conditionally renders | Layout stays the source of truth | Adds a new file for one boolean. Overkill. |
| (c) Route group `(marketing)` with its own layout | Move `app/page.tsx` into `app/(marketing)/page.tsx`, give that group a `layout.tsx` that omits DashboardNav | Cleanest separation, scales if more marketing routes appear | Larger restructure, touches `app/layout.tsx`, root metadata, theme init script — risk of regression on every other page. Out of scope for 3N. |

**Recommendation: (a).** Single-line gate at the top of DashboardNav,
keyed on `pathname === "/"` (exact match — `/login`, `/learn` etc. all
keep the nav). The auth-fetch overhead is negligible on a marketing
page that anonymous visitors hit; it's the same cost we already pay
on `/login`.

```tsx
// in DashboardNav, after usePathname():
if (pathname === "/") return null;
```

That's the whole change.

---

## 3. Does `globals.css` or Tailwind interfere with the bubbles inline styles?

**Skim summary:** mostly fine. Three things to flag.

### What's safe

- `* { box-sizing: border-box; }` — bubbles already assumes this.
- Tailwind's `@tailwind base` reset — DirectionBubbles inline-styles
  every element it cares about (fonts, sizes, colors, padding) so the
  Tailwind reset (e.g. `h1 { font-size: inherit }`) doesn't fight
  anything. The component sets its own font-family on the outer
  wrapper and overrides per-element.
- `body { font-family: var(--font-labels) }` — overridden by the
  bubbles outer `<div>` setting `fontFamily: fonts.body`.
- `::-webkit-scrollbar` styling using `var(--bg)` — the body bg
  underneath the bubbles wrapper is invisible since the wrapper covers
  the viewport with `#FCFBF8`, so only the scrollbar track might pick
  up the theme bg. Cosmetic at most.

### What to flag

1. **`.scanline` overlay** in `app/layout.tsx:62`. The `<div className="scanline" />` renders globally and is `position: fixed` over every page. CSS hides it outside dark mode (`:root:not([data-theme="dark"]) .scanline { display: none }`). On `/`, if the user has dark theme persisted, a 2px green-tinted stripe will animate down across the paper-white bubbles design. The bubbles design is "always paper-white and ignores light/dark" — the scanline directly contradicts that.

   **Options:** leave it (minor visual leak in dark mode only), or have `app/page.tsx` force `data-theme="light"` on mount via the html element. Lighter touch: just leave it for Commit 1 and let Rob look at dark-mode QA in Commit 2 before deciding.

2. **`::selection` colors** use `var(--accent-20)` / `var(--accent)`. In dark mode, selecting text on the bubbles page highlights with bright neon-green on the cream. Cosmetic, low priority.

3. **Theme init script** in `app/layout.tsx` may set `data-theme="dark"` on the html element if that's the user's stored preference. The bubbles outer div hardcodes its colors and ignores theme — so the page renders correctly visually, but the html attribute is "dark." The DashboardNav theme toggle on other pages stays consistent. No action needed.

**Bottom line:** no blocking interference. The scanline is the only real concern, and only in dark mode; recommend deferring the decision to Commit 2 visual QA.

---

## 4. Hero image path

**Source location now:** `bubbles-illustration.png` at the repo root (4.6 MB).

**Target:** `/public/bubbles-illustration.png` — Next.js serves files in
`/public/` at the URL root. The bubbles JSX has:

```jsx
<img src="assets/bubbles-illustration.png" ... />
```

**Update to:**

```jsx
<img src="/bubbles-illustration.png" ... />
```

(Note the leading `/` — without it, the browser would resolve relative
to whatever route is active.)

**Why plain `<img>`, not `next/image`:** the bubbles design uses
`width: '100%'; height: 'auto'` on the hero image inside a 1240px
max-width container. `next/image` requires explicit `width`/`height`
and a defined sizing strategy (`fill`, `responsive`, etc.). For a
single hero image where the source dimensions match the design
intent, plain `<img>` is fewer moving parts. We can revisit if LCP
becomes an issue — the image is 4.6 MB, which is fat; Phase 3N could
optionally do a one-time `pngquant` or `oxipng` pass before moving it
to `/public/`. **Flagging for Rob's call.**

(Also note: the `alt` text on this image is excellent — a full
description of the cartoon scene including all the speech-bubble
text. Don't shorten it during the JSX → TSX conversion.)

---

## 5. Locked design-system props

**From the bundle HTML default state** (`Longboard Permanent Landing v4 - Bubbles - bundle-src.html` lines 44–49):

```json
{
  "headlineVariant": "E",
  "typePair": "inter",
  "showThreeUp": true,
  "showSampleEmail": true,
  "showTestimonials": true,
  "showSecondCTA": true
}
```

**Confirms the handoff doc's stated preferences exactly.**

For the live page, we lock these — the design-system props become
non-props. Cleanest implementation: remove the props entirely from
the function signature and inline the values, since:

- This isn't a tweaks panel anymore — it's the real home page.
- TS conversion is simpler without optional props with default values.
- Lock-in matches Rob's "this is the version we're shipping" intent.

**Other props in the JSX signature:**

- `mode = 'light'` — comment says "ignored — this variant is always paper-white." Drop.
- `accent = '#15120B'` — comment says "kept in signature for tweaks-panel parity, but visually unused." Drop.
- `portraitSrc = 'assets/rob.jpg'` — declared but never referenced anywhere in the component body (grepped). Dead prop. Drop.

**Resulting locked behavior:**

- Headline variant E: *"There are 1,000 trading apps. **You only need one**."* (italic on "You only need one")
- Type pair "inter": Helvetica/Helvetica Neue display + body, Georgia serif for italic emphasis, Courier New mono for eyebrow labels.
- All four optional sections rendered: 3-up cards · sample email · testimonials · second CTA.

---

## Summary — what Commit 1 will do

1. Move `bubbles-illustration.png` → `/public/bubbles-illustration.png`.
2. Replace `app/page.tsx` with a TSX-converted, prop-locked version of `DirectionBubbles`. Strip `mode`, `accent`, `portraitSrc`, and the design-system toggle props. Inline the locked values.
3. Update hero `<img src>` to `/bubbles-illustration.png`.
4. Wire nav: "Essays" → "Learn" linked to `/learn` (Next.js `<Link>`); "Pricing" + "Podcast" stay as `<span>` with cursor:pointer (no route); "Member sign in" → `/login` via `<Link>`.
5. Add a one-line early-return in `components/DashboardNav.tsx`: `if (pathname === "/") return null;`.
6. `tsc` clean, `npm run build` clean.

**Defer to Commit 2 / 3:**
- Dark-mode scanline behavior (Commit 2 visual QA call).
- Image compression (`pngquant`) — Rob's call.
- Removing the now-orphaned `/api/signup-requests` API route (Commit 3 cleanup).
- Updating `<head>` metadata (title/description/OG) to match the new copy (Commit 3).

---

## Gate

Commit 1 does not start until Rob green-lights this doc.
