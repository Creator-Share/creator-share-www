# Vercel CI Workarounds: Handling Git Commit Author Restrictions

## Background and Motivation

Vercel enforces strict validation of the Git commit author for branches that
trigger deployments. The commit author must be a recognised Vercel team member.
This means commits authored by external contributors (volunteers, open-source
contributors) cause deployment failures when pushed directly to a deploy branch.

Our development workflow involves multiple contributors committing to `dev` or
feature branches. Because volunteer contributors are not Vercel team members,
we cannot point Vercel directly at `dev` without risking failed builds.

## Solution: Author Rewriting via GitHub Actions

We maintain a dedicated deployment branch (`deploy-dev`) that Vercel watches.
A GitHub Actions workflow automatically keeps `deploy-dev` in sync with `dev`
on every push, rewriting the latest commit's author to the `CreatorShare`
identity that Vercel recognises before force-pushing.

**This is fully automatic. No manual steps are required.**

### How It Works

1. A contributor's PR is merged into `dev`.
2. The push to `dev` triggers `.github/workflows/sync-deploy-dev.yml`.
3. The workflow runs `scripts/rewrite_authors.sh --force`, which:
   - Creates a temporary branch from `dev`.
   - Amends the latest commit's author to `CreatorShare <creatorshare@thegeeky.ninja>`.
   - Resets `deploy-dev` to this amended commit and force-pushes.
4. Vercel detects the push to `deploy-dev`, recognises the author, and builds.
5. `dev.creatorshare.com` is updated within a few minutes of the merge.

### Relevant Files

| File | Purpose |
|---|---|
| `.github/workflows/sync-deploy-dev.yml` | GitHub Action that runs on every push to `dev` |
| `scripts/rewrite_authors.sh` | Rewrite script (also supports `--force` one-shot and daemon modes) |

## Important Rules

- **Never commit directly to `deploy-dev`.** It is managed exclusively by the
  GitHub Action. Manual commits will be overwritten on the next `dev` push.
- **Never point Vercel at `dev` directly.** Contributors' commit authors will
  not match the Vercel team member list and builds will fail.
- The `staging` and `main` branches follow the same principle but use PRs
  created by the CreatorShare GitHub account rather than author rewriting.
  See `docs/branches.md` for the full branching strategy.

## Troubleshooting

### dev.creatorshare.com is not updating after a merge

1. Go to the [Actions tab](https://github.com/Creator-Share/creator-share-www/actions)
   and check whether the **"Sync dev → deploy-dev"** workflow ran and passed.
2. If the workflow failed, inspect the logs. Common causes:
   - `deploy-dev` branch was deleted — recreate it from `dev` and re-run.
   - `GITHUB_TOKEN` lost write permission — check repository Settings → Actions → General → Workflow permissions (must be "Read and write").
3. If the workflow succeeded but Vercel did not build, check the Vercel dashboard
   for the `deploy-dev` branch deployment and inspect the build logs there.

### Manual one-shot sync (emergency use only)

If the GitHub Action is unavailable and you need to sync immediately, run this
from the repo root on a machine that has push access:

```bash
git fetch origin
git checkout -b deploy-dev origin/deploy-dev 2>/dev/null || git checkout deploy-dev
git checkout dev
bash scripts/rewrite_authors.sh --force
```

### Running as a local daemon (legacy, not recommended)

The original approach ran the script in a continuous polling loop on a
contributor's local machine. This is no longer needed or recommended — the
GitHub Action is the canonical mechanism. The daemon mode is documented in the
script itself (`scripts/rewrite_authors.sh`) for reference only.
