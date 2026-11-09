# Squawkbox audio retention (#393)

`public.squawkbox_relay_audio` stores every squawkbox clip the TraderRadio relay
uploads. It reached 8.5 GB. Migration
`supabase/migrations/20261110120000_squawkbox_audio_retention.sql` adds
`public.squawkbox_audio_prune()` and a nightly pg_cron job
(`squawkbox-audio-prune`, 09:30 UTC = 3:30 AM Central) that keeps 7 days.

## What gets deleted

Only rows where **all** of these hold:

- `path` starts with `audio-cache/` (TTS clips, named by content hash);
- `updated_at` is older than 7 days (for these clips that is the first upload
  time: the relay skips clips that already exist, it never re-touches them);
- the path is not mentioned in `public.squawkbox_relay_state` (the live
  `feed` / `playout` rows listeners read).

Never deleted: `sounds/...` (bells, session cue, evening shows) and
`smoke-probe/keepalive.txt` (the relay health probe).

If a deleted clip is needed again (station IDs repeat for weeks), the relay
sees it is missing and re-uploads it on its next cycle, before it writes the
playout that points at it.

## One-time first cleanup (run by hand, quiet hour)

The migration does **not** delete anything. On 2026-11-09 the first run would
remove about 18,459 rows / ~7,960 MB (stored) and keep ~1,140 rows.

### 1. Back up the rows that will be deleted

Needs `psql` and the prod connection string (Supabase dashboard, Connect,
Session pooler; keep it out of git and shell history, e.g. in `$PROD_DB_URL`).
The file is about 6 GB (base64 audio barely compresses).

```bash
mkdir -p ~/backups
# \copy must stay on one line.
psql "$PROD_DB_URL" -c "\copy (select a.path, a.content_type, a.body_base64, a.byte_length, a.updated_at from public.squawkbox_relay_audio a where a.path like 'audio-cache/%' and a.updated_at < now() - interval '7 days' and a.path not in (select distinct m[1] from public.squawkbox_relay_state s cross join lateral regexp_matches(s.payload::text, '(audio-cache/[A-Za-z0-9._-]+)', 'g') as m)) to stdout with (format csv, header)" | gzip > ~/backups/squawkbox_relay_audio_$(date +%F).csv.gz
```

Check it: `gzip -t` the file and `zcat ... | wc -l` should be about the row count + 1.

### 2. Run the prune

Each call is one transaction; cap it so no single call runs long. Repeat until
it returns 0:

```bash
supabase db query --linked --project-ref qnwizieggisnbjqyxrjo \
  "select public.squawkbox_audio_prune(interval '7 days', 2000, 4000)"
```

(Arguments: keep, batch size, max rows for this call. With no arguments it uses
7 days and no cap, which is what the nightly job does: ~160 rows a night.)

### 3. Give the disk back

Deleting frees space inside the table for reuse, but the database file stays
8.5 GB until the table is rewritten:

```sql
VACUUM FULL public.squawkbox_relay_audio;
```

**Warning:** `VACUUM FULL` takes an exclusive lock on the table for the whole
rewrite (minutes). While it runs the relay cannot check or upload clips and
listeners cannot fetch any relay audio. Run it at a quiet hour (e.g. 3:30-5 AM
Central, after step 2), never during market hours. It needs free disk about the
size of what is left (~600 MB). `pg_repack` (if the extension is enabled) does
the same with only a brief lock at the end.

After it finishes:

```sql
select pg_size_pretty(pg_total_relation_size('public.squawkbox_relay_audio'));
```

The nightly job does not need `VACUUM FULL` afterwards: autovacuum lets new
clips reuse the space the nightly delete frees, so the table stays around a
week of audio (~500 MB).

## Checking the job

```sql
select jobname, schedule, active from cron.job where jobname = 'squawkbox-audio-prune';
select status, return_message, start_time from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'squawkbox-audio-prune')
 order by start_time desc limit 5;
```
