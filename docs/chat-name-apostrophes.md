# Apostrophes in chat names

Approved request `2d5374bf-a030-4adf-af35-fdba376a3820`, revision 2. Published base: `124a42ab262f7b0d25135c7a065c7288c42c0682`.

## Investigation and behavior

Straight apostrophes (`'`, U+0027) already worked. The shared `chatName` validator, `chat_update_member_name` SQL validator, directory endpoints and mention-query parser allowed only the straight punctuation character. NFKC normalization does not convert curly apostrophes into straight ones, so `O’Neill` failed while `O'Neill` passed. The original SQL's rejection of the curly form is reproduced before applying this migration in the database regression.

This was an omission in the name-character allowlists, not a PostgreSQL quoting limitation. The existing policy bounds names and excludes markup, email-like characters, query wildcards and other punctuation. There is no source evidence that curly apostrophes were deliberately prohibited for an operational reason. The ticket does not establish the exact characters previously entered by the reporter; the curly case is the confirmed failure addressed here.

Names now accept the straight apostrophe plus left/right curly forms (`‘`, U+2018; `’`, U+2019). Their glyphs are preserved in saved names, member/DM search input and composed mentions. Existing NFKC/whitespace normalization, 2–28-character bounds, leading letter/number rule, whole-word inappropriate-name filtering and reserved names remain unchanged. The validation help explicitly mentions straight or curly apostrophes.

The existing case-insensitive, literal unique index remains unchanged. `O'Neill`, `O‘Neill` and `O’Neill` are distinct names; different capitalization of the same glyph sequence still collides. Searches and mentions use the stored glyphs literally. Suggestions insert the exact current name, avoiding the need to retype it. There is no automatic apostrophe folding, name merge or historical text rewrite.

## Boundaries and compatibility

The API sends names as structured RPC/query values. Directory SQL uses literal substring matching, the mention lookup retains its existing wildcard exclusion/underscore escaping, SQL mention matching is literal, and UI labels remain React text. Adding two allowed characters does not introduce SQL construction, HTML insertion or authorization from display names.

The migration replaces only `chat_update_member_name(uuid,text)`, adding the two characters to its existing validation class. The function retains `SECURITY INVOKER`, empty search path, service-only execution, account lock, strict membership check, stable member ownership, collision handling, monotonic/no-op revision behavior, and same-ID guest-label update. Existing link RPCs/table constraints already permit these characters; they keep their existing signatures and behavior. No identity, source membership, role, session, notification, read marker, message body or stored author snapshot is rewritten.

The migration is backward compatible and can run before the application: old straight-apostrophe calls still work. An old application bundle can continue rejecting newly supported curly input until refreshed. No schema table/index change, polling, scheduler or publishing infrastructure change is included.

## Verification — October 6, 2026

- Full unit suite: **1,029 tests in 120 files pass**; **96 focused tests** cover names, link/rename routes, both member-directory query paths, DM lookup and mention parsing/lookup.
- Actual SQL name regression: **84 assertions pass**, including the original curly rejection before migration; all three exact glyphs; linking/rename; literal member/DM queries; real mention notification targeting; no-op/revision behavior; collisions and invalid-input rollback; ordinary LB/SS/both identities; preserved historical data/credentials/read state; and service-only strict actor access. This extends the existing name-update database suite using sequential PGlite, not native PostgreSQL multi-session concurrency testing.
- TypeScript and production build pass. Lint reports **zero errors and 10 existing warnings**. All **71 release-service regression tests** pass.
- The production Next application, actual routes and current synthetic SQL/Auth/source fixture pass in Chromium **152.0.7977.82**: initial member linking/reload; straight/left/right rename and persistence; exact directory API queries; real Member List and Start New DM search/navigation; mention completion, send and recipient notification; stable actor/peer IDs and historical snapshots; retained draft; duplicate, reserved and unsafe input rejection; escaped text; 320 px touch viewport; mounted Quad identity; SS-only save/reload and downgrade rejection. **Zero browser runtime errors**. Desktop mention, mobile profile and Quad screenshots were inspected.

Logs: `/tmp/chat-name-apostrophes-{focused,unit,database,tsc,lint,build,release,browser}.log`. Screenshots: `/tmp/chat-name-apostrophes-{mention,mobile,quad}.png`. These are synthetic localhost checks on **3376/54576**, not authenticated production-user or physical-phone verification.

For reproduction, run `scripts/tests/chat-name-apostrophes-database.mjs`. Start `chat-name-apostrophes-fixture.mjs` with the existing `tsx` import, build/start the app with the fixture's synthetic Supabase settings and `chat-name-apostrophes-preload.mjs`, then run `chat-name-apostrophes-browser.mjs`. The browser script rejects non-local origins; the preload redirects only the fixed membership-export destination to the local synthetic source.

## Release

Installed Supabase CLI 2.76.8 generated `20261006145455_chat_name_apostrophes.sql`. Its SHA-256 is `3da5bb1909bd3f280c5d667070b8812120b25028025fa9bc54a1a732d4511b17`, recorded in `.release/2d5374bf-a030-4adf-af35-fdba376a3820.json`. The login-page probe is only a live HTTP smoke check. Exact-head review, hosted checks and publication remain the coordinator's process through the dedicated release service; this worker performs local implementation, validation and commit only.
