# Shared chat membership login — implementation status

## Confirmed policy

One app; LB for Longboard members, SS for approved paid ShortScout members, SOCIAL for either. Free ShortScout accounts do not grant access. Rob confirmed on September 16 that current paid ShortScout members are mastermind members with perpetual access. No subscription-expiration job is needed for the initial group. Monthly, annual and lifetime remain in the previously approved paid-level allowlist for future compatibility.

## Verified source and prepared code

ShortScout repository: robbooker/shortscout, Lovable project 83abe010-6650-45ff-af5b-308a849d3979, Supabase project xejuximbbpnzqylukrsn. Existing code uses profiles.user_id and profiles.user_level. Auth sign-in uses Supabase. Source includes a guest-token based shortscout-chat endpoint; that path must be retired/gated during rollout, not just hidden in the UI.

lib/shortscoutMembership.ts is a tested, unconnected server-side verifier foundation. It verifies an access token through ShortScout Auth before reading only that subject's membership. It rejects unconfirmed/invalid sessions, free/missing/unknown levels and backend errors. It returns only subject and level; it never trusts user metadata or a caller-supplied email. It does not yet grant rooms, create sessions, or link accounts. Eight unit checks pass. Requires server-only ShortScout environment configuration; no credentials requested in chat or configured yet. A narrow ShortScout-hosted verification endpoint may replace the privileged client once Lovable confirms supported access.

## Required before enabling

Current connected Supabase tool has no access to the ShortScout project. Lovable's access questionnaire has been submitted with Full stack, Standalone tools, Use existing auth, and Scoped backend key. The preferred connection is a minimal ShortScout-hosted membership verification endpoint, without sharing broad database/admin credentials. Need Lovable's handoff, live schema/policy confirmation, and deployment access (or a Lovable-deployed minimal verification endpoint).

The checked-in migrations allow users to update their own profile and later add user_level without an obvious column guard. This is a code-level concern, NOT a confirmed production vulnerability: live policies/triggers may differ. Verify ordinary users cannot assign themselves a paid level before treating that field as authoritative. No attempt was made to modify any production membership.

Lovable's questionnaire response recommends a dedicated `chat-auth-bridge` Edge Function and says its managed backend does not expose the service-role key, database password, or direct database connection. This is a proposed plan, not a deployed endpoint. Before approving implementation, narrow its generic read/write suggestion to membership verification only: validate the actual user's session, derive the subject from Auth, read that subject's protected paid level, return minimal verified identity/membership, and provide no profile/conversation writes or directory enumeration. A custom backend key alone does not prove a member's identity. The membership-field protection concern above still needs live verification. No Lovable implementation approval has been submitted.

## Login/linking design

- Authenticate with the chosen membership provider on that provider's site.
- Use an expiring, single-use authorization-code handoff bound to a browser challenge/PKCE and strict callback allowlist. Never put provider access tokens in URL query strings.
- Store a unique (provider, verified subject) identity linked to the canonical chat account. Never merge solely by matching email. Linking another provider requires proof of both sessions and explicit link intent.
- SS-only users must be able to enter SS/SOCIAL without purchasing LB; creating a central chat identity must not implicitly grant Longboard product access.
- Room access becomes an explicit entitlement policy, applied to server page/API checks, database RLS, search/context, reactions, attachments, and realtime. Update existing 'has a profile' policies before issuing SS-only sessions. Preserve current LB users/identities and history.
- Switching permitted rooms then uses the central chat session. Keep current SS admin restriction until the complete flow and denial tests pass.
- Verify invalid tokens, replayed/expired codes, forged callback/state, free SS users, SS-only users denied LB, dual membership, and account-link collision handling.

No production authentication or membership policy changed by this foundation.

## Lovable bridge review — September 16

### Follow-up correction

Reviewed ShortScout `origin/main` commit `b3e80f8` after Rob requested the correction through Lovable. The bridge now validates the user token, rejects the shared key as a user, reads only that subject's membership, denies non-paid/missing levels, and returns `{allowed:true,userId,membershipLevel}`. Lookup errors fail closed. Independent live POST checks returned 401 `missing_authorization` and 401 `invalid_session`, respectively. Lovable reports a successful paid mastermind session and rolled-back database tests of self-upgrade denial, normal profile editing, and admin updates; these authenticated tests have not been independently repeated. Lovable explicitly did not test an actual free user's session against the endpoint.

Migration `20260916140919_e15f4506-2c23-4251-a7f9-3d94a71d3b73.sql` adds INSERT/UPDATE guards: ordinary inserts force free, ordinary membership updates raise, admin or null-auth contexts bypass. Review anonymous grants/RLS alongside the null-auth bypass before final rollout. The endpoint accepts `confirmed_at` as an alternative to `email_confirmed_at`; this is broader than the requested confirmed-email rule and should be tightened before release. Longboard's existing verifier still needs conversion to this scoped HTTP endpoint, followed by the login handoff and room-entitlement implementation. No ShortScout secret key needs to be copied into Longboard for this endpoint's user-token flow.

### Initial version (superseded)

Rob approved Lovable's implementation. Lovable reports deploying `chat-auth-bridge`; source was inspected at ShortScout commit `96f149a` via `origin/main`. The endpoint validates user JWTs but does **not** select or enforce `profiles.user_level`, check confirmed email, or fail on profile/role query errors. It therefore is not yet a paid-membership verifier. Its separate shared-key branch returns `{ok:true,mode:"service"}` without a member identity; this must never authorize a chat user. No membership-field hardening migration was included. Keep this endpoint disconnected from chat entitlements until these gaps and the live membership-field protection check are resolved. No secret values are needed in the conversation.

## Implementation in progress — scoped endpoint and isolated identity

The Longboard verifier now calls the fixed ShortScout bridge over HTTPS with the member token, refuses redirects, times out, and validates the exact successful paid-member response. It no longer requires a ShortScout service-role key. The bridge tests and room-permission/browser-proof tests pass (32 checks total).

Live inspection confirmed Longboard's auth-user creation trigger automatically creates a product profile. SS-only users therefore must not be provisioned as ordinary Longboard auth users. The prepared, unapplied `shared_chat_login` migration instead introduces server-only chat accounts, provider identities, hashed login challenges/codes, and hashed opaque chat sessions. LB account IDs will be retained; SS-only accounts remain outside Longboard Auth and product profiles. Existing browser Supabase permissions cannot authenticate these independent sessions: authorized history/reaction/search/inbox access and live updates must be provided through chat-specific server paths, with room checks before every query. Do not ship just the login callback or remove the SS admin gate before those paths are complete.

Remaining work: atomic one-use handoff/account linking, provider-local authorization page, chat session handlers, chat-specific data access and delivery, existing member FK/RPC adaptations, end-to-end denial and linking tests, and deployment verification. Local schema is not yet applied. The original provider-field/confirmed-email review items remain rollout gates.

### Handoff implementation checkpoint

Added start/authorize/callback handlers, HTTP-only browser proof and chat cookies, fixed ShortScout-origin authorization, and an atomic database code-consumption function. A local PostgreSQL test runs 23 checks covering browser-role denial, wrong proof, expiry, replay, identity collision, stable repeat login, LB linking, and absence of SS-created product profiles. Six HTTP tests cover state cookies, code hashing, link-session changes, code rejection, origin restrictions, and free-member denial. TypeScript and focused lint pass. These handlers remain unpublished and room handlers still use the old auth gates.

ShortScout branch `agent/shared-chat-login` now contains a `/chat-connect` page that reuses its existing login, explicitly confirms the connection, posts the user token only to the fixed Longboard authorization endpoint, and returns a one-use code. The bridge's email check is tightened locally to `email_confirmed_at`. The repo's existing package/lock mismatch prevented `npm ci`; lockfile repair and the ShortScout build are in progress. No new production changes have been made by this implementation.

### Room integration checkpoint

Chat routes now use `requireChatUser` rather than product auth. History queries scope room before reading; reactions retain their target-room check; inbox history explicitly checks requester/recipient against the verified chat member. Search scopes SS-only all-room requests to SOCIAL and context verifies source-room access before retrieval. The UI has a membership chooser, a Connect ShortScout menu item, permitted-room navigation, and chat-session sign-out. SS sessions use authenticated history refreshes every two seconds; existing LB realtime stays in place. The new migration adapts member/search-budget foreign keys to chat accounts, preserves member IDs, permits SS identities in member/DM RPCs, and applies the database write guard to every room.

Full local unit suite: 228 passed; existing chat DB suite: 96 passed; new login DB suite: 32 passed including SS posting in SS/SOCIAL, denied LB posting/reactions, and DM requests. TypeScript and touched-file lint pass. These are local checks; browser end-to-end verification, production migration/release, ShortScout legacy guest-path retirement, and final auth review remain. No production migration has been applied.

### Browser verification checkpoint

Isolated browser test against local PostgreSQL fixtures: SS-only page showed SS/SOCIAL with LB locked; sent a message and saw it persisted in SS; switched to SOCIAL; Search offered only SOCIAL; sign-out returned to the membership chooser. Direct API access to LB history using that SS session returned 403. No production messages were posted. Local fixture does not implement Supabase realtime presence, so its 'Connecting' presence indicator is not a production verification. The final Longboard build passed with unrelated existing warnings.

ShortScout now prepares `/chat` redirection to the shared app, preserves legacy transcripts while revoking guest reads, and returns 410 from the retired guest-write endpoint. These changes must deploy only after the shared app is ready. ShortScout build/TypeScript/focused lint pass after repairing the existing stale lockfile. Rollout remains pending; do not claim completion from these local results.
