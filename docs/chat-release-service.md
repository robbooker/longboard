# Owner-approved release service

The feature page remains the approval authority. An owner approves a registered PR number, head SHA and version; a fixed GitHub Actions runner consumes that structured record. Ticket prose, comments and model output cannot approve releases. No LLM participates in the publishing decision.

## What ships

- `chat-release-service.yml`: serialized scheduled service, every five minutes from 07:00–16:55 America/Chicago (including weekends; GitHub scheduling can be delayed), plus manual dry run. Disabled unless repository variable `CHAT_RELEASE_SERVICE_ENABLED=true`. The desktop ticket scheduler remains paused and must not perform release claims after cutover.
- Credentialed code always comes from main, never the PR. It uses Node built-ins, no package installation, no shell interpolation and no execution of PR scripts.
- Separate `Chat release checks` runs the integration checkout without production credentials: tests, TypeScript and production build. Main must require that check with strict up-to-date enforcement. Existing protection rules must be preserved.
- Exact repository/head, current main integration parents, current owner, migration digests, Vercel project/commit, both live aliases and reviewed HTTP probes are checked. The merge API receives the approved SHA.
- One release per run. Publishing/failed records stop new releases. Failures are recorded on the ticket, not automatically retried. A killed job leaves its claim intact for operator recovery; no lease stealing.
- Release workflow/runner changes cannot publish themselves; use a separate reviewed rollout. Renames are checked at both paths.

## Credential setup

Run directly in an interactive terminal (not a heredoc):

```sh
python3 /tmp/longboard-release-service/scripts/chat-release-setup.py
```

The script sends hidden input directly to `gh secret set` via stdin. No token is stored locally, printed, or put in command arguments. It creates/restricts the `longboard-release` environment to main before storing credentials. Requires repository admin access; does not activate the service.

Use a dedicated Supabase management token scoped to project `qnwizieggisnbjqyxrjo` with the database query and migration permissions required by `/database/query` and `/database/migrations`. Use a dedicated Vercel token scoped to the Longboard team with deployment creation/read and alias-read access. Neither token belongs in the browser, application client, PR test job, chat, or public repository. No local service-role credential is introduced. Use a dedicated fine-grained GitHub token restricted to robbooker/longboard: contents and pull requests write; administration, checks and commit statuses read. Administration read is needed to verify strict branch protection; no administration write or workflow write permission is required. The default workflow token is read-only.

## Reviewed per-ticket release plan

Include `.release/REQUEST_UUID.json` in the implementation before its head is registered for owner approval:

```json
{
  "version": 1,
  "requestId": "11111111-1111-4111-8111-111111111111",
  "migrations": [],
  "probes": [{"path": "/chat/login", "status": 200, "contains": "Sign in"}]
}
```

Each new migration must appear exactly once with `path`, SHA256 of its file bytes, and `backwardCompatible:true`. Modified, removed and renamed migrations stop the release. Compatibility is a reviewed assertion, not something this service can prove. Only SQL from the approved head is applied, before merge; its migration history record must appear. Already-recorded migration names stop for inspection rather than replaying potentially non-idempotent DDL. Partial application cannot be silently retried.

Probes use fixed `https://www.longboardai.com` URLs without credentials or redirects. They establish live HTTP smoke coverage; they do not prove all authenticated UI behavior. Feature-specific browser acceptance remains part of implementation validation. Do not describe a login-page smoke check as verification of every feature.

## First activation / cutover

1. Review/bootstrap this infrastructure PR separately; it cannot release itself. Keep the enable variable unset/false.
2. Install the three dedicated credentials with the terminal script; verify the environment permits only main and has no extra human gate if one-button publishing is desired.
3. Add `Chat release checks` to existing main protection, preserving all existing checks and restrictions; set strict up-to-date checks, enforce protections for administrators, and allow no release-actor bypass. The runner refuses to merge without these safeguards. Ensure the workflow token has permission to read checks/statuses and merge subject to branch protections.
4. Prepare an approved, tested ticket with a release plan and run the service in dry-run mode. Manual dry runs work while the enable variable is false; scheduled writes remain disabled. Set the enable variable to true only for the supervised release after the dry run passes.
5. Validate a supervised real release through claim, migration if applicable, merge, Vercel READY/aliases and live probes before declaring the service operational. GitHub-triggered Vercel deployments may also run; the service explicitly deploys the exact merge SHA and verifies the deployment owning both aliases.
6. Resume desktop development-only polling only after replacing the old instruction to claim/publish releases. Never run two release coordinators.

Current PR288/289 predate release plans and integration CI. They are not silently released by installing this service; prepare their reviewed plans/checks before cutover. No queued release has been claimed by this implementation.

## Recovery and limits

If a job is canceled, credentials fail after merge, or a migration/deployment partially succeeds: inspect GitHub, migration history and Vercel using the recorded run ID before changing the ticket. A release already merged is explicitly rejected on reconfirmation; an operator must reconcile and verify it without re-merging. Never clear publishing/failed records just to unblock the queue. Recovery automation is intentionally excluded until its idempotency can be validated.

The GitHub concurrency group serializes this service, not humans or other deployment systems. Strict branch checks guard merge-time integration. External manual production deployments can still race aliases and will cause verification to stop.

## Validation

`node scripts/tests/chat-release-service-test.mjs` tests the state machine with mocked network services: exact head, failed checks, main changes, owner removal, lost claims, migration verification/replay refusal, deployment failure/wrong commit/wrong alias, live probe failure, dry-run immutability and fixed-origin secret handling. No production release is performed by these tests. Live service validation requires dedicated credentials and a separately reviewed infrastructure rollout.
