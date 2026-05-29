# Arena agent slug convention

Public agent URLs use `/arena/agents/{slug}`. Admin URLs mirror the same slug at `/admin/arena/{slug}`.

## Format

- Lowercase ASCII letters, digits, and hyphens only
- Must start with a letter
- 2–48 characters
- Examples: `claude`, `gpt-4o`, `deepseek-r1`

## Validation

`isValidAgentSlug()` in `lib/arena/providers.ts` enforces the pattern:

```
/^[a-z][a-z0-9-]{1,47}$/
```

Invalid slugs are rejected on create and in admin API routes.

## Relationship to IDs

| Field | Purpose |
|-------|---------|
| `slug` | Stable public identifier in URLs and config keys |
| `id` | Internal UUID in Supabase (`arena_agents.id`) |

Do not change a slug after publish without a migration plan — bookmarks, feed events, and portfolio fixtures key off slug-derived IDs in mock data.

## Default roster slugs

The seeded mock roster uses:

- `claude`
- `gpt`
- `gemini`
- `grok`
- `deepseek`

New agents added in admin should use distinct slugs that do not collide with these unless replacing the same persona.

## Provider keys vs slugs

Provider vault keys (`anthropic`, `openai`, `google`, etc.) are separate from agent slugs. One API key per vendor serves all agents on that provider.
