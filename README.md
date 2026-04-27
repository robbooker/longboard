# Longboard

AI-powered stock research terminal. Enter a ticker → Buddy (the AI agent running on OpenClaw) pulls data from Polygon, Brave Search, and SEC EDGAR → results appear on the page in real time via Supabase.

## Collaboration

For planning, the decision log, and git workflow for contributors, see **[docs/collab](docs/collab/)** (the versioned copy; merge changes via pull request). If you also keep a local copy (for example in Obsidian), match it to that tree when sharing work.

## Stack

- **Next.js 14** (App Router, TypeScript)
- **Tailwind CSS** (IBM Plex Mono — terminal aesthetic)
- **Supabase** (Postgres + Realtime subscriptions)
- **Buddy** (OpenClaw AI agent on 45.55.64.14 — polls the DB and writes results)

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up Supabase
Run the SQL in `supabase-migration.sql` in the [Supabase SQL Editor](https://supabase.com/dashboard/project/qnwizieggisnbjqyxrjo/sql/new).

### 3. Configure environment
```bash
cp .env.local.example .env.local
# Fill in your NEXT_PUBLIC_SUPABASE_ANON_KEY
```

### 4. Run locally
```bash
npm run dev
```

### 5. Deploy
```bash
npm run build
npm start
```
Or deploy to Vercel — just add the two env vars in the Vercel dashboard.

## How it works

1. User enters a ticker and hits RESEARCH
2. App inserts a row into `ticker_research` with `status = 'pending'`
3. App subscribes to real-time updates on that row
4. Buddy (cron job, every 2 min) polls for `status = 'pending'` rows
5. Buddy sets `status = 'processing'`, runs research (Polygon + Brave + SEC EDGAR)
6. Buddy writes the formatted report to `result`, sets `status = 'complete'`
7. App receives the real-time update and displays the report

## Buddy's cron job
See the Buddy cron spec in the Scout project for the polling logic.
