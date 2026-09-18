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

If a job is canceled, credentials fail after merge, or a migration/deployment partially succeeds: inspect GitHub, migration history and Vercel using the recorded run ID before changing the ticket. A release already merged is explicitly rejected on reconfirmation; an operator must reconcile and verify it without re-merging. Never clear publishing/failed records just to unblock the queue. Automatic recovery remains excluded. A narrowly scoped, manually dispatched verification-only reconciliation is described below.

The GitHub concurrency group serializes this service, not humans or other deployment systems. Strict branch checks guard merge-time integration. External manual production deployments can still race aliases and will cause verification to stop.

## Validation

`node scripts/tests/chat-release-service-test.mjs` tests the state machine with mocked network services: exact head, failed checks, main changes, owner removal, lost claims, migration verification/replay refusal, deployment failure/wrong commit/wrong alias, live probe failure, dry-run immutability and fixed-origin secret handling. No production release is performed by these tests. Live service validation requires dedicated credentials and a separately reviewed infrastructure rollout.

### Setup verification and pending checks

The manual workflow accepts `dry_run=true, credentials_only=true` to verify all three saved credentials without reading or changing release records. This remains available with publishing disabled. A normal dry run validates the next approved ticket. GitHub's temporary unknown mergeability or running/missing integration checks leave approval intact and return `waiting`; the service claims only after preflight succeeds. Actual invalid-head/check failures are still recorded as failed in a live run.

### GitHub integration evidence

GitHub attaches the PR check run to the source head SHA, although the protected validation workflow checks out GitHub's integration commit. The service reads checks/statuses under the approved head, verifies the successful workflow path and its job/run association, then extracts the checkout SHA from the initial pinned checkout action's log. That SHA must equal the current integration commit whose parents match current main and the approved head. Workflow API `pull_requests` head/base metadata is not used as historical proof: live inspection showed it changes after subsequent pushes. Log reading uses the built-in Actions-read token; signed log downloads carry no authentication header and are bounded to 4MB.

The manual workflow also accepts `preview_request=UUID` with `dry_run=true` to validate a registered ready version before asking for owner approval. A preview cannot claim, migrate, merge, deploy or mark published. Live runs still require owner approval on the exact version. This prevents asking for another approval just to diagnose setup.


### Manual verification-only reconciliation (separate infrastructure rollout)

The runner/workflow change introducing this mode requires its own reviewed infrastructure rollout. It cannot publish itself through the ticket release queue, and the infrastructure-file guard remains in place. Do not execute this mode from an implementation branch or a desktop process with production credentials.

For a previously approved, already squash-merged ticket whose production deployment is live but whose release record failed verification, the dedicated main-branch workflow accepts `recovery_request` (ticket UUID) and `recovery_merge` (exact merged SHA). First use the default `dry_run=true`; inspect its `recovery_validated` result. A subsequent explicit manual dispatch with `dry_run=false` records reconciliation only after repeating verification. This mode cannot be combined with preview/credential checks and is rejected for scheduled events. It never merges, applies SQL migrations, creates/promotes deployments, or changes aliases.

Reconciliation is intentionally limited to migration-free releases in `approved` or `failed` state, with a ready ticket, the same registered head/version/PR/owner approval timestamp, and a currently authorized owner. It never steals a publishing claim or clears another failure. The atomic compare-and-swap checks the complete approval snapshot and excludes other publishing/failed records; the final update repeats those predicates and invokes the existing claim-owning release function. A failed preflight leaves the existing record unchanged. A failure after this service claims the record leaves it failed for inspection, never automatically retried.

GitHub must show the exact approved head/repository/main base merged at the operator-pinned SHA. The approved-head and squash-merge trees must match. The merge must remain an ancestor of main; main may have advanced for this infrastructure rollout. Historical required CI must belong to the approved head, correct validation workflow/job, and have checked out an integration commit with the squash merge's original base and approved head as parents and the identical tree. Current branch protection/bypass checks remain mandatory. The reviewed release plan and changed-file list must contain no migrations or self-modifying release infrastructure.

Both production aliases must name the same READY production deployment in the fixed project and GitHub repository at that exact merged SHA. Repository identity is checked through `gitSource.repoId`, or strict owner-response metadata (`githubCommitOrg`, `githubCommitRepo`, `githubCommitRepoId`) when gitSource is absent. Any supplied contradictory repository metadata is rejected. Fixed-origin HTTP probes run, then deployment details and both aliases are read again. Reconciliation repeats these checks after claiming and requires the same deployment ID throughout. No physical UI verification is implied by HTTP probes.

Normal publishing also verifies the actual alias target rather than requiring its ID to equal the explicit deployment the runner created. This tolerates GitHub integration and the service producing two deployments of the same approved commit, while rejecting a different commit/project/repository, preview target, non-READY deployment, split aliases, or alias changes during verification. The recorded deployment ID is the one actually serving both aliases. These checks detect observed races but cannot lock out external Vercel alias changes after verification.

Mocked coverage lives in `scripts/tests/chat-release-service-test.mjs`, already run by required CI. It includes dry-run immutability, manual-only entry, approval/state/claim races, tree/CI/ancestry mismatch, migrations, wrong live deployment identity, split/moving aliases, and successful duplicate-deployment reconciliation. No production calls are made by these tests.
