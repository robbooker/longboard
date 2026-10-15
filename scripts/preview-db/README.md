# Preview database (preview deployments only)

Vercel **Preview** deployments use their own Supabase project, `longboard-preview`
(ref `mtcxfsajnlpyxohkhofr`, us-west-2), not production (`qnwizieggisnbjqyxrjo`).
Messages sent on a preview land there and never reach longboardai.com.

- Structure: a schema-only copy of production's `public` and `private` schemas (tables,
  functions, RLS policies, grants, triggers), the `chat-attachments` bucket config, the
  `supabase_realtime` table list, and the migration history list. No production rows.
- Data: fake members and chat history from `seed.mjs` (re-runnable; refuses production).

## Signing in on a preview

Use the normal Longboard sign-in (`/login`, or `/chat/login` -> "Sign in with Longboard")
with one of the seeded members. They all share one test password, kept outside the repo
(Rob's machine: `~/.config/longboard/preview/test-password`).

| Member | Email | Access |
| --- | --- | --- |
| Avery Admin | avery.admin@preview.longboard.invalid | admin, every room |
| Alice / Bob / Carol / Dave Preview | alice@ / bob@ / carol@ / dave@preview.longboard.invalid | LB + SOCIAL (Boardroom cohort) |
| Mallory Outsider | mallory@preview.longboard.invalid | SOCIAL + GAINERS only |

There is no sign-in bypass in the code; these are ordinary password accounts that exist only
in the preview project. Sign-ups are disabled on the preview project.

## Re-seeding

```
PREVIEW_SUPABASE_URL=https://mtcxfsajnlpyxohkhofr.supabase.co \
PREVIEW_SUPABASE_SERVICE_ROLE_KEY=<preview service_role key> \
PREVIEW_SEED_PASSWORD=<test password> \
node scripts/preview-db/seed.mjs
```

## Keeping the structure in step

Apply each new migration to the preview project as well as production, e.g.
`supabase db query --linked --project-ref mtcxfsajnlpyxohkhofr -f supabase/migrations/<file>.sql`.
