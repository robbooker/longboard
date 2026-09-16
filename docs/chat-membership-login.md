# Shared chat membership login — implementation status

## Confirmed policy

One app; LB for Longboard members, SS for approved paid ShortScout members, SOCIAL for either. Free ShortScout accounts do not grant access. Rob confirmed on September 16 that current paid ShortScout members are mastermind members with perpetual access. No subscription-expiration job is needed for the initial group. Monthly, annual and lifetime remain in the previously approved paid-level allowlist for future compatibility.

## Verified source and prepared code

ShortScout repository: robbooker/shortscout, Lovable project 83abe010-6650-45ff-af5b-308a849d3979, Supabase project xejuximbbpnzqylukrsn. Existing code uses profiles.user_id and profiles.user_level. Auth sign-in uses Supabase. Source includes a guest-token based shortscout-chat endpoint; that path must be retired/gated during rollout, not just hidden in the UI.

lib/shortscoutMembership.ts is a tested, unconnected server-side verifier foundation. It verifies an access token through ShortScout Auth before reading only that subject's membership. It rejects unconfirmed/invalid sessions, free/missing/unknown levels and backend errors. It returns only subject and level; it never trusts user metadata or a caller-supplied email. It does not yet grant rooms, create sessions, or link accounts. Eight unit checks pass. Requires server-only ShortScout environment configuration; no credentials requested in chat or configured yet. A narrow ShortScout-hosted verification endpoint may replace the privileged client once Lovable confirms supported access.

## Required before enabling

Current connected Supabase tool has no access to the ShortScout project. Lovable is still asking whether the programmer needs standalone tooling. Need live schema/policy confirmation and deployment access (or a Lovable-deployed minimal verification endpoint).

The checked-in migrations allow users to update their own profile and later add user_level without an obvious column guard. This is a code-level concern, NOT a confirmed production vulnerability: live policies/triggers may differ. Verify ordinary users cannot assign themselves a paid level before treating that field as authoritative. No attempt was made to modify any production membership.

## Login/linking design

- Authenticate with the chosen membership provider on that provider's site.
- Use an expiring, single-use authorization-code handoff bound to a browser challenge/PKCE and strict callback allowlist. Never put provider access tokens in URL query strings.
- Store a unique (provider, verified subject) identity linked to the canonical chat account. Never merge solely by matching email. Linking another provider requires proof of both sessions and explicit link intent.
- SS-only users must be able to enter SS/SOCIAL without purchasing LB; creating a central chat identity must not implicitly grant Longboard product access.
- Room access becomes an explicit entitlement policy, applied to server page/API checks, database RLS, search/context, reactions, attachments, and realtime. Update existing 'has a profile' policies before issuing SS-only sessions. Preserve current LB users/identities and history.
- Switching permitted rooms then uses the central chat session. Keep current SS admin restriction until the complete flow and denial tests pass.
- Verify invalid tokens, replayed/expired codes, forged callback/state, free SS users, SS-only users denied LB, dual membership, and account-link collision handling.

No production authentication or membership policy changed by this foundation.
