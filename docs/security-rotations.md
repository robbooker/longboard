# Security Rotations Log

Dated log of secret rotations. Each entry records what rotated, why, and
where the value was updated. The actual secret values never appear here —
this is a log of events, not a store.

---

## 2026-04-15 — `BUDDY_API_KEY` / `TZ_PROXY_API_KEY`

**Reason:** scheduled rotation of the shared TradeZero proxy auth secret.
Old key had been in use since the early build sessions; this is the first
rotation since the value was introduced.

**Generated value:** `openssl rand -hex 32` on 2026-04-15.

**Places updated:** (all by Rob, coordinated at rotation time)

1. **Buddy server** (`45.55.64.14`) — `.secrets` file, `BUDDY_API_KEY` entry.
2. **Supabase Edge Function** `tradezero-proxy` — secret updated via the
   Supabase dashboard's Function Secrets UI.
3. **Rob's per-user vault** via `/settings/keys` → TradeZero → Proxy API Key.
   This is the authoritative location since Phase 2A moved broker keys
   into the per-user `user_broker_keys` table. Every app-side read goes
   through the vault, not an env var.
4. **Rob's local** `.env.local` — updated for parity in local dev even
   though the dev flow uses the vault path too.

**Places NOT updated:**

- Vercel prod env var `TZ_PROXY_API_KEY` — per Phase 2A Step 7, this env
  var was deleted from Vercel production. No app code reads it. If Rob
  never completed that deletion, the old value in Vercel is now stale
  but harmless (dead code). Re-check with `vercel env ls production | grep TZ_` and delete if still present.

**Repo verification:**

```
$ grep -rn "247eb28e" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
./.env.local:14:TZ_PROXY_API_KEY="247eb28e..."
```

Only hit was Rob's local `.env.local`, which is gitignored. Git history
and tracked files are clean of the old value.

**Smoke test:** immediately after rotation, `/tradezero` was loaded in the
browser. Positions + account data rendered correctly, confirming the new
key round-tripped through Buddy → proxy → app successfully.

---

## Template for future entries

```
## YYYY-MM-DD — <secret name>

**Reason:** <why it rotated — scheduled, leak response, etc.>
**Generated value:** <where/how>
**Places updated:** <numbered list>
**Places NOT updated:** <if anywhere relevant was skipped, note why>
**Repo verification:** <grep command + output>
**Smoke test:** <what was exercised post-rotation>
```
