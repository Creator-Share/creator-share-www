# Branching and Deployment Process

## Overview

Due to Vercel's strict commit author policy, deployments will fail if the commit author is not recognized as a valid user with access to the Vercel project. To comply with this, we have established a deployment and branch workflow that ensures all deploy-triggering commits have the correct author identity.

## Branching and Deployment Workflow

1. **Development Branch (`dev`)**  
   - All active development work must be done off and merged into the `dev` branch.  
   - Developers commit and push changes to `dev` or feature branches branched from `dev`.

2. **Deployment Branch (`deploy-dev`)**  
   - The `deploy-dev` branch is a special branch that mirrors `dev` with rewritten commit authorship to match the Vercel deployment user.  
   - **Do not commit to or modify this branch manually.**  
   - A script automatically rewrites commits from `dev` and pushes them to `deploy-dev`.  
   - Vercel deploys the `deploy-dev` branch to the development environment at `dev.creatorshare.com`.

3. **Staging Branch (`staging`)**  
   - Merges from `dev` to `staging` are done via GitHub Pull Requests created and merged by the Creatorshare GitHub account (never via command line).  
   - This triggers deployments to the staging environment at `staging.creatorshare.com`.  
   - The staging environment uses the production database and Stripe configuration, serving as a pre-production testing ground.

4. **Production Branch (`main`)**  
   - Merges from `staging` to `main` are also done via GitHub Pull Requests by the Creatorshare GitHub account.  
   - This triggers deployments to the production environment at `creatorshare.com` (pending DNS updates).

## Important Notes

- The `deploy-dev` branch is managed exclusively by the author rewriting script and should never be manually touched.  
- All merges to `staging` and `main` must be done through GitHub Pull Requests by the Creatorshare GitHub user to ensure correct commit authorship.  
- This workflow ensures compliance with Vercel's commit author restrictions while maintaining a clean and auditable deployment process.