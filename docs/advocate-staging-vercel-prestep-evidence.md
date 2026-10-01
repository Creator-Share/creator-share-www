# Advocate Staging Vercel Pre-Step Evidence

Recorded July 27, 2026 for the first isolated Advocate staging release.

## Fixed identity

| Field | Value |
| --- | --- |
| Team | CreatorShare Org |
| Team ID | `team_YVI1da4WtdrJDU5lPeTBABeS` |
| Project | `creator-share-advocate-staging` |
| Project ID | `prj_VUIMdQxm5ag0AvIOFtlEgRMtI21L` |
| Created at | `2026-07-27T23:27:07.001Z` |
| Activity event | `uev_0fTM7969BgaYC8q7q4SbD7XE` |
| Creation actor channel | Vercel CLI |

The Activity Log returned one exact `project-created` event for this project. The event payload project name and project ID matched the project inspection result.

## Initial inventory

| Surface | Initial result |
| --- | --- |
| Deployments | 0 |
| Environment variables | 0 |
| Custom domains | 0 |
| Git link | none |
| Analytics configuration | none |
| Project targets | empty |
| Intrinsic project domain | `creator-share-advocate-staging.vercel.app` |

Vercel creates the intrinsic project domain with the project. It has no deployment behind it. It is recorded separately from custom domains.

## Configured controls

| Control | Value |
| --- | --- |
| Framework | Next.js |
| Node.js | 24.x |
| Build command | `yarn build` |
| Install command | `yarn install --frozen-lockfile` |
| Function region | `sfo1` |
| Automatic custom-domain assignment | disabled |
| Automatic Vercel system environment variables | enabled |
| Git deployments | disconnected because no Git link exists |

No deployment, custom hostname, application environment variable, provider credential, or Supabase credential was created during this pre-step.
