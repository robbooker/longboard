# Longboard — Phase 3D Handoff: TradeZero Cleanup (Rip Locates + Hotkeys)

**Date:** April 13, 2026
**Prerequisite:** Phase 3C shipped and verified in prod.
**Working dir:** `/Users/claudebot/longboard`
**Branch:** `main`
**Live URL:** https://longboard-ruddy.vercel.app

---

## Goal

Strip the TradeZero page down to a functional long-only trading dashboard. The locate marketplace, borrow cost calculator, hotkeys panel, and related shorting infrastructure were built as a premium sponsor-tier demo. That pitch is dead — function over pitch.

---

## Decisions locked (don't re-debate)

- **Rip locates entirely.** No "disabled for now" state, no "coming soon" placeholder. Delete.
- **Remove the hotkeys panel entirely.** F-key reference card is non-functional and misleading. Delete.
- **Quick Order becomes BUY / SELL only.** No SHORT, no COVER.
- **Position table: drop long/short distinction.** Just show qty and P&L.
- **Keep TradeZero branding** (sponsor header lockup, TZ blue + gold). The page still is the live trading surface; the pitch is just no longer about shorts.
- **Keep:** Halt/SSR ticker strip (useful info even long-only), AI Pattern Alerts, Level 2 book, Time & Sales, account strip, order entry (BUY/SELL), positions, open orders, today's activity log, route column on positions.

---

## Current state (read this first)

`/tradezero` today renders these sections (per Apr 12 build notes):

1. Sponsor header (LONGBOARD.AI // POWERED BY TRADEZERO, TZ blue + gold) — **keep**
2. Red LIVE ACCOUNT badge — **keep**
3. Halt/SSR ticker strip (LUDP/SSR/T12 flags) — **keep**
4. Account strip (Equity, Buying Power 4:1 intraday, Cash, Day P&L, Open P&L) — **keep** (maybe simplify BP wording since we're not using margin for shorts)
5. Positions table with route column + SHORT pills — **keep table, drop SHORT pills**
6. ★ Short Locate Marketplace ★ — **DELETE**
7. My Locates cart — **DELETE**
8. Borrow Cost Calculator — **DELETE**
9. AI Pattern Alerts — **keep**
10. Level 2 order book — **keep**
11. Time & Sales tape — **keep**
12. Hotkey panel (F1–F12 reference) — **DELETE**
13. Quick Order with SHORT button — **keep, strip SHORT button, remove COVER**

Backend locate infrastructure to delete:
- `app/api/tradezero/locates/route.ts` (POST + GET)
- `lib/killSwitch` references to blocking locates (keep the kill switch itself, just drop the locate-specific guard)
- `BrokerNotConfiguredBanner` — no change needed; still relevant for orders
- Any `SECRET_LABELS` entries specific to locates — unlikely, but check

TradeZero proxy endpoints to stop calling:
- `/accounts/2TZ35309/locates` (GET)
- `/accounts/2TZ35309/locate` (POST)

Stay on the TradeZero proxy contract — no change there. Just stop calling the locate endpoints.

---

## Build plan — 5 commits, isolated for rollback

### Commit 1 — Remove locate UI components

- Delete Short Locate Marketplace section from `app/tradezero/page.tsx` (or wherever the JSX lives).
- Delete My Locates cart section.
- Delete Borrow Cost Calculator section.
- Delete any locate-related state (`locateSymbol`, `locateShares`, `locates` array, borrow-calc state).
- Delete any locate-specific helper functions in the same file.
- Remove locate-related imports.

**Don't touch:** API routes yet, Quick Order, position table SHORT pills, hotkeys panel — those are later commits.

### Commit 2 — Strip SHORT from position table + Quick Order

- Remove SHORT/LONG pill column from positions table. Keep qty column (negative qty can still display naturally, but no pill styling).
- Quick Order: remove SHORT button entirely. Order action buttons become BUY and SELL only.
- Remove any "action" state variable values referencing SHORT or COVER.
- Order submission payload: drop side → always "buy" or "sell", never "sell_short" / "buy_to_cover". Confirm with TradeZero proxy contract (in TRADEZERO.md or build notes) that this is the correct side value.

### Commit 3 — Delete hotkeys panel

- Remove the hotkey reference card section (F1–F12 static display).
- Remove the `HOTKEYS` constant array.
- Remove any imports/helpers that referenced it.

### Commit 4 — Delete locate API route + backend references

- Delete `app/api/tradezero/locates/route.ts` entirely.
- Remove any `isOrderSubmissionEnabled()` guard for locates (the guard itself stays on the orders route; just the locates-specific check goes).
- Remove locate references from `lib/tradezero-api.ts` if any helper wraps the locate endpoint.
- Grep for `tradezero/locates` in the repo to catch any stragglers.
- Grep for `securityType.*Stock` related locate payloads — shouldn't exist after C1 but verify.

### Commit 5 — Cleanup

- `tsc` clean check.
- Walk `/tradezero` page manually: confirm layout doesn't have orphan empty grid cells / whitespace where locate sections used to be. If the page now feels too empty, that's a design concern to flag — not something to redesign in this phase.
- Search for any comments or dead code referencing "locate," "borrow," "short," "cover," "SSR" (except halt ticker), "hotkey" in `app/tradezero/` — remove.
- Remove any now-unused CSS classes or inline style blocks specific to locate UI.

---

## Files expected to change

**Deleted:**
- `app/api/tradezero/locates/route.ts`

**Modified:**
- `app/tradezero/page.tsx` (or whichever file holds the TradeZero JSX) — bulk of changes
- `lib/tradezero-api.ts` — remove locate helper if exists
- Any test/mock files that reference locates (grep to find)

**Not touched:**
- TradeZero proxy contract (Supabase Edge Function) — unchanged, we just stop hitting locate endpoints
- Kill switch system — stays
- Broker key vault — stays (TZ keys still needed for orders)
- `BrokerNotConfiguredBanner` — stays

---

## Acceptance criteria

1. `/tradezero` page loads with: sponsor header, LIVE badge, halt ticker, account strip, positions table (no SHORT pills), open orders, activity log, AI pattern alerts, Level 2 book, Time & Sales, Quick Order (BUY/SELL only).
2. No Short Locate Marketplace visible anywhere.
3. No My Locates cart visible anywhere.
4. No Borrow Cost Calculator visible anywhere.
5. No Hotkeys panel visible anywhere.
6. Quick Order submits BUY or SELL successfully (smoke test with small paper-equivalent).
7. `grep -rln "locate\|borrow\|hotkey" app/tradezero/ lib/tradezero-api.ts` → zero matches (or only matches in contexts clearly unrelated like a comment about "keep locates out" — none expected).
8. `grep -rln "api/tradezero/locates" app/ components/` → zero matches.
9. Middleware still gates `/tradezero` correctly (no regression on auth).
10. Kill switch still disables BUY/SELL buttons when flipped (unchanged behavior).
11. Page visually doesn't have awkward empty cells where locate sections were — if the grid needs tightening, do it.

---

## Out of scope for 3D

- Redesigning the TradeZero page visually. Just pull things out cleanly. Design refresh is a separate phase.
- Adding new long-only features (e.g. bracket orders, OCO). Keep it simple.
- Renaming the page or the navigation label. "TradeZero (Live)" stays.
- Removing SHORT pills from Alpaca page (if it has any — shouldn't; Alpaca page was simpler).
- Re-enabling real F-key hotkey bindings. Separate phase if Rob wants it later.

---

## Follow-up candidates after 3D (not for this session)

- Real hotkey bindings (F1 buy, F2 sell, F9 cancel-all, F12 flatten) — if Rob wants them back.
- TradeZero page visual refresh now that the sponsor pitch is gone — maybe collapse to a simpler layout.
- Equity curve on both dashboards (deferred from Phase 2).
- Audit log for order submissions (deferred from Phase 2).

---

## Working conventions (carried forward)
- One step at a time, explicit commands
- Each commit isolated for easy rollback (live trading surface!)
- Single-line TS generics only
- Commits stay local; Rob pushes manually via `git push origin main` from claudebot
- Don't hypothesize — give symptom + diagnostic data

---

*Save to Longboard project. New chat + this doc + "let's build Phase 3D" is enough to pick up cleanly.*
