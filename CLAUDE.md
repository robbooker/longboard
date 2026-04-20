# CLAUDE.md — Longboard

## Scout Vault session memory

CC has Scout Vault access through the claude.ai MCP bridge. Tools are prefixed
`mcp__claude_ai_scoutvault__*` (e.g. `search_memory`, `store_memory`,
`search_trades`, `store_trade`, `bm_status`). This is the same vault that
chat-Claude and Buddy write to — one shared memory across all three.

Note: the connection is via the claude.ai bridge, **not** a user-scoped MCP
registered with `claude mcp add`. If someone runs `claude mcp list` they'll see
the entry as `claude.ai scoutvault`, not a separate local server. Do not run
`claude mcp add scoutvault ...` — it would create a redundant second connection
or collide on the name.

### At the start of every session

Run one `search_memory` call with a query relevant to the task before starting
work. Example: asked to work on TradeZero dashboard features → search
`"Longboard TradeZero dashboard recent changes"`. This catches prior decisions,
known bugs, and prevents re-litigating settled questions.

### At the end of every session

Run one `store_memory` call summarizing what shipped.

Title format: date + main deliverable. Examples:
- `Longboard Issue 020 published — 2026-04-19`
- `TradeZero Open Orders restore + Polygon quotes wired — 2026-04-20`
- `Phase 3Q kickoff — audit complete, awaiting Rob review — 2026-04-21`

Content: 2-4 sentences. Tight. Signal over narrative. Include:
- What was built or fixed (with commit hashes)
- Any bugs hit + how they were resolved
- Any open questions or follow-ups
- Any decisions made (technical or product) that diverged from the handoff

Do NOT store: interim debugging output, failed attempts that got reverted,
chatty session notes, raw tool output. Scout Vault is durable signal, not a
transcript dump.

### Security note

The scoutvault endpoint has no auth today — any connection from the internet
can read and write. Fine for current single-user setup; if abuse appears or the
vault opens to other Boardroom members, add Bearer auth on the Caddy side.
