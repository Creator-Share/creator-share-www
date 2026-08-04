# Manual Audit Checklist

Everything on this list requires a human. Each item is here because it needs a credential, a console, a physical device, or a judgment call that cannot be automated or verified from the repository. Items are ordered so that the blocking ones come first.

The repository classifies every test-shaped file. Required lanes run in CI. Optional provider canaries and imported harness support modules are inventoried separately and are not misrepresented as required tests.

The gate-by-gate traceability behind that claim is in `docs/advocate-mvp-completion-audit.md`, which names the asserting test file for every release gate and states plainly where the automated evidence stops.

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

## 2. Blocking: historical caller capability for the staging Supabase project

**Why it is blocking.** The runbook requires proof of the complete lifetime of every deployment and scheduler capable of calling `destjwstohzmufshfnuy`. If provider retention does not cover a capable caller's complete lifetime, the runbook states the virgin exception is unavailable.

**What was established automatically.** See `docs/advocate-staging-caller-audit.md`. No application source hard-codes the staging project, there are no Supabase Edge Functions, no database cron jobs, and no scheduled GitHub workflows. Capability therefore comes from configured environment only.

**What only you can check, in the Vercel dashboard:**

1. For `creator-share-www`, inspect **Production, Preview, and Development** environment variables and confirm whether any has ever pointed at `destjwstohzmufshfnuy`. Inspect values only inside the approved secret store; record a yes or no plus an evidence reference, never the value.
2. Retrieve the historical cron invocation record for `creator-share-www` and confirm whether any invocation could have reached the staging project.
3. Confirm whether Vercel's retention covers the complete lifetime of every capable deployment, including deleted ones and direct generated URLs.
4. Confirm no externally operated scheduler, queue consumer, or persistent host outside this repository and this Vercel team holds staging credentials.

**Answer needed:** a yes or no on capability for each, with an evidence reference.

---

## 3. Important: the inherited cron fleet

`vercel.json` declares 11 cron entries, 9 of them every minute, at the **repository** level. Any project deploying this repository to Production inherits all of them, so creating the staging project creates a scheduler fleet.

Two verified controls bound this, and both should be confirmed rather than assumed at creation time:

- Vercel crons fire only against Production deployments, not Preview.
- Every worker fails closed without a valid secret of at least 32 characters, compared with `timingSafeEqual`.

**What to do when the project is created:** leave `CRON_SECRET` and the staging Supabase credentials unset until the caller audit is accepted, so the inherited crons are inert by construction rather than by intention.

---

## 4. Required for release: physical iOS smoke test

Automated WebKit coverage is browser-engine emulation with an iPhone profile. It is not Mobile Safari on physical iOS hardware, and the roadmap requires both.

**What to do on a current physical iPhone**, against the advocate portal catalog:

1. Back navigation with unsaved catalog changes.
2. Forward navigation with unsaved catalog changes.
3. Tab backgrounding and return.
4. Return after process eviction.
5. Confirm no sponsor, contact, or payment data appears in browser storage at any point.

Note the exact shape of the automated coverage, because it is narrower than it first appears. `tests/advocates/portal-catalog-browser.spec.ts` holds 15 tests, and exactly one of them runs under WebKit: `recovers version-bound drafts after mobile WebKit back and forward traversal`. The other 14, including every `beforeunload` and history-confirm guard, run in Chromium only. Playwright's WebKit never emits native `beforeunload` or history `confirm` dialogs, and real Mobile Safari does present them.

**This manual pass is therefore the only evidence covering the unsaved-change guard on the target engine.** It is not optional.

(This corrects an earlier note here that said four tests were skipped in WebKit. That described the lane before the FF-049 revert; one test runs in WebKit today.)

---

## 5. Required for release: provider canaries

These need live provider credentials and cannot run in CI:

- Stripe US and Stripe UK live-mode canaries, with one-time, monthly, and yearly terms where supported.
- PayPal canaries for one-time, monthly, and yearly terms.
- One payment-management canary each for Stripe US, Stripe UK, and PayPal.
- The hosted Supabase email-proof supersession canary across the complete matrix including expiry. The offline 99-test contract passes and is enforced in CI, but the runbook is explicit that it does not replace hosted evidence.

Record Stripe object IDs in a protected operator record, never in the repository or the pull request.

---

## 6. Your decision: branch protection on `dev`

`dev` currently has **no branch protection and no required-check ruleset**. Every gate built for this pull request runs, but nothing prevents a merge that ignores them.

I have deliberately not changed this, because mutating branch protection needs your explicit authorization.

**Suggested required checks**, matching what is now green:

- `Publication authority database tests`
- `Catalog recovery in WebKit`

**Answer needed:** whether to enable branch protection and make those checks required.

---

## 7. Your decision: overnight autonomy

If you want work to continue while you are away, two things need to be set up, because neither is automatic:

- A **cloud schedule**, since a session loop stops when this session closes.
- A **permission allowlist** for the commands the work actually needs. Two commands were denied by the permission classifier during this work, `git checkout --` and `git show`, each of which would stall an unattended run until you returned.

---

## A note on the release-gate traceability sweep

A parallel sweep classified the roadmap release gates as 14 automated, 32 partial, 12 hosted-only, and 5 uncovered. Treat the partial count as conservative rather than as a work queue.

Five of the five originally uncovered gates have now been addressed, and spot checks of the partial ones keep finding them substantially covered already:

- Retention cleanup jobs: the hourly `17 * * * *` schedule is asserted against `vercel.json`, and `sponsor_authentication` is a first-class retention step with failure-path assertions.
- Webhook idempotency: duplicate replay returning the exact durable result is asserted for both providers.
- Visitor secret separation: the generic pairwise check was already asserted; only the payment-key instances were added.

Two of the sweep's specific claims were wrong on inspection. The legacy invitation branch it flagged as an escalation risk is an intentional compatibility path documented by FF-042 that still requires a fresh `otp` session, and its real defect was missing coverage rather than missing enforcement. A claimed PayPal weakness turned out to be my test being wrong and the implementation being stricter than assumed.

**A follow-up adjudication has now settled this.** The sixteen highest-value partial gates were each re-examined against source, with instructions to name the exact missing assertion if one existed. All sixteen came back covered, with specific files, line numbers, and quoted assertion text rather than inference from file names. The gates adjudicated were: two-response invitation redemption and its exact proof type, `verifyOtp` consuming that type, single-use under concurrency, explicit continuation before redemption, no session on page load or scanner fetch, magic links across cookie jars, no token leak into URLs or referrers or storage or analytics or history or logs, account creation limited to a validated claim or bounded registration, cancellation and payment-method management requiring an unexpired receipt bound to a live session, passwordless limiter partitioning with a separate verification limiter, webhook idempotency and authority, RLS and least-privilege grants on exposed tables, advocate roles being unable to read sponsor contact or raw tracking data, audit redaction and append-only protections, and browser lifecycle forensics privacy and 90 day removal.

Because a clean sixteen out of sixteen invites suspicion, one verdict was independently re-checked by hand: the passwordless partitioning claim cites `supabase/tests/sponsor_passwordless_email_delivery_limits.test.sql` asserting that exhausting the public recipient pool still preserves capacity for a validated initial claim. Those assertions exist verbatim at the cited lines. The evidence is real.

**Conclusion: the partial count was a classification artefact, not a backlog.** The residual work in these gates is hosted verification, which belongs on the manual list above rather than in CI.

## Explicitly not on this list

The following are automated and enforced, and need no manual verification:

- Every test-shaped file is classified, with required, optional, support, and overlay lanes represented honestly.
- The complete pgTAP suite, 63 files and 2,131 tests, from a clean reset.
- Checkout parity across Stripe and PayPal on both a primary origin and an advocate subdomain, in a real browser.
- The 99-test offline provider contract, executed inside a network namespace with no outbound interface.
- Provider automation cannot be set to `active` in staging: it throws, and that is test-locked.
