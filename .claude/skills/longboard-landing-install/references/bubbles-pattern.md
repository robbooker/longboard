# bubbles-pattern.md — annotated breakdown of the live install

The canonical install recipe, derived from reading the actual files in
the repo as of Phase 3O. Two reference implementations exist —
`/` (BubblesHome) and `/thanks` (ThankYou) — and they diverge in a few
places. Variations are flagged inline as **Variation:** notes; the
default recipe here matches BubblesHome (the more complete of the two).

Verify each path against the current repo before applying — these
references are accurate as of the Phase 3O merge but the codebase
moves.

---

## 1. Server / client component split

**Pattern:** the App Router `page.tsx` is a server component that does
nothing but export `metadata` and render the client component. The
actual UI lives in `components/home/<Name>.tsx` as a `"use client"`
component.

**Reference — `/`:**

- `app/page.tsx` (~16 lines, server component, exports `metadata`)
- `components/home/BubblesHome.tsx` (the UI)

**Reference — `/thanks`:**

- `app/thanks/page.tsx` (~11 lines, server component, exports `metadata`)
- `components/home/ThankYou.tsx` (the UI)

**Why the split:** metadata can only be exported from server components.
The UI needs `"use client"` because it owns event handlers (forms,
countdown timer). The split keeps the `metadata` export declarative
and the UI free to use hooks.

**Recipe:**

```tsx
// app/<route>/page.tsx
import type { Metadata } from "next";
import <Name> from "@/components/home/<Name>";

export const metadata: Metadata = {
  title: "<page title>",
  description: "<one-line description>",
};

export default function Page() {
  return <<Name> />;
}
```

```tsx
// components/home/<Name>.tsx
"use client";

import React from "react";
import Link from "next/link";

// ...constants, fonts, helpers...

export default function <Name>() {
  // hooks + JSX
}
```

---

## 2. Metadata fields populated

Both reference pages populate exactly two fields on the page-level
`metadata`:

- `title` — the full page title; replaces the layout-level fallback.
- `description` — one sentence, used by search engines and social
  previews.

**`/` example:**

```tsx
export const metadata: Metadata = {
  title: "Longboard — One email. The #1 stock of the day.",
  description: "One email. The #1 stock of the day, plus four more worth watching. 9:15am Eastern. Free.",
};
```

**`/thanks` example:**

```tsx
export const metadata: Metadata = {
  title: "Welcome to the Brief — Longboard",
  description: "You're in. Your first morning brief lands at 9:15 AM Eastern.",
};
```

**OG image:** neither page sets an explicit OG image. The site root has
no `opengraph-image.tsx` asset — adding one is out of scope for an
install. `metadataBase` is set once in `app/layout.tsx` so any future
`opengraph-image.tsx` resolves against the right origin.

---

## 3. Locking design-system props at install

Claude Design exports almost always ship with a function signature full
of design-tweak props:

```jsx
// directionBubbles.jsx (source export)
function DirectionBubbles({
  mode = "light",
  accent = "#15120B",
  headlineVariant = "E",
  typePair = "inter",
  showThreeUp = true,
  showSampleEmail = true,
  showTestimonials = true,
  showSecondCTA = true,
  portraitSrc = "assets/rob.jpg",
}) { ... }
```

**At install, lock these.** This is the live page, not a tweaks panel.

**Three categories:**

1. **Drop entirely** (the prop has no live effect): `mode`, `accent`,
   `portraitSrc` from BubblesHome were all dropped because the variant
   ignores `mode`/`accent` (paper-white always) and `portraitSrc` was
   never referenced in the body.
2. **Inline the value, drop from signature** (the prop has an effect
   but the live page only ever uses one value): `typePair = "inter"`
   was inlined as the `fonts` constant; `headlineVariant = "E"` was
   inlined as the `HEAD` array.
3. **Toggle props on**: `showThreeUp`, `showSampleEmail`, etc. — drop
   the conditionals entirely; render the section unconditionally.

**Result:** the function takes zero props. Fewer moving parts, simpler
TS conversion, and the file declares its intent clearly.

**Variation — ThankYou:** the `typePair` prop was the only design prop
on the source. Same pattern — dropped from signature, inlined as the
`fonts` constant.

---

## 4. Internal nav — Next `<Link>` vs `<span>`

**Rule:** if the route exists, use Next `<Link href="...">`. If it
doesn't yet exist (placeholder destination), use a `<span>` with the
same `lpw-link` / `lpty-link` className for hover styling parity. Do
NOT use `<a href="#">` for placeholders — that scrolls the page to
the top on click.

**Live wiring (BubblesHome):**

```tsx
<Link href="/learn" className="lpw-link" style={{ color: fg, textDecoration: "none" }}>Learn</Link>
<span className="lpw-link" style={{ color: fg }}>Podcast</span>
<span className="lpw-link" style={{ color: fg }}>Pricing</span>
<Link href="/login" className="lpw-cta lpw-cta-primary" style={{ ... }}>Member sign in</Link>
```

**ThankYou** uses the same pattern — Learn/login as `<Link>`, Podcast
and Pricing as `<span>`.

**Pre-existing JSX usually has buttons or `<a>` tags here.** Convert
on install — don't leave a button-styled login redirect behind a
JS handler when a `<Link>` does the same job with no JS cost.

---

## 5. Suppressing the global DashboardNav

**Mechanism:** `components/DashboardNav.tsx` is rendered unconditionally
from `app/layout.tsx`, but the component itself early-returns `null`
when `pathname` matches a suppression list. Each new landing-style
route adds itself to that list.

**Current suppression check** (in `components/DashboardNav.tsx`, after
all hooks):

```tsx
if (pathname === "/" || pathname === "/thanks") return null;
```

**To add a new route:** extend the OR chain. For more than 3-4 entries,
move to a `Set` lookup or a `startsWith` check, but for now the OR
chain is fine.

**Why not a route group `(marketing)` with its own layout?** Considered
in the Phase 3N audit and rejected as too disruptive — would touch
`app/layout.tsx`, root metadata, and the theme-init script. The
single-line gate has zero blast radius beyond DashboardNav itself.
Revisit when the marketing routes hit ~5+ pages.

**The component still mounts and runs its auth fetch even when it
returns null.** Negligible cost — the same auth fetch already runs on
every other page.

---

## 6. Hero image — location and reference style

**Location:** `/public/<asset>.png`. Next.js serves `/public/` files at
the URL root.

**Reference style:** plain `<img src="/<asset>.png">` with leading slash.
Do NOT use `assets/<asset>.png` (no leading slash) — it resolves
relative to the current route.

**Why plain `<img>`, not `next/image`:** the BubblesHome hero uses
`width: '100%'; height: 'auto'` inside a 1240px max-width container.
`next/image` requires explicit `width`/`height` and a sizing strategy
(`fill`, `responsive`, etc.). For a single hero image where the source
dimensions match the design intent, plain `<img>` is fewer moving
parts. Revisit if LCP becomes an issue.

**Don't shorten the alt text on import** — the Claude Design exports
typically ship a long, accessibility-grade alt text (BubblesHome's hero
alt describes the cartoon scene including all speech-bubble copy).
Preserve it verbatim during the JSX → TSX conversion.

**Variation — ThankYou:** no hero image. This whole section is N/A
when the page is asset-free.

---

## 7. Image compression — sharp recipe

**Target:** 500 KB – 1 MB for a hero image. BubblesHome's source PNG
was 4.6 MB and would have wrecked LCP; the optimized version in
`/public/` is 841 KB.

**The compression actually used** (per the `feat(home)` commit
`bd071c0` body):

> `pngquant`-equivalent palette compression via `sharp` at quality 80,
> resized to 2480px wide for 2× retina at the 1240px container.

**Approximation in code:**

```bash
# Using sharp via npx — no global install needed
npx sharp-cli -i bubbles-illustration.png -o public/bubbles-illustration.png \
  resize 2480 \
  --png.quality 80 --png.palette
```

If `sharp-cli` isn't on path, equivalent results from `pngquant`:

```bash
pngquant --quality=70-85 --output public/bubbles-illustration.png bubbles-illustration.png
```

**Verify after compression:**

```bash
ls -lh public/<asset>.png
```

Should land in 500 KB – 1 MB. If still > 1 MB, drop quality to 70 or
the resize width to 1860px. If < 200 KB and visibly degraded, raise
quality to 90.

**Keep the source.** The original 4.6 MB PNG sits at the repo root as
an untracked file, so the next compression pass starts from the
lossless original, not the already-compressed output.

---

## 8. Mobile responsive recipe

Both reference pages use the same pattern: a single CSS custom property
controls horizontal gutters, and one `@media (max-width: 768px)` block
collapses every grid + scales the headline.

**Step 1 — declare the gutter var on the outer wrapper:**

```css
.<prefix>-page { --<prefix>-hpad: 48px; }
@media (max-width: 768px) {
  .<prefix>-page { --<prefix>-hpad: 24px; }
}
```

**Variation — naming:** BubblesHome uses `--bub-hpad`; ThankYou uses
`--ty-hpad`. The prefix is per-page, not shared. Pick a 2-3 letter
prefix unique to the page.

**Step 2 — consume the var in every section's padding string:**

```tsx
padding: "88px var(--bub-hpad)"  // or var(--ty-hpad), etc.
```

**Step 3 — `@media (max-width: 768px)` overrides:**

The patterns that recur across both pages:

- **Stack the nav:** `.<prefix>-nav-inner { flex-direction: column; gap: 16px; }` — note the inline desktop default uses `flex-direction: row`, so this is an additive property and doesn't need `!important`.
- **Wrap nav links:** `.<prefix>-nav-links { gap: 18px !important; flex-wrap: wrap; }` — `gap` needs `!important` because the inline style sets it to 32.
- **Collapse 3-up grids to 1 column:** `.<prefix>-3up { grid-template-columns: 1fr !important; }` — `!important` because the inline style sets 3 cols.
- **Drop dividers between collapsed cells:** `.<prefix>-3up-cell { padding: 28px 0 !important; border-right: none !important; border-bottom: 1px solid <line>; }`
- **Scale the headline down:** `.<prefix>-cta-headline { font-size: 44px !important; letter-spacing: -1.4px !important; }`

**The `!important` rule of thumb:** add `!important` when the CSS rule
is overriding a value the inline style already sets (gap, padding,
grid-template-columns). Skip `!important` when the CSS is adding a
new property (flex-direction, flex-wrap).

---

## 9. Suppressing the global `.scanline` overlay

The `<div className="scanline" />` in `app/layout.tsx` renders a
2px green-tinted animated stripe over every page in dark mode. The
paper-white landing aesthetic doesn't want that.

**Recipe** — inside the page's local `<style>` block:

```css
/* Suppress global scanline overlay while this page is mounted. */
.scanline { display: none; }
```

This is global CSS, but it's only present in the DOM while the page is
mounted, so it cleans up on navigation. Both BubblesHome and ThankYou
use this pattern.

---

## 10. Form wiring (only if the page has email-capture forms)

**Reference:** `components/home/BubblesHome.tsx` after Phase 3O Commit 3.

**Architecture:**

- Two forms on the page (hero + second-CTA). Each owns its own state
  — submitting / error — so a submit on one doesn't change the other's UI.
- Hero form lives inside the existing `EmailForm` component; the
  second-CTA inline form was extracted into a new `CtaEmailForm`
  component for symmetry.
- Both call a shared `postSubscribe(email)` helper that POSTs to
  `/api/subscribe` and returns `{ ok: true }` or
  `{ ok: false, error: "invalid_email" | "subscription_failed" }`.

**On success:** `window.location.href = "/thanks"` — full nav, fresh
page (not `router.push`, because we want a clean DOM and to flush any
in-flight state).

**On error:** show an inline message below the input row. Use a
reserved `min-height` slot so the error appearing/clearing doesn't
push other content around:

```tsx
<div role="alert" aria-live="polite" style={{
  minHeight: 18,
  fontFamily: fonts.mono, fontSize: 12,
  color: "#C0392B",  // or "#F08080" on dark backgrounds
}}>
  {error || " "}
</div>
```

**During in-flight:**

- Disable both `<input>` and `<button>`.
- Swap button label to "SENDING…" / "Sending…".
- Set `cursor: wait`, `opacity: 0.7`.

**API contract** (`/api/subscribe` — see Phase 3O Commit 2):

- POST `{ email: string }` → 200 `{ ok: true }` or 400/502 with
  `{ ok: false, error: "invalid_email" | "subscription_failed" }`.
- Forwards to Kit V4: `POST https://api.kit.com/v4/forms/{form_id}/subscribers`
  with `X-Kit-Api-Key` header and `{ email_address }` body
  (NOT `{ email }` — Kit V4 uses `email_address`).
- Form ID is hardcoded in the route file; lift to env when it changes.

**Variation — ThankYou:** no forms. This whole section is N/A.

---

## 11. Audit before code

Always — no exceptions. The audit doc lives at
`docs/phase-{NN}-{name}-audit.md` and answers the five-question
template in `references/handoff-template.md`. Rob's green-light on
the audit gates Commit 1.

The single highest-leverage gate in the install flow.
