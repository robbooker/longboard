# Phase 3K — Audit

**Status:** pre-implementation audit. Commit 0 of the Phase 3K plan. No code changes in this commit.
**Date:** 2026-04-15
**Author:** CC

Rob has pre-locked all five decisions the handoff called out as "ask
before building." This doc records them, plus the surrounding
convention details the script needs to respect. Rob's green-light on
this doc gates Commit 1.

---

## The five locked decisions

### 1. Re-encode

**Yes.** Script re-encodes with ffmpeg to **96 kbps AAC mono at 44.1 kHz**.
Normalizes encoding for consistent browser/podcast playback; output
size depends on source bitrate (a low-bitrate source may grow
slightly). Shell command:

```
ffmpeg -i <input> -c:a aac -b:a 96k -ac 1 -ar 44100 -movflags +faststart <output>
```

ffmpeg is a **hard dependency**, not an optional fallback. Check
`which ffmpeg` at script startup — if missing, exit 1 with:

```
ffmpeg not installed. Run: brew install ffmpeg
```

Rationale: falling back to "upload as-is" silently ships 30 MB files and
defeats the point. Better to fail early with a clear fix than to burn
R2 bandwidth on one unexpected run.

### 2. Filename convention

**Enforce `NNN.m4a` (zero-padded 3-digit).** The CLI accepts an
`--episode N` integer; the script zero-pads to three digits and
constructs `{NNN}.m4a` itself. The `--file` arg names the input; the
output filename is never user-specified.

- `--episode 3` → uploads as `003.m4a`
- `--episode 42` → uploads as `042.m4a`
- `--episode 1000` → rejected (integer range 1–999)
- `--episode abc` → rejected

Rationale: eliminates the whole class of mistake where Rob types
`3.m4a` instead of `003.m4a` and the podcast RSS feed later sorts
lexically wrong.

### 3. Frontmatter auto-update

**Auto-update with confirmation prompt.** After upload succeeds:

1. Glob `content/essays/{NNN}-*.mdx` using the padded episode number.
2. **No match:** print a warning, print the upload URL, exit 0. Rob
   can paste manually. Not a failure — the upload succeeded.
3. **Multi-match:** error and exit 1. Shouldn't happen given the
   naming scheme, but if it does we refuse to guess.
4. **Exactly one match:** prompt
   `About to update content/essays/NNN-slug.mdx with audio_url. Continue? [Y/n]`.
   Default Y. On Y, use `gray-matter` to set `audio_url`, write back.
5. Position `audio_url` near the top of the frontmatter (adjacent to
   `read_minutes` or `published`), not appended to the bottom.

### 4. Commit behavior

**Auto-stage + auto-commit locally. Never auto-push.** After the
frontmatter write:

1. `git add content/essays/{NNN}-slug.mdx`
2. `git commit -m "chore: add audio for issue {NNN}"`
3. Print: `Committed locally. Run \`git push origin main\` to deploy.`

Rationale: auto-pushing to a live site without Rob eyeballing
`git status` first is too aggressive. The commit lands in the
working tree; the push is a deliberate human action.

### 5. Credentials location

**`.env.local` at repo root.** Already gitignored, already used for
other secrets, consistent with how Supabase / Alpaca / TradeZero /
Polygon keys are loaded. Required keys:

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=tntp
R2_PUBLIC_URL_BASE=https://audio.longboardai.com
```

Script loads via `dotenv` (or Node 20 native `--env-file` flag).
Missing keys → exit 1 with a list of what's absent.

---

## Confirmed conventions

### Node version

**Node 20.** Matches the existing project convention (`.nvmrc`, Vercel
build target). Top-level `await`, native fetch, `import.meta.url`,
native `--env-file` flag all available.

### CLI invocation shape

```
npm run publish-audio -- --file <path> --episode <N> [--dry-run]
```

- `--file <path>` — absolute or relative path to a `.m4a` or `.wav`
  Voice Memos export. Required.
- `--episode <N>` — integer 1–999. Required.
- `--dry-run` — skip ffmpeg, skip upload, skip frontmatter write,
  skip commit. Print what would have happened at each step.
  Useful for sanity checks before real runs.
- `--help` — print usage and exit 0.

### ffmpeg dependency

**Hard dependency.** Locked per decision 1 above. `which ffmpeg`
runs at startup. If absent, exit before any other work with:
`ffmpeg not installed. Run: brew install ffmpeg`.

---

## R2 specifics the script must respect

From the handoff, captured here so the script author (CC) doesn't
need to keep switching docs:

- **Endpoint:** `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
- **Region:** literally `auto` (not `us-east-1` — easy first-try mistake)
- **PutObjectCommand:** do **not** pass `ACL: 'public-read'`. R2 rejects
  the parameter. Bucket-level config handles public access.
- **Content-Type:** `audio/mp4` for M4A uploads.
- **Public URL pattern:** `${R2_PUBLIC_URL_BASE}/${NNN}.m4a`

---

## Idempotency

Re-running with the same `--episode N`:
- R2 upload overwrites the existing key silently (fine).
- Frontmatter update sets the same URL again (no-op if gray-matter
  preserves field order).
- Git commit — if nothing changed, `git commit` exits non-zero. Script
  catches this and prints "No changes to commit; upload complete."

---

## Error surfaces

All failures print **one line** and exit non-zero. No stack traces.
Categories:

| Failure | Message |
| --- | --- |
| Missing `.env.local` key | `Missing env: R2_ACCOUNT_ID` (etc.) |
| ffmpeg not installed | `ffmpeg not installed. Run: brew install ffmpeg` |
| Input file missing | `File not found: <path>` |
| Input file wrong ext | `Unsupported input: expected .m4a or .wav, got .mp3` |
| Episode out of range | `--episode must be 1..999, got 1000` |
| ffmpeg non-zero | `ffmpeg failed: <last stderr line>` |
| R2 auth failed | `R2 auth failed: check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY` |
| R2 bucket wrong | `R2 bucket not found: <name>` |
| Multi-match on glob | `Multiple essays match 003-*.mdx — refusing to guess` |

AWS SDK errors print verbatim below the one-line summary, for
debugging. The one-liner comes first so a scrolled terminal still
shows the actionable message.

---

## Gate

Commit 1 does not start until Rob green-lights this doc. The handoff
working convention for audit docs is explicit on that.
