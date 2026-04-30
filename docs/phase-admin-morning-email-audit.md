# Phase admin morning-email audit

**Date:** 2026-04-29
**Scope:** pre-Commit-1 audit per `docs/LONGBOARD_ADMIN_MORNING_EMAIL_HANDOFF.md`. No code yet.
**Author:** Claude Code

This is Commit 0 — environment + integration audit only. Implementation begins on Commit 1 once Rob signs off.

---

## 1. Environment variables

Checked `/Users/claudebot/longboard/.env.local` for the eight expected names listed in the handoff. Variable **names** only — values were not read or printed.

| Variable                  | Present |
|---------------------------|---------|
| `POLYGON_API_KEY`         | yes     |
| `OPENAI_API_KEY`          | yes     |
| `OPENAI_MODEL`            | yes     |
| `OPENAI_REASONING_EFFORT` | yes     |
| `EXA_API_KEY`             | yes     |
| `X_BEARER_TOKEN`          | yes     |
| `BENZINGA_API_KEY`        | yes     |
| `SEC_USER_AGENT`          | yes     |

**Result:** all 8 names are present. Nothing missing.

Reminder for Commit 1+: each integration must still degrade gracefully if a key is empty/invalid at runtime (per the handoff: "Exa key missing, skipped web search."). Presence in `.env.local` is necessary but not sufficient — Vercel's production env must be checked separately before any prod use, but that is out of scope here.

## 2. Admin auth guard

Confirmed: `lib/auth.ts:38` exports `requireAdmin`:

```ts
export async function requireAdmin(req: NextRequest): Promise<AuthResult>
```

Where `AuthResult = { ok: true; user: AuthedUser } | { ok: false; status: 401 | 403; error: string }`.

**Import path the new admin route will use:**

```ts
import { requireAdmin } from "@/lib/auth";
```

This matches the existing pattern across `app/api/admin/**/route.ts` (audit, boardroom, signup-requests, users, invites). Standard usage in route handlers:

```ts
const auth = await requireAdmin(req);
if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
```

For the page-level guard (`app/admin/morning-email/page.tsx`), the precedent in `app/admin/audit/page.tsx` is to call `requireAdmin` server-side and redirect/render-not-found on failure. Commit 1 will copy that pattern verbatim.

> **Drift from handoff:** the handoff (line 489) suggests `longboard/lib/auth-guard.ts`. That file does **not** exist. The real export lives at `lib/auth.ts` and the convention is `@/lib/auth`. No action needed — just calling out that the handoff path is wrong.

## 3. Proposed admin route path

**`/admin/morning-email`** — matches the handoff default and the existing nested-route convention.

Existing siblings under `app/admin/`:

```
app/admin/audit/         (page.tsx + AuditClient.tsx)
app/admin/boardroom/
app/admin/essays/
app/admin/page.tsx       (top-level admin landing)
```

API siblings under `app/api/admin/`:

```
app/api/admin/audit/
app/api/admin/boardroom/
app/api/admin/invites/
app/api/admin/signup-requests/
app/api/admin/users/
```

So `/admin/morning-email` for the page and `/api/admin/morning-email/*` for the API routes are both consistent with established convention. No reason to deviate.

A link from `app/admin/page.tsx` → `/admin/morning-email` will be added in Commit 1 (matching the existing "Audit Log →" / "Essays →" buttons in `AdminClient.tsx`).

## 4. Files this work will create / modify

### New files (per the handoff's "Suggested Files" section)

| Path                                                    | Purpose |
|---------------------------------------------------------|---------|
| `app/admin/morning-email/page.tsx`                      | Server page; calls `requireAdmin`, renders client. |
| `app/admin/morning-email/MorningEmailClient.tsx`        | Client UI — scan / research / edit / preview / copy / download. |
| `app/api/admin/morning-email/scan/route.ts`             | `POST` — Polygon gainers → 5 common-stock movers + QA. |
| `app/api/admin/morning-email/research/route.ts`         | `POST` — per-ticker enrichment (Polygon news, Benzinga, SEC, Exa, X) + OpenAI synth. |
| `app/api/admin/morning-email/generate/route.ts`         | `POST` — local QA + render Longboard HTML email. |
| `lib/morning-email/types.ts`                            | `MorningEmailStock`, `MorningEmailDraft`, `ResearchSource` shapes. |
| `lib/morning-email/polygon.ts`                          | Movers scan + snapshot/reference/news fetchers. |
| `lib/morning-email/research.ts`                         | Benzinga + SEC EDGAR + Exa + X clients, dedupe, stale-filter. |
| `lib/morning-email/openai.ts`                           | Evidence-only synthesis (catalyst/sentiment/confidence/risk). |
| `lib/morning-email/render-email.ts`                     | Port of `build_longboard_email_html(...)` — 600px, header `MORNING BRIEF · LONGBOARD AI`. |
| `lib/morning-email/qa.ts`                               | Local QA rules (count=5, positive movers, no negative direction words, etc.). |

### Modified files

| Path                              | Change |
|-----------------------------------|--------|
| `app/admin/page.tsx` / `AdminClient.tsx` | Add a "Morning Email →" link button alongside existing admin sub-page links. |

### Files explicitly NOT created in this version

Per the user's working conventions for this phase (preview / copy / download only):

- No `app/api/admin/morning-email/drafts/route.ts` (the handoff lists this as one of the suggested files; deferred — see open question below).
- No `supabase/migrations/*morning_email_drafts*.sql` table.
- No send / upload / Slack / Resend / Kit code.

## 5. Open question for Rob

**Persistence in this version: client-state only, or also a Supabase `morning_email_drafts` table?**

The handoff lists "Optional: Save Draft / Load Latest Draft" controls and a suggested `morning_email_drafts` table (handoff §Persistence, §Suggested Files). It also lists `app/api/admin/morning-email/drafts/route.ts` under suggested files.

The user's instructions for this phase say "preview/copy/download HTML only — NO send, NO upload, …". That clearly excludes external sends but is silent on internal Supabase draft persistence.

Two reasonable interpretations:

- **(a) Strict preview-only** — keep all draft state in the client React tree until the user copies/downloads HTML. No DB writes. Simplest, smallest blast radius, easiest to ship and reverse. Loses state on tab refresh, but for a single morning workflow that's acceptable.
- **(b) Preview + Supabase draft persistence** — add `morning_email_drafts` migration + `drafts` route + Save/Load buttons. Survives refresh, gives Rob/Liz a paper trail of the morning's work. Adds a migration, an RLS policy decision, and one more API route.

Recommendation: **(a)** for Commit 1 — it satisfies the spec's hard "preview/copy/download HTML only" line and avoids a Supabase migration in the same phase as the integration build. Add (b) as a follow-up phase if it proves useful in real morning use. Either is fine; just need Rob's call before Commit 1.

---

Pending Rob's answer on §5, ready to proceed to Commit 1 (route skeleton + `requireAdmin` gate + types).
