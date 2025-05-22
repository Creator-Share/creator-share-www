# Branching and Deployment Process

## Overview

We use a structured branching and deployment workflow to ensure consistent and reliable deployments across environments. This includes dedicated branches for development, staging, and production, with automated processes to maintain commit metadata integrity required by our deployment platform.

A deployment-specific branch is maintained to facilitate automated deployments to the development environment. This branch is updated automatically to ensure all deploy-triggering commits meet the necessary commit metadata standards.

This approach supports a clean, auditable, and automated continuous integration and delivery pipeline.

## Branching and Deployment Workflow

1. **Development Branch (`dev`)**  
   - All active development work must be done off and merged into the `dev` branch.  
   - Developers commit and push changes to `dev` or feature branches branched from `dev`.

2. **Deployment Branch (`deploy-dev`)**  
   - The `deploy-dev` branch is a special branch with commits merged from dev for deployment purposes.  
   - **Do not commit to or modify this branch manually.**  
   - Vercel deploys the `deploy-dev` branch to the development environment at `dev.creatorshare.com`.

3. **Staging Branch (`staging`)**  
   - Merges from `dev` to `staging` are done via GitHub Pull Requests created and merged by the Creatorshare GitHub account.  
   - This triggers deployments to the staging environment at `staging.creatorshare.com`.  
   - The staging environment uses the production database and Stripe configuration, serving as a pre-production testing ground.

4. **Production Branch (`main`)**  
   - Merges from `staging` to `main` are also done via GitHub Pull Requests by the Creatorshare GitHub account.  
   - This triggers deployments to the production environment at `creatorshare.com`.

## Important Notes

- All merges to `staging` and `main` must be done through GitHub Pull Requests by the Creatorshare GitHub user to ensure correct commit authorship.  
- The `deploy-dev` branch is managed exclusively by a CI/CD process and should never be manually modified.
- This workflow ensures compliance with deployment platform requirements while maintaining a clean and auditable deployment process.