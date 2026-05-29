# AI Arena — Auth Toggle

The Arena section at `/arena` ships **public by default** (no login required), matching the rallies.ai spectator model.

## To make Arena invite-only

Add `/arena/:path*` to the `matcher` array in [`middleware.ts`](../../middleware.ts):

```typescript
"/arena/:path*",
```

Users without a session will redirect to `/login?next=/arena/feed`.

## Current default

- No middleware entry for `/arena`
- Comment in [`app/arena/layout.tsx`](../../app/arena/layout.tsx) documents the toggle
- Arena link appears in the global nav for all visitors (alongside Learn)

Rob decides which mode to use in production.
