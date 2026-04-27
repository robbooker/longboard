# Project context

> Update this as the product and team evolve. Stale context wastes everyone’s time.

## Product (current understanding)

- **Name:** Longboard (longboard.ai) — AI-assisted stock research terminal.
- **Flow (high level):** User submits a ticker → work is queued → **Buddy** (agent on OpenClaw) runs research (Polygon, Brave, SEC) → results stream back via **Supabase** realtime.
- **Also in repo:** Essays, business updates, strategies scripts, and more (see the root [`README.md`](../../README.md) and `docs/`).

## Technical stack (from repo)

| Layer | Choice |
|--------|--------|
| App | Next.js (App Router), TypeScript, Tailwind |
| Data / realtime | Supabase (Postgres + Realtime) |
| Deploy | Vercel (typical) |
| Other | MDX content, various scripts in `scripts/` |

## People

| Role | Name | Notes |
|------|------|--------|
| Upstream owner | Rob Booker | `robbooker/longboard` |
| (add rows) | | |

## Repos

- **Canonical upstream:** [robbooker/longboard](https://github.com/robbooker/longboard)
- **Example contributor fork:** [gdwoods/longboard](https://github.com/gdwoods/longboard) — push here, open pull requests upstream.

## Environments and secrets (no values in this tree)

- Local: `.env.local` from `.env.local.example` (not committed).
- Shared dev vs personal Supabase / Vercel: agree as a team and record a one-line note here once decided.

## Related links

- [Issues (upstream)](https://github.com/robbooker/longboard/issues)
- [Pull requests (upstream)](https://github.com/robbooker/longboard/pulls)

## See also

- [Start here (collab index)](./README.md)
- [Repository and Git workflow](./repository-and-git-workflow.md)
