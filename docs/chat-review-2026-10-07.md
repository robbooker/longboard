# Longboard Chat Performance & UX Review — 2026-10-07

## Summary
On 2026-10-07 Rob and Claude Code reviewed and overhauled longboardai.com/chat (repo robbooker/longboard; Next.js on Vercel; Supabase project `longboard`, ref qnwizieggisnbjqyxrjo, us-west-2). Findings dashboard: https://claude.ai/artifact/96sveYa1V9qB1Cjff8PNUX (progress log at the top). Eight PRs shipped the same day (#378–#384). The biggest win was measured, not guessed: the notification bell query (`chat_activity_inbox`) was saturating the database CPU. Two fixes cut its database load about 82%, from about 497 to about 91 seconds of DB time per minute.

## What shipped (all merged and live on 2026-10-07)
- #378 Quick wins: Prettier formatting for chat files, no re-render per scroll frame, parallel history reads, composer stays editable while sending, auto-growing text box, quieter status line, `role="log"`, theme cookie (no dark flash).
- #379 Rooms open at the server-computed landing spot (no jump); floating "N new messages ↓" button; instant header ↓.
- #380 Realtime messages merge directly instead of reloading the room (badges reused from loaded messages).
- #381 Ably per-room channels (`private:chat:room:<slug>`) for every write path; server-signed subscribe-only tokens for both Longboard and ShortScout sign-ins; replaces 2-second polling; Server-Timing headers on `/api/chat/updates`. Gated by `CHAT_ABLY_ROLLOUT` (off|admins|all), uses the chat-only key `CHAT_ABLY_API_KEY`. Production rollout: admins at 2:50 pm CT, all at 3:10 pm CT.
- #382 Chat functions pinned to `pdx1` (Oregon), next to the database, through vercel.json `functions.regions`. Next.js `preferredRegion` was tried first and ignored by the build. Before this, chat ran in iad1 (Washington, D.C.).
- #383 Bell refreshes from room events at most every 5 s per window; safety-net refreshes 30–60 s while a live connection is up (DMs stay at 10 s).
- #384 Bell query and reaction helper resolve room access once per call instead of once per row. A database migration, applied manually to production at 4:35 pm CT (21:35 UTC).

## Key measurements
- Update batches (`/api/chat/updates`): about 550–630 per minute before the work.
- Upload scans: about 6–7 s of fixed overhead per file regardless of size; 92% of attachments are PNG or JPEG; no file rejected in 30 days.
- pg_stat_statements, Sep 28 to Oct 7: `chat_activity_inbox` 2.64M calls × 419 ms ≈ 307 h of DB time; `read_chat_message_reactions` 3.3M calls; `longboard_chat_room_member_count` 1.09 s average.
- Root cause of the bell's cost: `chat_account_has_room` ran per scanned row (non-inlinable, repeated ShortScout and profile lookups). Under load, calls went from 40–70 ms to 2–7 s, with up to 40 active queries waiting on CPU.
- After #383 and #384: bell average 1,348 → 272 ms; DB time about 497 → 91 s per minute; active queries 1–2; update requests 99.9% HTTP 200.

## Decisions Rob made
- Speed matters more than anything. Work order follows measured impact.
- Ably (not Supabase Broadcast or slower polling) for realtime.
- ShortScout membership: mirror it into Longboard's database with a nightly cron (billing is manual, so next-day access is fine). No live fallback; optional admin "sync now"; no changes on the Lovable side.
- Change existing code in place with feature flags, not a copy of the app.
- Phone notification previews stay opt-in per device for now (privacy decision pending, finding N1).

## Operational notes (important)
- Never run `supabase db push` on the Longboard project: production's migration history uses different version stamps than the repo, so push would re-run old migrations. Apply one migration file at a time with `supabase db query --linked --project-ref qnwizieggisnbjqyxrjo -f <file>`, and keep a rollback file in `supabase/rollbacks/`.
- Ably off-switch: set `CHAT_ABLY_ROLLOUT=off` in Vercel Production and redeploy (about 2 minutes).
- Bell rollback: `supabase/rollbacks/20261007210000_chat_activity_room_access_once.down.sql`.
- Preview deployments share the production database, so test posts are real messages.
- Testing pattern: Rob tests previews with Claude in the browser using side-by-side windows (hidden tabs ignore realtime by design). Rob merges with "Create a merge commit".
- The ShortScout Supabase project is managed by Lovable under a different Supabase account.

## Open items (next, by measured impact)
1. Re-measure bell calls per minute after most windows reload (about 335 per minute at 4:40 pm CT).
2. P18 reactions read (about 44 s of DB time per minute).
3. P3 + A6 login checks and the ShortScout mirror (about 21 s per minute).
4. P17 room member count (about 1 s per call).
5. M3 rebuild PNG/JPEG on the server instead of scanning (saves 6–7 s per upload); M2 send while scanning.
6. N1 notification previews; P12/P13 attachment caching; A1 scroll controller rebuild; A7 AbortError cleanup.
7. Remove the leftover preview-scoped Ably variables on the deleted branch `chat-review-step3b-ably-realtime`.
