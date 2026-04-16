# Longboard — Phase 3D.5 Handoff: TradeZero Page Polish

**Date:** April 14, 2026
**Prerequisite:** Phase 3D shipped + TradeZero order bug fixes (commits `119145c` + `ecb00a8`) shipped and verified.
**Working dir:** `/Users/claudebot/longboard`
**Branch:** `main`
**Live URL:** https://longboardai.com

---

## Goal

Four focused cleanups on `/tradezero`, each isolated for rollback. All additive except the last (ripping diagnostic logging).

1. Restore Open Orders table (regression from Phase 3D)
2. Make Level 2 + Time & Sales symbol selectable (currently hardcoded to MARA)
3. Wire Polygon quote feed for positions Last / P&L / P&L % columns
4. Remove the diagnostic `[tzProxyFetch]` logging added during the TZ bug chase

---

## Decisions locked

- **Open Orders table**: restore under Positions. Same table pattern. Poll alongside positions (every 5s).
- **L2/T&S symbol selection**: two ways to change focus — (a) click a row in the Positions table, (b) dedicated symbol input at the top of the L2/T&S section. **Not** tied to Quick Order symbol. Shared `focusedSymbol` state.
- **Quote feed**: Polygon. Batch one fetch per held symbol per poll cycle. Compute P&L client-side: `pl = (last - priceAvg) * shares`, `plpc = (last - priceAvg) / priceAvg`.
- **Route column**: drop. TZ-internal, not in any public quote feed.
- **Diagnostic logging**: rip both `[tzProxyFetch] →` (commit 60e970b) and `[tzProxyFetch] ← 2xx` (commit 96679f7). The `← non-2xx` error log stays — useful for debugging future drift.

---

## Current state

- Positions table renders with real data but Last / P&L / P&L % / Route columns show `—` (commit `ecb00a8` shipped them as placeholders).
- No Open Orders table exists on `/tradezero` (lost in Phase 3D rewrite).
- `LEVEL 2 · MARA` and `TIME & SALES · MARA` are hardcoded. The symbol comes from a static constant somewhere in `app/tradezero/page.tsx`.
- `lib/tradezero-api.ts` has two diagnostic logs active: every request logs `[tzProxyFetch] →` and every 2xx response logs `[tzProxyFetch] ← 2xx`.

---

## Build plan — 4 commits, isolated for rollback

### Commit 1 — Restore Open Orders table

**New API route (if missing):** verify `app/api/tradezero/orders/route.ts` has a GET handler. Looking at Phase 2A notes it should exist — `requireUser` → `getTradeZeroCredsForUser` → `tzProxyFetch('/accounts/${accountId}/orders')`. If it's gone, restore it.

**Response shape** (unknown — will likely need to be captured same way positions was):
- Fire a GET to `/api/tradezero/orders` from the browser while logged in.
- If empty array, that's fine — render an empty table.
- If it returns data, inspect the `[tzProxyFetch] ← 2xx` log for the shape, then build the parser.
- If it's `{orders: [...]}` wrapped like positions was, unwrap server-side same way `app/api/tradezero/positions/route.ts` does.

**New UI section on `/tradezero`:**
- Render directly below the Positions card.
- Table columns: Symbol, Side, Qty, Price, Type, TIF, Status, Submitted (timestamp), Cancel button.
- Status pill styles: `New` / `PartiallyFilled` / `Filled` / `Cancelled` / `Rejected` — colors from existing CSS vars (`--accent` for filled, `--warning` for partial, `--danger` for rejected, `--text-secondary` for cancelled).
- Cancel button: POST to `/api/tradezero/orders/:orderId/cancel` (or however TZ wants it — check TRADEZERO.md spec; may need a different path). If that endpoint doesn't exist in the current codebase, flag it and skip the cancel button for v1.
- Poll alongside positions — same 5s interval, same `fetchCore` pattern used for positions.

**Update `lib/tradezero.ts`:** add a `TZOrder` interface matching the actual response shape. Will need updating once the shape is confirmed.

**Acceptance:** load `/tradezero` with an active order → Open Orders table shows it. Fill/cancel the order on TZ's side → within 5s the table reflects the state change.

### Commit 2 — L2/T&S selectable symbol

**State:** add `focusedSymbol: string` state to `app/tradezero/page.tsx`, default `"MARA"` (or whatever the current hardcoded default is — preserve it).

**Two selection paths:**

1. **Click-to-focus on Positions table rows:**
   - Wrap each position row in a click handler that sets `focusedSymbol = position.symbol`.
   - Active position row gets a visual indicator — left border in `var(--accent)` plus subtle background tint `var(--accent-10)`. Hover state existing (or add one).
   - Cursor: pointer on position rows.

2. **Dedicated symbol input above L2/T&S:**
   - Small input field at the top-left of the L2 card header (or a shared header spanning L2 + T&S).
   - Submit on Enter or blur → updates `focusedSymbol`, which triggers L2 + T&S to re-fetch.
   - Uppercase the input value automatically.
   - Placeholder: "Focus symbol" or similar.
   - Style: match existing input fields in the app (themed via CSS vars).

**Propagation:**
- L2 and T&S fetch calls currently hardcode the symbol. Replace with `focusedSymbol` throughout.
- Card headers: `LEVEL 2 · ${focusedSymbol}` and `TIME & SALES · ${focusedSymbol}`.

**Acceptance:** type AAPL in the input → L2 + T&S switch to AAPL data. Click ARAI in positions → L2 + T&S switch to ARAI. Quick Order symbol unchanged (it has its own independent input).

### Commit 3 — Polygon quote feed for positions Last / P&L / P&L %

**Approach:** on each positions poll, collect all held symbols, batch-fetch quotes from Polygon, merge into render.

**Polygon endpoint check:** Polygon has a `/v3/snapshot/stocks?tickers=AAPL,MSFT,ARAI` endpoint that returns multiple tickers in one call. Use that if it exists in the current `app/api/polygon/` route structure. If not, fall back to per-symbol fetches in parallel with `Promise.all()`. Don't serial-fetch.

**New API route (if missing):** `app/api/polygon/quotes/route.ts` — GET with `?symbols=ARAI,OPRA` query param. `requireUser`-gated. Returns `{quotes: {ARAI: {last: 1.29}, OPRA: {last: 14.80}}}`.

**UI integration in `app/tradezero/page.tsx`:**
- Add `quotes: Record<string, {last: number}>` state.
- After each positions fetch, extract held symbols, fire quote batch.
- On positions render, compute per row:
  ```ts
  const last = quotes[p.symbol]?.last;
  const pl = last != null ? (last - p.priceAvg) * p.shares : null;
  const plpc = last != null ? ((last - p.priceAvg) / p.priceAvg) * 100 : null;
  ```
- If `last` is null (quote missing/loading), show `—`. Otherwise render formatted currency/percent with existing `signColor` helper.
- Drop the Route column entirely — not available from any source.

**Acceptance:** open positions on `/tradezero` show live Last prices that tick. P&L and % update in real time. Colors: green positive, red negative (via `signColor`).

### Commit 4 — Rip diagnostic logging

**Files:** `lib/tradezero-api.ts`.

**Remove:**
- `[tzProxyFetch] →` log before the fetch call (from commit `60e970b`).
- `[tzProxyFetch] ← 2xx` log on successful responses (from commit `96679f7`).

**Keep:**
- `[tzProxyFetch] ← <status>` log on non-2xx responses — invaluable when the next spec change happens.
- The `JSON.parse(rawBody)` pattern (don't revert back to `res.json()` — the try/catch shape is better).

**Acceptance:** normal GET poll on `/tradezero` produces no Vercel log lines from `tzProxyFetch`. A deliberately broken call (e.g. trigger a known 4xx) still logs the error. `tsc` clean.

---

## Files expected to change

**New (Commit 1):**
- `lib/tradezero.ts` — add `TZOrder` interface
- `components/OpenOrdersTable.tsx` or inline in `app/tradezero/page.tsx` — your call

**New (Commit 3):**
- `app/api/polygon/quotes/route.ts` (if not already present)

**Modified:**
- `app/tradezero/page.tsx` — all four commits touch this file
- `app/api/tradezero/orders/route.ts` — verify GET handler, unwrap envelope if needed (Commit 1)
- `lib/tradezero-api.ts` — rip diagnostic logs (Commit 4)

---

## Acceptance criteria

**Commit 1:**
- [ ] Open Orders table renders below Positions
- [ ] Active orders appear within 5s of submission
- [ ] Status changes reflect within 5s
- [ ] Cancel button works, or is flagged as deferred

**Commit 2:**
- [ ] Click-to-focus on positions rows changes L2 + T&S
- [ ] Symbol input field changes L2 + T&S
- [ ] Quick Order symbol independent
- [ ] Active position has visible indicator

**Commit 3:**
- [ ] Positions show live Last prices, updating on poll
- [ ] P&L and P&L % computed + color-coded
- [ ] Route column removed
- [ ] Missing quotes render `—` not `NaN` or `undefined`

**Commit 4:**
- [ ] Request + 2xx response logs gone
- [ ] Error responses still log
- [ ] No regressions on `/tradezero`
- [ ] `tsc` clean

---

## Out of scope for 3D.5

- Historical orders / Order History view — just the live Open Orders for now.
- T&S filtering by trade size, dark pool markers, etc.
- L2 depth configuration (# of levels shown).
- Polygon WebSocket streaming (polling is fine).
- Polygon snapshot optimization beyond the basic batch call.

---

## Working conventions (carried forward)
- One step at a time, explicit commands
- Each commit isolated for easy rollback (live trading surface)
- Single-line TS generics only
- Commits stay local; Rob pushes manually via `git push origin main` from claudebot
- Don't hypothesize — give symptom + diagnostic data

---

*Save to Longboard project. New chat + this doc + "let's build Phase 3D.5" is enough to pick up cleanly.*
