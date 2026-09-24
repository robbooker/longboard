# Custom Rob reaction

Ticket `327d0a36-ec8a-48a5-ad5d-8095e34f1af9` adds the fixed `rob` reaction to the shared room, DM and reply UI used by full, quad and popout chat views. It uses the supplied face unchanged at `public/chat/reactions/rob.png`. Next Image requests a 28px optimized variant; CSS contains it at 22px in count chips and 28px in the picker/details. The picker uses two columns to fit four choices on small screens. Existing theme colors, pressed state, counts, toggle behavior, names, keyboard details and focus restoration apply unchanged. Image alt is decorative because the surrounding button and details heading identify Rob.

The shared catalog drives both UI choices and API validation. Unknown future keys are hidden rather than displayed as a misleading Like. There is no upload manager, custom URL, new polling or storage service. Existing Gainers posting/reply/upload restrictions and reaction target access checks remain unchanged.

## Database and release

Migration `20260924130909_chat_rob_reaction.sql` only expands the reaction table CHECK and setter allowlist. The setter retains the exact existing invoker privileges, search path, target authorization, locks, upserts and returned summaries. CREATE OR REPLACE preserves its service-role-only ACL. No existing reaction rows or legacy like paths change. Database migration must precede app deployment through the dedicated release service. New code filters unknown keys; already-open pre-release clients can misrender Rob as their old default Like until refreshed. Refresh old tabs after release. The migration remains compatible with older writers.

## Verification

- 28 route tests: fixed Rob key in rooms/DMs, scoped and paginated details, actor derived from auth, malformed payload rejection and existing origin/access checks.
- 34 isolated PGlite assertions: pre-migration reactions preserved, Rob count/names/idempotency/removal, legacy likes, paused/blocked/deleted target denial, DM participation, revoked membership and browser-role table/RPC denial.
- Current Gainers SQL suite: LB/SS/admin reads, expiry/outsider denial and unchanged broadcast writer/reply/upload restrictions. This is separate from the older reaction SQL fixture; the latter is not evidence of current SS entitlement behavior.
- `node scripts/tests/chat-rob-reaction-browser.mjs`: real shared components, CSS and Next Image with synthetic HTTP; 18 add/count/remove/details/focus rounds on room, compact DM and reply targets at 320/390/1100px in light/dark. Actual image loading, unknown-key filtering, existing Like preservation and no horizontal overflow pass. The fixture serves the original PNG for image requests and does not measure Next's optimization endpoint. Full quad/popout shells are not separately exercised; they consume the same shared component.
- Screenshot `/tmp/rob-reaction-320-dark.png` visually inspected; other viewport/theme screenshots use `/tmp/rob-reaction-{width}-{theme}.png`.
- TypeScript and targeted ESLint passed. Parent independently reported 789 unit tests, production build and 71 mocked release-service tests passed.

All verification uses local/synthetic data. No production SQL, release claim, deployment, merge or publication was performed by the implementation worker.

Parent production-build check: the real local Next image optimizer returned HTTP 200 and a valid 32×32 WebP of 958 bytes for the supplied PNG. The source asset checksum matches the original exactly. Local production server was stopped after verification.
