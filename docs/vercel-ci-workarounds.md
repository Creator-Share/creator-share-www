# Vercel CI Workarounds: Handling Git Commit Author Restrictions

## Background and Motivation

Vercel has recently updated its deployment policy to enforce strict validation of the Git commit author for branches that trigger deployments. Specifically, Vercel requires that the commit author of any pushed commit must be a recognized user with access to the Vercel project (typically the Vercel owner or team members). This means that commits authored by unknown or unauthorized users will cause deployment failures.

Previously, it was possible to push code from any user and then trigger a deployment via a deploy hook. However, with the new policy, deployments will fail unless the commit author matches the Vercel user.

Our development workflow involves multiple branches:

- Development work is done on the `dev` branch or feature branches.
- Pull requests are used to merge from `dev` to `staging` or `main`.
- We want continuous integration (CI) based deployments triggered by commits to the `dev` branch.

## Problem

Since developers may commit with different Git user configurations, the commit author on the `dev` branch may not match the Vercel user authorized to deploy. This causes Vercel to reject deployments triggered by these commits.

## Solution: Author Rewriting Script

To comply with Vercel's policy while maintaining our workflow, we created a script that:

1. Monitors the `dev` branch for new commits.
2. Creates or updates a dedicated deployment branch (e.g., `deploy-dev`).
3. Copies the latest commits from `dev` to `deploy-dev`.
4. Rewrites the author and committer information of the latest commit on `deploy-dev` to match the Vercel owner's identity.
5. Pushes the updated `deploy-dev` branch to the remote repository, triggering a Vercel deployment with the correct author.

This approach ensures that all commits on the deployment branch have the correct author identity, satisfying Vercel's requirements and enabling successful CI deployments.

## How the Script Works

- The script runs in a loop, periodically fetching the latest changes from the remote repository.
- It compares the commit history of the `dev` branch and the deployment branch.
- If new commits are detected on `dev`, it checks if the latest commit on the deployment branch already has the correct author.
- If not, it creates a temporary branch from `dev`, amends the latest commit to rewrite the author information, resets the deployment branch to this temporary branch, and force pushes the changes.
- The script includes safeguards to avoid rewriting commits unnecessarily and cleans up temporary branches after use.

## Benefits

- Maintains a clean and consistent commit history on the deployment branch.
- Complies with Vercel's strict commit author policy.
- Automates deployment branch updates without manual intervention.
- Avoids deployment failures due to unauthorized commit authors.

## Usage

The script is located at `scripts/rewrite_authors.sh`. It can be run as a background service or integrated into CI pipelines.

Ensure the deployment branch (e.g., `deploy-dev`) exists on the remote repository before running the script.

## Future Improvements

- Add detailed logging and error handling.
- Support configurable branch names and author information via command-line arguments.
- Implement dry-run mode for testing.
- Replace `git filter-branch` with more efficient tools if needed.

---

This document and the accompanying script provide a practical workaround for Vercel's commit author restrictions, enabling smooth CI deployments in our multi-branch development workflow.