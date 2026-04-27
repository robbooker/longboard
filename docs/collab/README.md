# Longboard — collaboration

This directory is the **versioned planning space** for people working on Longboard together. It pairs with the code in this repository and the GitHub **Issues** / **Pull requests** workflow.

> **Source of truth:** the copy in this repo’s `docs/collab/`. If you also keep a personal mirror (for example in Obsidian), treat this tree as what gets merged to `main`; bring changes in via pull request or copy edits from here after each sync.

## How to use it

- **New idea or risk?** Add a line in [Open questions and parking lot](./open-questions.md) (or open a [GitHub issue](https://github.com/robbooker/longboard/issues) when it is ready to track in code).
- **Chose a direction (architecture, process, tool)?** Record it in the [Decision log](./decision-log.md) so later readers know *why*, not only *what*.
- **Onboarding a collaborator?** Start with this page and [Repository and Git workflow](./repository-and-git-workflow.md).

## Index

| Doc | Purpose |
|-----|--------|
| [Project context](./project-context.md) | What we are building, stack, and repository facts (keep current). |
| [Repository and Git workflow](./repository-and-git-workflow.md) | Fork, remotes, sync, pull requests — avoid clobbering upstream. |
| [Decision log](./decision-log.md) | Dated decisions; short “context → decision → status”. |
| [Open questions and parking lot](./open-questions.md) | Unresolved items; promote to issues or meeting notes when ready. |
| [Meeting notes](./meeting-notes.md) | Running log; add a `### YYYY-MM-DD` section per session. |

## Conventions (edit as a team)

- **Date format:** `YYYY-MM-DD` in headings and log entries.
- **Secrets:** Never paste API keys, tokens, or production URLs with credentials. Say “in 1Password / Vercel / Supabase” instead.
- **Edits** to these docs: work on a branch, open a PR, same as code (see [Repository and Git workflow](./repository-and-git-workflow.md)).

---

*Last refreshed: 2026-04-27*
