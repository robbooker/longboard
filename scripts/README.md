# scripts

Operational scripts for the Longboard project.

---

## `publish-audio.mjs`

CLI tool that takes a Voice Memos export, re-encodes it, uploads it to
Cloudflare R2, updates the matching essay's frontmatter, and commits
the change locally. Push is deliberately manual — run `git push` after
reviewing with `git status` / `git diff`.

### Prerequisites

1. **ffmpeg** installed and on `PATH`. If missing, the script exits at
   startup with `ffmpeg not installed. Run: brew install ffmpeg`.
2. **`.env.local`** at the repo root with five R2 keys:

   ```env
   R2_ACCOUNT_ID=...
   R2_ACCESS_KEY_ID=...
   R2_SECRET_ACCESS_KEY=...
   R2_BUCKET_NAME=tntp
   R2_PUBLIC_URL_BASE=https://audio.longboardai.com
   ```

   The npm script loads this file via Node 20's native `--env-file`
   flag — no `dotenv` dep. Missing keys produce a one-line error
   listing exactly what's absent.

3. **Node 20+**. Native `--env-file`, `readline/promises`, ESM default
   imports from CommonJS all depend on this.

### Usage

```bash
npm run publish-audio -- --file <path> --episode <N> [--dry-run]
```

| Flag | Required | Purpose |
| --- | --- | --- |
| `--file <path>` | yes | Path to the input audio file (`.m4a` or `.wav`). Absolute or relative. |
| `--episode <N>` | yes | Integer 1–999. Script zero-pads to `NNN` for the R2 key and the frontmatter glob. |
| `--dry-run` | no | Print what would happen at each step; do not encode, upload, write, or commit. |
| `-h`, `--help` | no | Print usage. |

### Typical case

You just finished recording episode 7 in Voice Memos, exported it to
`~/Downloads/memo.m4a`:

```bash
npm run publish-audio -- --file ~/Downloads/memo.m4a --episode 7
```

What happens:

1. Validates env keys + input file + episode range.
2. Verifies `ffmpeg` is on `PATH`.
3. Re-encodes to `{tmpdir}/longboard-007.m4a` at
   96 kbps AAC mono 44.1 kHz with `+faststart`.
   Typical Voice Memos size reduction: 30 MB → ~10 MB.
4. Uploads to R2 bucket `tntp` with key `007.m4a`, content-type
   `audio/mp4`. Public URL becomes
   `https://audio.longboardai.com/007.m4a`.
5. Finds `content/essays/007-*.mdx`. If present, prompts
   `About to update <path> with audio_url. Continue? [Y/n]`.
6. On Y, surgically inserts or updates the `audio_url` frontmatter
   field (adjacent to `published:`, no YAML re-serialization).
7. Runs `git add <path>` + `git commit -m "chore: add audio for
   issue 007"`. **No push.**

Review the commit with `git status` / `git show HEAD` / `git diff HEAD^`
before running `git push origin main`.

### Dry run

```bash
npm run publish-audio -- --file ~/Downloads/memo.m4a --episode 7 --dry-run
```

Prints the planned work and exits 0. Still runs env + file + ffmpeg
checks, so it doubles as a readiness check before a real run.

### No matching essay

If no `content/essays/{NNN}-*.mdx` exists for the episode number:

- Upload still succeeds.
- Script prints the public URL and exits 0.
- No frontmatter change, no commit.

Paste the URL manually into the frontmatter when the essay file
exists.

### Re-running

Idempotent. Re-running with the same `--file` + `--episode`:

- R2 upload overwrites the existing key silently.
- Frontmatter update detects the same URL and skips the write.
- `git commit` with nothing staged exits non-zero; the script
  catches this and prints `No changes to commit`.

### Error surfaces

All failures exit non-zero with one line on stderr. Categories the
script classifies specifically:

| Message | Likely cause |
| --- | --- |
| `Missing env: <keys>` | `.env.local` missing keys or script not invoked via `npm run publish-audio` |
| `ffmpeg not installed. Run: brew install ffmpeg` | ffmpeg binary not on PATH |
| `File not found: <path>` | Input file doesn't exist at the given path |
| `Unsupported input: expected .m4a or .wav, got .<ext>` | Input is a different audio format |
| `--episode must be 1..999, got <value>` | Episode number out of range or non-integer |
| `ffmpeg failed: <last stderr line>` | ffmpeg exited non-zero during re-encode |
| `R2 auth failed: check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY` | SDK returned `InvalidAccessKeyId` or `SignatureDoesNotMatch` |
| `R2 bucket not found: <name>` | SDK returned `NoSuchBucket` |
| `R2 upload failed: <msg>` | Anything else from the AWS SDK — verbose message follows |
| `Multiple essays match NNN-*.mdx — refusing to guess` | Two files share the same episode prefix (shouldn't happen given the naming scheme) |

### Troubleshooting

**"R2 upload failed: write EPROTO … SSL alert number 40"** — usually
means the `R2_ACCOUNT_ID` value is wrong. Cloudflare rejects the TLS
handshake when the account ID in the endpoint hostname doesn't
resolve. Double-check the value in the Cloudflare dashboard.

**Upload succeeds but `https://audio.longboardai.com/NNN.m4a`
returns 403** — bucket-level public access isn't configured. The
script does not set per-object ACLs (R2 rejects them). Configure
public-read at the bucket or custom-domain level in the Cloudflare
dashboard.

**Frontmatter edit drifts on other fields** — shouldn't happen. The
script uses a surgical regex that only touches the `audio_url` line;
everything else stays byte-identical. If it does, file a bug with
the diff and the input essay.

**"No matching essay" when one should exist** — confirm the filename
starts with the zero-padded episode number: `007-something.mdx`, not
`7-something.mdx`.

---

## `generate-cards.mjs`

Generates social share card PNGs for essays via Puppeteer. Reads
frontmatter from `content/essays/*.mdx`, renders each card variant
by screenshotting `scripts/card-template.html` in headless Chrome,
and writes PNGs to `public/og/`.

### Prerequisites

1. **Puppeteer** installed (devDependency — `npm install` handles it).
   Chromium downloads automatically on first install.
2. Essay frontmatter must include `share_quote_a` and `share_quote_b`
   for the generator to produce both treatments. Missing quotes →
   that treatment is skipped with a warning.

### Usage

```bash
# All essays — 2 treatments × 3 sizes × N essays
npm run generate-cards -- --all

# One essay
npm run generate-cards -- --slug confidence-is-built-not-declared
```

### Output

Files land in `public/og/` with the naming convention:

```
{slug}-{treatment}-{size}.png
```

| Treatment | Size | Suffix | Use |
| --- | --- | --- | --- |
| A (cream) | 1200×630 | `-a-og.png` | OG / Twitter / LinkedIn |
| A (cream) | 1080×1080 | `-a-square.png` | Instagram feed |
| A (cream) | 1080×1920 | `-a-story.png` | Instagram story |
| B (dark) | 1200×630 | `-b-og.png` | Alt OG / social posting |
| B (dark) | 1080×1080 | `-b-square.png` | Instagram feed (alt) |
| B (dark) | 1080×1920 | `-b-story.png` | Instagram story (alt) |

Essay detail pages automatically set `og:image` to the Treatment A
OG card (`/og/{slug}-a-og.png`).

### Regenerating

The script is idempotent — re-running overwrites existing PNGs.
To update a card after changing a quote, just re-run for that slug
or `--all`. Commit the updated PNGs and push.

---

## whisper.cpp (transcription)

Used by `ingest-episode.mjs` (Phase 3N) to transcribe audio files
locally before sending the text to the Claude API for rewriting.

### Prerequisites

1. **whisper-cli** installed via Homebrew: `brew install whisper-cpp`.
   Binary lands at `/opt/homebrew/bin/whisper-cli`.
2. **base.en model** downloaded to `~/.whisper/`:

   ```bash
   mkdir -p ~/.whisper
   curl -L -o ~/.whisper/ggml-base.en.bin \
     "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
   ```

   ~140MB download. Other models: `tiny.en` (75MB, fast, lower accuracy),
   `small.en` (460MB, higher accuracy), `medium.en` (1.5GB, highest).

### Manual transcription (standalone)

```bash
# Convert to 16kHz mono WAV (whisper-cli requires WAV input)
ffmpeg -i episode.m4a -ar 16000 -ac 1 -f wav /tmp/episode.wav

# Transcribe
whisper-cli -m ~/.whisper/ggml-base.en.bin -f /tmp/episode.wav --no-timestamps -otxt -of /tmp/episode
cat /tmp/episode.txt
```

The `ingest-episode` script handles the WAV conversion + transcription
automatically. This manual flow is for debugging only.

---

---

## Scheduled publishing (`publish_at`)

Essays can be committed and deployed ahead of time with a future
publish date. Before that date, they stay hidden from the site and
the podcast feed. At the scheduled moment, they become visible
automatically — no redeploy needed.

### Frontmatter field

Add `publish_at` to the essay's MDX frontmatter:

```yaml
---
issue: 13
slug: my-next-essay
title: "The next essay."
published: 2026-05-01
publish_at: 2026-05-01T09:00:00-04:00
audio_url: "https://audio.longboardai.com/013.m4a"
# ...rest of frontmatter
---
```

- **Format:** ISO 8601 datetime with timezone offset.
- **If absent:** essay is treated as already published (backward-
  compatible with all existing essays).
- **If in the future:** essay is hidden from `/learn`, its slug URL
  returns 404, and it's excluded from `/podcast.xml`.
- **If in the past:** essay is visible everywhere, same as no field.

### What happens at publish time

The site checks `publish_at <= now()` on every request (with a
60-second cache). Within a minute of the scheduled time:

- `/learn` shows the essay in the lead, features grid, and rail.
- `/learn/[slug]` renders the full essay.
- `/podcast.xml` includes the episode.

Spotify and Apple poll the feed on their own schedule (every 30–60
minutes), so the episode appears on those platforms shortly after.

### Workflow

```
1. Finish essay + record audio
2. Run publish-audio to upload and wire audio_url
3. Add publish_at to frontmatter with the desired datetime
4. git push origin main
5. Done — essay goes live automatically at the scheduled time
```

### Checking what's scheduled

```bash
grep -r 'publish_at:' content/essays/*.mdx
```

---

### Customizing quotes

Override the auto-parse fallback by setting explicit frontmatter:

```yaml
share_kicker: "On automation"
share_quote_a: "Treatment A quote with <em>emphasis</em>."
share_quote_b: "Treatment B quote with <em>emphasis</em>."
```

The `<em>` tags render as italic in the card template. Each quote
should have exactly one emphasized phrase.
