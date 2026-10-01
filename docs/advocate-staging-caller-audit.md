# Advocate Staging Caller Audit

Historical pre-creation checkpoint. The project was subsequently created, as recorded in [the manual audit](./advocate-staging-manual-audit.md). Provider observations here have not been refreshed during the current review. Use the current staging release runbook and manual checklist for execution; do not treat this file as current provider inventory.

Read-only inventory of everything with the capability to call the isolated staging Supabase project `destjwstohzmufshfnuy`, produced for the Pre-Step of `docs/advocate-staging-release-runbook.md`.

This audit created no hosted resource. Every observation below is either repository evidence or a read-only provider query.

## Scope confirmed

- Vercel scope: `CreatorShare Org`, team `team_YVI1da4WtdrJDU5lPeTBABeS`.
- Projects in that scope: `creator-share-www` only. `creator-share-advocate-staging` does not exist, which satisfies the runbook's "stop if the project already exists" condition.
- Supabase Edge Functions: none in the repository.
- Database cron jobs: no `pg_cron` or `cron.schedule` usage in any migration.
- GitHub Actions schedules: none. Both workflows are `pull_request` plus `workflow_dispatch` only, so neither fires on a timer.

## The dominant finding: repository-level cron inheritance

`vercel.json` declares **11 cron entries, 9 of which run every minute**. Crons are declared at the repository level, not per project, so **any** Vercel project that deploys this repository to Production inherits all 11. Creating the staging project therefore creates a scheduler fleet, not an inert container.

| Schedule     | Path                                                    |
| ------------ | ------------------------------------------------------- |
| `* * * * *`  | `/api/internal/advocates/provisioning`                  |
| `* * * * *`  | `/api/internal/advocates/publication-canaries`          |
| `* * * * *`  | `/api/internal/advocates/publication-sentinel`          |
| `* * * * *`  | `/api/internal/advocates/logo-reconciliation`           |
| `* * * * *`  | `/api/internal/advocates/invitations`                   |
| `* * * * *`  | `/api/internal/advocates/lifecycle-cleanup`             |
| `* * * * *`  | `/api/internal/payments/gateway-events`                 |
| `* * * * *`  | `/api/internal/sponsorships/welcome-emails`             |
| `* * * * *`  | `/api/internal/sponsorships/subscription-cancellations` |
| `13 1 * * *` | `/api/internal/advocates/public-metrics`                |
| `17 * * * *` | `/api/internal/retention`                               |

Two facts bound the risk, and both are verified rather than assumed.

**Vercel crons fire only against the Production deployment.** Preview deployments do not run them. This matters because the existing `creator-share-www` project currently holds a rolling set of Preview deployments produced by this pull request itself — nine within the last four hours at the time of audit. Those previews are not schedulers.

**Every worker fails closed without its secret.** `src/lib/advocates/lifecycleCleanup/auth.ts` and its siblings require a dedicated worker secret or `CRON_SECRET`, demand at least 32 characters with no control characters or surrounding whitespace, and compare with `timingSafeEqual`. A missing or malformed secret throws `... worker is unavailable` before any work occurs. A freshly created project with no secret configured therefore has crons that cannot act, even though they are scheduled.

## Provider automation cannot be enabled in staging

`src/lib/advocates/providerAutomation.ts` defaults `ADVOCATE_PROVIDER_AUTOMATION_MODE` to `disabled` when unset, and **throws `ProviderAutomationConfigurationError` if the staging environment is enabled while the mode is `active`**. Staging cannot be configured into provider automation even by mistake. This is asserted in `tests/advocates/provider-automation.spec.ts`, which is in the required offline lane.

This is the strongest single control protecting the staging release, because it makes the runbook's "Provider automation mode: disabled" a fail-closed code property rather than a configuration convention.

## Capability matches for the staging Supabase project

Repository references to `destjwstohzmufshfnuy` appear only in tests:

- `tests/auth/supabase-email-proof-issuer.spec.ts`
- `tests/provider/supabase-email-proof-supersession-hosted.spec.ts`

Both are provider-free. The hosted supersession suite is pinned so that it refuses any origin other than the exact staging HTTPS origin, and the complete 99-test contract runs in CI inside a network namespace with no outbound interface. No application source file hard-codes the staging project.

Capability therefore comes from configured environment, not from committed code. The remaining question for each caller is whether its environment ever contained credentials for `destjwstohzmufshfnuy`.

## Current interpretation

This historical inventory cannot establish current deployment credentials, remaining callable deployment URLs, external workers, or target schema state. Recheck those facts before the first authorized migration or deployment. Keep capable callers paused and provider automation disabled throughout the controlled release sequence.

The original audit required complete lifetime evidence to qualify for an undeployed invitation cutover exception. That procedure was removed after the owner confirmed no Advocate migrations had been applied. Its historical log-retention requirement is no longer a prerequisite for this first release. The current runbook instead requires exact target migration membership, schema and data postconditions, and a current capable-caller inventory. Unexpected preexisting Advocate state invalidates that release path and requires reconciliation.

The staging project creation is already recorded in the manual checklist. Do not create a second project based on this earlier audit. No provider state was changed to update this interpretation.
