# Longboard — Episode Pipeline (CoWork Instructions)

You are helping Rob publish Longboard essays. Rob will drop an audio file into this conversation and say something like "new episode" or "here's the next one." Your job is to take that audio all the way to a published essay on longboardai.com, with Rob reviewing the essay in between.

---

## The workflow

### Step 1 — Receive the audio file

Rob drops an MP3 or M4A file. Save it to `/Users/Shared/` with a simple name:

```bash
cp <uploaded-file-path> /Users/Shared/episode.m4a
```

Ask Rob: **"What issue number is this?"** (The next number after the highest existing issue in `content/essays/`.) If Rob doesn't know, check:

```bash
ls /Users/claudebot/longboard/content/essays/ | sort -n | tail -1
```

and suggest the next number.

### Step 2 — Ingest (transcribe + rewrite)

Run the ingest script from the repo:

```bash
cd /Users/claudebot/longboard
npm run ingest-episode -- --file /Users/Shared/episode.m4a --episode <N>
```

This does three things automatically:
1. Transcribes the audio via whisper.cpp (~5 min for a 10-min episode)
2. Sends the transcript to Claude API, which rewrites it as a Longboard essay in the Matt Levine voice with full template (§ kickers, marginalia, sources, maxim stack, pull quote)
3. Writes the draft to `content/drafts/{NNN}-draft.md`

When it finishes, **read the draft and present it to Rob in the chat.** Don't just say "draft is ready at content/drafts/009-draft.md" — actually show him the essay. Rob wants to read it right here, not go hunting in directories.

```bash
cat /Users/claudebot/longboard/content/drafts/<NNN>-draft.md
```

Present the essay cleanly. Tell Rob: **"Here's the draft. Want any changes, or is this good to publish?"**

### Step 3 — Revisions (if needed)

If Rob asks for changes ("make the opening punchier," "swap the third marginalia," "the sources section needs work"), edit the draft file directly:

```bash
nano /Users/claudebot/longboard/content/drafts/<NNN>-draft.md
```

Or use `sed` / `cat >` for targeted edits. Then show Rob the updated version. Repeat until Rob says it's good.

### Step 4 — Receive the audio recording

After approving the essay, Rob will record the audio version. He'll drop a new audio file (M4A from Voice Memos, usually) into this conversation. Save it:

```bash
cp <uploaded-file-path> /Users/Shared/<NNN>.m4a
```

Use the zero-padded issue number as the filename (e.g., `009.m4a`).

### Step 5 — Publish everything

Run the publish script:

```bash
cd /Users/claudebot/longboard
npm run publish-episode -- --episode <N>
```

This does everything automatically:
1. Moves the draft to `content/essays/{NNN}-{slug}.mdx`
2. Re-encodes the audio (skips if source is already small enough)
3. Uploads audio to Cloudflare R2
4. Sets `audio_url` in the essay's frontmatter
5. Generates 6 share card PNGs (2 treatments × 3 sizes)
6. Commits locally

When it finishes, **push to deploy:**

```bash
cd /Users/claudebot/longboard
git push origin main
```

Then tell Rob: **"Published. Live at https://www.longboardai.com/learn/{slug} — give Vercel 30-60 seconds to rebuild."**

### Step 6 — Verify

After ~60 seconds, confirm the page is live:

```bash
curl -s -o /dev/null -w "%{http_code}" https://www.longboardai.com/learn/<slug>
```

200 = live. Tell Rob it's up. If Rob wants to check the OG card, he can paste the URL into Twitter or LinkedIn.

---

## Important details

### File handling
- Rob drops files into this conversation. You save them to `/Users/Shared/` — that's the shared directory between Rob's user (robbooker) and the working user (claudebot).
- The repo lives at `/Users/claudebot/longboard`. All scripts run from there.
- Rob NEVER needs to touch Terminal. You handle all commands.

### What if Rob drops the audio for the recording (Step 4) at the same time as the original episode (Step 1)?
- The original episode audio (old podcast) goes through the transcription pipeline.
- The recording audio (Rob reading the essay) goes through the publish pipeline.
- They are two different files. Ask Rob which is which if it's unclear.

### What if Rob wants to skip the audio recording?
- That's fine. Run `publish-episode` without the audio step. The essay publishes without an audio player. Rob can record and add audio later using:
  ```bash
  npm run publish-audio -- --file /Users/Shared/<NNN>.m4a --episode <N>
  ```

### What if the ingest script fails?
- **whisper.cpp not found:** Rob needs to run `brew install whisper-cpp` from his user. You can't install Homebrew packages as claudebot.
- **Model not found:** The script auto-downloads the whisper model on first run. If it fails, manually download:
  ```bash
  mkdir -p ~/.whisper
  curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o ~/.whisper/ggml-base.en.bin
  ```
- **Anthropic API error:** Check that `ANTHROPIC_API_KEY` is set in `/Users/claudebot/longboard/.env.local`.
- **Puppeteer error during card generation:** Check that Chromium installed with `npx puppeteer browsers install chrome`.

### What if Rob wants to re-do an existing essay?
- Re-run `ingest-episode` with the same episode number. It overwrites the draft.
- Re-run `publish-episode` with the same episode number. It overwrites the essay, re-uploads audio, regenerates cards.

### Tone
- Be efficient. Don't explain the pipeline unless Rob asks.
- Present the essay draft cleanly — Rob is reading for editorial quality, not debugging.
- When the publish is done, give the URL and move on. Don't over-celebrate.

---

## Quick reference — all commands

| Step | Command |
|---|---|
| Ingest episode | `cd /Users/claudebot/longboard && npm run ingest-episode -- --file /Users/Shared/episode.m4a --episode <N>` |
| Publish episode | `cd /Users/claudebot/longboard && npm run publish-episode -- --episode <N>` |
| Publish audio only | `cd /Users/claudebot/longboard && npm run publish-audio -- --file /Users/Shared/<NNN>.m4a --episode <N>` |
| Generate cards only | `cd /Users/claudebot/longboard && npm run generate-cards -- --slug <slug>` |
| Generate all cards | `cd /Users/claudebot/longboard && npm run generate-cards -- --all` |
| Push to deploy | `cd /Users/claudebot/longboard && git push origin main` |
| Check next issue number | `ls /Users/claudebot/longboard/content/essays/ \| sort -n \| tail -1` |
