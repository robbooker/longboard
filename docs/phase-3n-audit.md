# Phase 3N — Audit

**Status:** pre-implementation audit. Commit 0 of the Phase 3N plan. No code changes in this commit.
**Date:** 2026-04-16
**Author:** CC

Six open questions from the handoff. Answers below. Rob's
green-light on this doc gates Commit 1.

---

## 1. whisper.cpp installation — **Homebrew**

Option (a). `brew install whisper-cpp`.

Formula exists: stable 1.8.4, dependencies `ggml` + `sdl2`.
Verified on this machine — not yet installed but the formula is
current and builds for Apple Silicon.

Models are NOT bundled — the formula ships the binary but tells
you to download GGML model files separately. The script will
download the model on first run if it's missing (see Q2).

**Model download path:** whisper.cpp looks for models at the path
passed via `--model` flag. By convention, models live at
`~/.whisper/` or in the Homebrew Cellar's `share/whisper-cpp/models/`
directory. The script will use `~/.whisper/ggml-base.en.bin` as
the default and download from HuggingFace if absent.

---

## 2. Whisper model size — **base.en (default), overridable**

`base.en` (~140MB). Good accuracy for clear single-speaker English,
runs in ~2x realtime on Apple Silicon (a 10-minute episode
transcribes in ~5 minutes).

Rob's audio profile (single speaker, clear speech, no background
noise, recorded on Apple Voice Memos) is ideal for `base.en`.
Higher models (`small.en`, `medium.en`) would be slower without
meaningful accuracy improvement for this use case.

`--model` flag on the CLI lets Rob override to `small.en` or
`medium.en` if a particular episode has noisier audio.

---

## 3. Prompt structure — **external file**

Option (b). `scripts/prompts/levine-essay.md`.

The prompt file contains:
- Voice description (the full Levine register spec: parenthetical
  asides, deadpan, "Look," openers, etc.)
- Structural requirements (§ H2 kickers, 5 marginalia with labels,
  3 real academic citations, 5-maxim closing stack, Pullquote,
  lede paragraph)
- Complete frontmatter YAML schema with field types + descriptions
- 2 short register examples pulled from existing essays

**Why external:** Rob can iterate the prompt in a text editor or
paste it into a Claude chat for refinement without opening the
script. The rewrite helper reads it at runtime — changes take
effect on the next `ingest-episode` run with zero code changes.

---

## 4. Source citation handling — **generate from transcript**

Option (a). Claude identifies the concepts in the transcript and
generates real citations from its training data. Same workflow
we've used for all 8 existing essays.

The human review step (mandatory — `publish-episode` is a separate
command) catches any hallucinated or incorrect citations before
they reach production. This matches the existing editorial process
where Rob reviews every essay before push.

---

## 5. Slug generation — **prompt with auto-suggestion**

Option (b). The script auto-generates a slug from the title
(lowercase, hyphenate, strip punctuation) and presents it as the
default in an interactive prompt:

```
Slug for this essay [the-disposition-effect-is-not-your-friend]:
```

Rob presses Enter to accept or types an override. The slug is
written into the draft's frontmatter.

---

## 6. Transcript preservation — **save alongside draft**

Option (a). Raw whisper transcript saved at
`content/drafts/{NNN}-transcript.txt`.

Zero cost to keep, useful for three things:
- Debugging if the rewrite misses something from the audio
- Re-running the rewrite with a different prompt without
  re-transcribing (transcription is the slow step)
- Future search/reference across all transcripts

---

## Cross-cutting confirmations

### Prerequisites verified on this machine

| Dep | Status |
| --- | --- |
| whisper.cpp homebrew formula | Available (1.8.4), not yet installed |
| `ANTHROPIC_API_KEY` in `.env.local` | Set |
| `@anthropic-ai/sdk` npm | Not installed; will add in C2 |
| Phase 3K `publish-audio.mjs` | Exists, functional |
| Phase 3M `generate-cards.mjs` | Exists, functional |
| `content/drafts/` directory | Does not exist yet; C3 creates it |

### content/drafts/ gitignore policy

The `content/drafts/` directory should be git-tracked (not
gitignored). Drafts are intermediate artifacts that Rob may want
to reference later — "what did the AI write before I edited it?"
Transcripts too.

If this directory grows large enough to be a concern (unlikely
for text files), it can be gitignored later. For v1, tracking
is simpler and matches how `content/essays/` works.

### Script refactoring scope

Phase 3K (`publish-audio.mjs`) and 3M (`generate-cards.mjs`) are
monolithic CLI scripts — their core logic is inline in the top-level
module, not factored into importable functions. `publish-episode`
needs to call their logic programmatically.

Two options:
- (a) **Extract** core logic into `scripts/lib/` modules, have both
  the standalone CLIs and `publish-episode` import from there.
- (b) **Shell out** — `publish-episode` spawns them as child
  processes with the right args.

Recommend (b) for v1. Simpler, no refactor risk on working scripts,
and both scripts already have clean CLI surfaces. The overhead of
spawning a Node process is ~200ms — irrelevant alongside whisper's
5-minute transcription. If the spawn approach proves clunky, extract
in a later pass.

---

## Gate

Commit 1 does not start until Rob green-lights this doc.
