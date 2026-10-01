# Manual Audit Checklist

These release items require explicit authorization, protected external evidence, physical hardware, or product judgment. Repository CI alone cannot complete them. Authorized API-driven checks can automate external verification; physical-device behavior and product decisions still need the owner or operator.

The repository classifies every test-shaped file. Required lanes run in CI. Optional provider canaries and imported harness support modules are inventoried separately and are not misrepresented as required tests.

The gate-by-gate traceability behind that claim is in `docs/advocate-mvp-completion-audit.md`, which names the asserting test file for every release gate and states plainly where the automated evidence stops.

## Current implementation blockers

Before release, resolve partial foreign-currency adjustment accounting (FF-072), dispute losses beyond the original principal (FF-084), private analytics disclosure across daily snapshots (FF-034), and durable payment failure monitoring and resolution (FF-085). The [review findings](./advocate-review-findings.md) and linked decision drafts describe the reproduced failures and pending owner choices. Provider canaries and a physical-device pass do not repair these implementation defects. No merge into `dev` is authorized.

***

## 1. Completed: Vercel project creation and activity evidence

Vercel CLI 56.5.0 now exposes the Activity Log through `vercel activity`. Vercel documents the Activity Log as available on all plans and includes `project-created` in its event catalog.

The isolated project was created on July 27, 2026 at 23:27:07 UTC. Its fixed identifiers are:

- Project: `creator-share-advocate-staging`
- Project ID: `prj_VUIMdQxm5ag0AvIOFtlEgRMtI21L`
- Team ID: `team_YVI1da4WtdrJDU5lPeTBABeS`
- Activity event ID: `uev_0fTM7969BgaYC8q7q4SbD7XE`

The initial inventory recorded zero deployments, zero environment variables, zero custom domains, no Git link, and no analytics configuration. Vercel created one intrinsic `creator-share-advocate-staging.vercel.app` project domain. It has no deployment behind it. Automatic custom-domain assignment is disabled, automatic system environment variables are enabled, the function region is `sfo1`, and the project uses Node 24, Next.js, `yarn build`, and `yarn install --frozen-lockfile`.

Sources: [Vercel Activity Log](https://vercel.com/docs/activity-log) and [Vercel CLI Activity Log announcement](https://vercel.com/changelog/activity-log-now-available-in-vercel-cli).

---

## 2. Blocking: current target state and capable callers

The owner confirmed that no Advocate migrations have been applied to staging or production. The current first-release procedure therefore has no legacy invitation cutover or virgin-exception requirement. Do not require complete provider history merely to satisfy that removed procedure.

Before any authorized database write, use the current staging runbook to verify the exact migration ledger, schema, and data baseline. If any Advocate migration or unexplained Advocate state already exists, stop and reconcile it instead of applying the revised first-release series.

Inventory callers that can still reach the target, including active deployments, callable older deployment URLs, current and recoverable environment bindings, workers, cron jobs, and external queues or hosts. Keep them paused or unable to authenticate during migration and controlled configuration. Repository absence of a hard-coded project ID does not prove absence of a configured caller. Record sanitized capability results and evidence references, never credential values.

[The earlier caller audit](./advocate-staging-caller-audit.md) remains historical evidence. Its observation that the staging project did not exist predates the creation recorded in section 1; it is not a current instruction to create another project. Reconfirm current project configuration before its first deployment.

---

## 3. Important: the inherited cron fleet

`vercel.json` declares 11 cron entries, 9 of them every minute, at the **repository** level. Any project deploying this repository to Production inherits all of them, so creating the staging project creates a scheduler fleet.

Two verified controls bound this, and both should be confirmed rather than assumed at creation time:

- Vercel crons fire only against Production deployments, not Preview.
- Every worker fails closed without a valid secret of at least 32 characters, compared with `timingSafeEqual`.

**Before the first deployment:** keep worker credentials absent or workers otherwise demonstrably paused until the current caller inventory and controlled configuration are accepted. Project creation alone does not execute the repository cron routes; deploying its Production configuration creates the operational risk.

---

## 4. Required for release: physical iOS smoke test

Automated WebKit coverage is browser-engine emulation with an iPhone profile. It is not Mobile Safari on physical iOS hardware, and the roadmap requires both.

**What to do on a current physical iPhone**, against the advocate portal catalog:

1. Back navigation with unsaved catalog changes.
2. Forward navigation with unsaved catalog changes.
3. Tab backgrounding and return.
4. Return after process eviction.
5. Confirm no sponsor, contact, or payment data appears in browser storage at any point.

The WebKit workflow selects `recovers version-bound drafts after mobile WebKit back and forward traversal` from `tests/advocates/portal-catalog-browser.spec.ts`. Its other navigation and dialog cases run in the Chromium lane. The selected WebKit case does not establish physical iOS navigation, warning-dialog, email-client, or process-eviction behavior.

Record what the physical device actually does, including whether a warning appears and whether draft recovery succeeds when it does not. Do not infer that behavior from Playwright's emulated device or from a generic browser-support claim.

---

## 5. Required for release: provider canaries

These need separately authorized provider access and protected evidence. The current required CI lanes do not supply that evidence:

- Hosted Supabase phone authentication disabled, including phone MFA enrollment and verification, before invitation delivery. Record the exact target and observed configuration in protected release evidence. The local phone-configuration tests do not establish hosted state; follow the payment runbook’s invitation canary.
- Stripe US and Stripe UK live-mode canaries, with one-time, monthly, and yearly terms where supported.
- PayPal canaries for one-time, monthly, and yearly terms.
- One payment-management canary each for Stripe US, Stripe UK, and PayPal.
- The hosted Supabase email-proof supersession canary across the complete matrix including expiry. The offline 99-test contract passes and is enforced in CI, but the runbook is explicit that it does not replace hosted evidence.

Record Stripe object IDs in a protected operator record, never in the repository or the pull request.

---

## 6. Your decision: branch protection on `dev`

`dev` currently has **no branch protection and no required-check ruleset**. Every gate built for this pull request runs, but nothing prevents a merge that ignores them.

I have deliberately not changed this, because mutating branch protection needs your explicit authorization.

**Suggested required checks**, using the exact workflow job names:

- `Publication authority database tests`
- `Catalog recovery in WebKit`

**Answer needed:** whether to enable branch protection and make those checks required.

---

## Scope of automated evidence

The earlier traceability sweep is historical. Its aggregate coverage verdicts do not establish current correctness. The current adjustment-accounting, dispute-loss, payment-recovery, and analytics-disclosure findings remain implementation blockers even though earlier suites were green. Use the revision-bound [review findings](./advocate-review-findings.md), the release manifest, and the exact hosted workflow results.

## Checks that belong in CI

These checks are automated. Their passing evidence must match the revision being released:

- Test-file classification, with required, optional, support, and overlay lanes represented explicitly.
- The complete pgTAP suite from a clean migration replay, plus required authority and cleanup concurrency harnesses.
- Browser checkout request and navigation parity across primary and advocate origins. The provider handoff is intercepted; this is not live provider execution.
- The offline email-proof provider contract in a network namespace without outbound access.
- Staging guards that reject production provider automation.

CI results do not replace the target-state inventory, provider canaries, physical-device observations, or owner decisions above.
