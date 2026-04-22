# Branching and Deployment Process

## Overview

We use a structured branching and deployment workflow to ensure consistent and
reliable deployments across environments. This includes dedicated branches for
development, staging, and production.

Because this is a volunteer open-source project, contributors are not Vercel
team members. Vercel requires that the commit author of any deploy-triggering
push be a recognised team member, so a GitHub Actions workflow automatically
rewrites the commit author before pushing to deployment branches. This is
invisible to contributors — merging a PR into `dev` is all that is required.

See [vercel-ci-workarounds.md](./vercel-ci-workarounds.md) for full technical
details on why this is necessary and how it works.

## Branching and Deployment Workflow

### 1. Feature Branches

All development work is done on feature branches cut from `dev`. Open a Pull
Request targeting `dev` when the work is ready for review.

### 2. Development Branch (`dev`)

- All PRs are merged into `dev`.
- On every push to `dev`, the **"Sync dev → deploy-dev"** GitHub Action runs
  automatically, rewriting the commit author and pushing to `deploy-dev`.
- **No manual deployment steps are required after merging a PR.**

### 3. Deployment Branch (`deploy-dev`) — managed automatically

- Watched by Vercel and deployed to `dev.creatorshare.com`.
- **Never commit to this branch directly.** It is managed exclusively by the
  GitHub Action (`.github/workflows/sync-deploy-dev.yml`). Manual commits will
  be overwritten on the next `dev` push.

### 4. Staging Branch (`staging`)

- Merges from `dev` to `staging` are done via Pull Requests created and merged
  by the CreatorShare GitHub account.
- Triggers deployment to `staging.creatorshare.com`.
- Uses the production database and Stripe configuration — treat as
  pre-production.

### 5. Production Branch (`main`)

- Merges from `staging` to `main` are done via Pull Requests by the
  CreatorShare GitHub account.
- Triggers deployment to `creatorshare.com`.

## Summary

| Branch | How it gets updated | Deployed to |
|---|---|---|
| `dev` | PR merges from contributors | — |
| `deploy-dev` | GitHub Action (automatic on `dev` push) | `dev.creatorshare.com` |
| `staging` | PR by CreatorShare account | `staging.creatorshare.com` |
| `main` | PR by CreatorShare account | `creatorshare.com` |

## Important Notes

- All merges to `staging` and `main` must be done through Pull Requests by the
  CreatorShare GitHub account to ensure Vercel recognises the commit author.
- `deploy-dev` is fully automated — do not touch it manually.
- If `dev.creatorshare.com` is not updating after a merge, see the
  [Troubleshooting section in vercel-ci-workarounds.md](./vercel-ci-workarounds.md#troubleshooting).
