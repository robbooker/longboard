# Repository and Git workflow

Goal: **everyone gets the upstream owner’s latest work without force-pushing or overwriting `main` on the wrong remote.**

## Remotes (after setup)

| Remote | URL | You push here? | You pull for upstream work? |
|--------|-----|----------------|------------------------------|
| `origin` | *your fork* (for example `gdwoods/longboard`) | **Yes** — daily work | Yes (your copy of `main`) |
| `upstream` | `robbooker/longboard` | **No** (unless you are a maintainer with permission) | **Yes** — source of truth |

## First-time clone (for someone new)

1. Fork [robbooker/longboard](https://github.com/robbooker/longboard) on GitHub to your account.
2. Clone **your** fork: `git clone https://github.com/<you>/longboard.git`
3. Add upstream: `git remote add upstream https://github.com/robbooker/longboard.git`
4. `git fetch upstream`

*(If the repository was cloned from the upstream URL by mistake, run `git remote rename origin upstream`, then `git remote add origin` with your fork URL, and set `main` to track `origin/main`.)*

## Day to day

**Start work (feature branch):**

```bash
git fetch upstream
git checkout main
git merge upstream/main   # or: git rebase upstream/main
git checkout -b feature/short-description
# edit, commit …
git push -u origin feature/short-description
```

Open a **pull request** on GitHub: `your fork:feature/...` → `robbooker:main`.

**Refresh `main` on your machine after upstream merges:**

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

## Rules of thumb

- Do not `git push --force` to `main` (yours or upstream’s).
- Force-push is only acceptable on **your own feature branch** on **your fork**, and only if you and reviewers agree (usually after a rebase).
- Large or risky change: open an **issue** or message maintainers **before** a huge pull request.

## Conventional commits (seen in repo)

Messages like `feat(phase3m): …` are common. Match that style for clarity in history.

## See also

- [Project context](./project-context.md)
- [Start here (collab index)](./README.md)
