# Advocate Staging Release Runbook

This runbook controls the first staged release of the Advocate Platform into Supabase project `destjwstohzmufshfnuy` and the dedicated Vercel project `creator-share-advocate-staging`. Apply the complete reviewed migration series from one pinned release commit. The owner confirmed on September 17, 2026 that no Advocate migrations have been applied to staging or production; historical intermediate release checkpoints are superseded.

This document is intentionally narrower than the two permanent Advocate release runbooks:

- Use [Advocate Payment Release Runbook](./advocate-payment-release-runbook.md) for payment caller cutover, worker behavior, checkout canaries, retention, and the complete payment release evidence.
- Use [Advocate Domain Publication Runbook](./advocate-domain-publication-runbook.md) for invitation delivery semantics, provider activation, publication canaries, exact host publication, and post-publication verification.

The steps below do not authorize live provider automation or public advocate publication. They establish an isolated staging database and deployment boundary from which those runbooks can be executed.

## Fixed release scope

| Surface                    | Required value                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Supabase project reference | `destjwstohzmufshfnuy`                                                                              |
| Vercel project             | `creator-share-advocate-staging`                                                                    |
| Logical environment        | Staging                                                                                             |
| Vercel environment used    | Production, isolated inside the dedicated staging project                                           |
| Primary staging hostname   | `advocate-staging.creatorshare.com`                                                                 |
| Canary hostname            | `canary.advocate-staging.creatorshare.com`                                                          |
| Provider automation        | `ADVOCATE_PROVIDER_AUTOMATION_MODE=disabled`                                                        |
| Source branch              | `feature/advocate-platform`                                                                         |
| Database source boundary   | The pinned, validated PR release commit |

Never link the Advocate worktree to the existing `creator-share-www` Vercel project. Never attach a wildcard, a `www` alias, a branch alias, or an automatic production domain. Vercel Production is used here only because custom domains and scheduled functions bind to that environment. The dedicated project remains Creator Share staging.

## Migration source evidence

Pin the release commit after its required hosted application and database checks pass. Record the exact sorted migration filenames and a source digest before any hosted write. Compute the digest using the concurrency harness framing: UTF-8 filename, zero byte, exact file bytes, zero byte for every sorted SQL migration. The historical checkpoint digests no longer describe this consolidated series.

The current series contains the 35 existing migrations plus 68 Advocate migrations, ending at `20260720102000`. The expected target baseline remains 35 applied migrations ending at `20260604000000`. Verify exact membership, not just counts. If any Advocate migration or its invitation outbox already exists on the target, stop: this first-release procedure cannot reconcile a previously applied version of the rewritten schema.

## Release ledger

Maintain one private, append-only release ledger. Record no access token, database password, service key, SMTP credential, bearer value, email address, invitation identifier, or provider payload. Each checkpoint entry must contain:

1. UTC start and completion timestamps.
2. Operator identity and change reference.
3. Supabase project reference and Vercel team and project identifiers.
4. Exact Git commit, clean-checkout result, migration boundary, full-set digest, and release-slice digest.
5. The Supabase migration ledger count, maximum version, and ledger digest.
6. The dry-run migration count before the write and zero-pending result after the write.
7. Aggregate preflight counts from this runbook.
8. Vercel deployment ID and source revision when a deployment exists.
9. The fixed result category of each worker, release preflight, and canary request.
10. Any stop, rollback, quarantine, or exception decision with its evidence reference.

The existing protected backup and restore evidence is:

`/Users/aubreyfalconer/.codex/backups/creator-share/20260724T004005Z-destjwstohzmufshfnuy`

This path is evidence that a pre-release backup and restore proof exists. It is not permission to overwrite the live project after external authentication or email state has changed. Do not copy backup contents into the repository or a pull request.

## Universal stop conditions

Stop before the next write if any of these conditions occurs:

- The CLI is linked to any project other than `destjwstohzmufshfnuy`.
- The Vercel scope or project is not the exact dedicated staging project.
- The checkout is dirty, the commit differs from the checkpoint, or a source digest differs.
- Migration dry-run output contains any version outside the reviewed release slice.
- The remote migration ledger differs from the expected count or boundary.
- Any preflight count expected to be zero is nonzero.
- A prior worker invocation might still be running.
- A pre-handoff invitation row has an unexpired five-minute lease.
- Any invitation delivery has begun and provider acceptance is unknown.
- Hosted OTP expiry evidence is absent, older than the release evidence window, or outside 1 through 3,600 seconds.
- A migration or postcondition returns an error, times out, or reports an unexpected count.
- A domain, deployment, invocation, cron schedule, or tenant state appears that is not in the release ledger.
- A migration tranche stops after only part of its intended ledger range has committed.
- Any deployment or scheduler capable of reaching `destjwstohzmufshfnuy` is missing from the historical caller census.

Never repair migration history to make a mismatch disappear. Never restore the retired invitation claim signature. Never continue by deploying a partially compatible application.

Before creating or inspecting any hosted resource, run the complete offline
email-proof provider contract:

```sh
yarn test:provider:supabase-email-proof-contract
```

The gate must report exactly 99 passing tests with one worker and no retry. The
pull request workflow runs the same command inside a Linux network namespace
with no network interface. This proves the hosted runner, Ethereal adapter, and
shared evidence contract without calling Supabase, Ethereal, Vercel, or any
other provider. A passing offline gate does not replace the separately
authorized hosted canary.

### Vercel CLI operating constraints

These were established by direct observation and cost a wasted cycle each. Follow them before any Vercel step.

1. Use the Vercel CLI on **Node 24**. Under Node 26.4.0 every API request fails with `TypeError: fetch failed`, including telemetry, even though a plain `fetch` to `https://api.vercel.com` from the same Node build succeeds and even when a token is supplied. This is not a credential problem, so it does not indicate a lost keyring session. CLI 56.5.0 on Node 24.18.0 authenticates normally.
2. Older CLI versions on this machine cannot see the credentials at all. Vercel CLI 39.2.0 and 50.9.6 report `No existing credentials found` because they predate native keyring storage. Do not interpret that as a logged-out session and do not start a new login flow.
3. **Never use `vercel curl` to probe the API.** It is not a general API client. With an absolute URL it sends no authentication, so an unauthenticated `not_found` or `forbidden` can be mistaken for a plan limitation. With a relative path it resolves against the _linked project's deployment_, and it will link the current directory and create a Vercel project named after that directory as a side effect. An empty project created this way was observed and removed. Prefer explicit read-only subcommands such as `vercel projects ls` and `vercel teams ls`.
4. Confirm the scope is `CreatorShare Org` before every write, and never link a worktree to the existing `creator-share-www` project.

### Resolved: project-creation activity evidence

Vercel CLI 56.5.0 provides `vercel activity`. Vercel documents the Activity Log as available on all plans and lists `project-created` as a supported event. This is distinct from the Enterprise Audit Log export.

The isolated project was created on July 27, 2026 at 23:27:07 UTC. Project ID `prj_VUIMdQxm5ag0AvIOFtlEgRMtI21L`, team ID `team_YVI1da4WtdrJDU5lPeTBABeS`, and activity event ID `uev_0fTM7969BgaYC8q7q4SbD7XE` identify the creation evidence. The initial inventory recorded zero deployments, zero environment variables, zero custom domains, no Git link, and no analytics configuration. Vercel also created the intrinsic `creator-share-advocate-staging.vercel.app` project domain. It has no deployment behind it and is not a custom production hostname.

## Pre-Step: verify the isolated project and its callers

Inventory the dedicated `creator-share-advocate-staging` project in the exact Creator Share team. The historical project-creation evidence above is a starting point, not proof of current state. Record its deployments, domains, environment configuration, invocations, and schedules. Do not create a duplicate project. Keep Git deployment and automatic domain assignment disabled during preparation.

Inspect every deployment, generated URL, domain, cron, scheduler, and persistent worker that can reach `destjwstohzmufshfnuy`. Pause capable callers before changing their database contract and verify that in-flight work has ended. Missing or truncated telemetry is an unresolved release issue. This protects existing primary-site data and external provider work; it is not a migration from an earlier Advocate outbox.

Keep the exact staging hosts detached until schema and deployment checks pass. Use only isolated staging credentials, authentic Vercel deployment and revision variables, and `ADVOCATE_PROVIDER_AUTOMATION_MODE=disabled`.

## Controlled migration application

Use the reviewed Supabase CLI binary already installed in the Advocate worktree. Do not invoke a package runner from a detached historical worktree because it can download a different CLI version. Verify the exact binary before every checkpoint:

```sh
SUPABASE_CLI=/Users/aubreyfalconer/dev/creator-share/creator-share-www-advocate-platform/node_modules/.bin/supabase
test "$("$SUPABASE_CLI" --version | head -n 1)" = "2.90.0"
test "$(shasum -a 256 "$SUPABASE_CLI" | awk '{print $1}')" = "2193788e0b8a20959aba99a154d24d430a6f62594aaa0a78c2c090155e58a933"
```

Stop if either assertion fails. Record the CLI version and SHA256 in the private release ledger. Any intentional CLI upgrade requires a separate review and new checksum.

Use a separate detached worktree for the release so the CLI cannot see later migrations. Choose a new local directory for the release and substitute the exact commit from the release ledger:

```sh
git worktree add --detach "$CHECKPOINT_DIRECTORY" "$CHECKPOINT_COMMIT"
git -C "$CHECKPOINT_DIRECTORY" status --porcelain=v1
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" link --project-ref destjwstohzmufshfnuy
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" migration list --linked
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" db push --linked --dry-run
```

The status output must be empty. Compare the linked migration list and dry-run output to the reviewed release slice before approving the write. Apply the tranche and immediately repeat the read-only checks:

```sh
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" db push --linked
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" migration list --linked
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" db push --linked --dry-run
```

The final dry-run must report no pending migration in that checkpoint worktree. Do not use `migration repair`, `db reset`, seed application, or an unreviewed CLI upgrade. Remove a detached checkpoint worktree only after its source digest, dry-run output, database ledger result, and aggregate SQL result are preserved in the private release ledger.

Supabase CLI 2.90.0 has no reviewed per-push flag for PostgreSQL lock, statement, or idle transaction timeouts. Do not invent one. Use PostgreSQL's role-in-database settings as the supported boundary:

1. In a protected administrator session, capture the exact existing `pg_db_role_setting.setconfig` value for role `postgres` in database `postgres`.
2. Set `lock_timeout` to `5s`, `statement_timeout` to `15min`, and `idle_in_transaction_session_timeout` to `60s` with `ALTER ROLE postgres IN DATABASE postgres SET`.
3. Open a new protected database session and require all three `SHOW` values to match before starting the CLI process. The CLI process must start only after that verification so its new database session inherits the settings.
4. Run one intended checkpoint push.
5. Restore the exact prior role-in-database settings immediately after the CLI exits, whether it succeeds or fails. If a setting was previously absent, reset that setting. If it had a prior value, restore that value.
6. Open another new session and verify the restoration.

The installation statements are:

```sql
ALTER ROLE postgres IN DATABASE postgres SET lock_timeout = '5s';
ALTER ROLE postgres IN DATABASE postgres SET statement_timeout = '15min';
ALTER ROLE postgres IN DATABASE postgres
  SET idle_in_transaction_session_timeout = '60s';
```

Inspect the previous role-in-database array before changing it:

```sql
SELECT setting.setconfig
FROM pg_catalog.pg_db_role_setting setting
WHERE setting.setrole = 'postgres'::regrole
  AND setting.setdatabase = 'postgres'::regdatabase;
```

Restoration must use either `ALTER ROLE postgres IN DATABASE postgres RESET <setting>` for a previously absent setting or `ALTER ROLE postgres IN DATABASE postgres SET <setting> = '<prior-value>'` for a previously present setting. Never substitute a guessed default for captured prior state.

Do not leave a timeout override installed between checkpoints. A migration that explicitly establishes a narrower transaction-local timeout keeps that narrower boundary.

### Partial migration stop states

Each migration commits independently. If application stops partway through the 68 pending migrations, preserve the exact ledger, failing version, source digest, CLI result, and relevant postconditions. Keep callers paused and deploy no application against an incomplete schema.

Never repair migration history, replay an applied file, or restore a database across external email or payment work. Retry an unapplied file only after proving its transaction rolled back, correcting the environmental cause, and reviewing the exact forward recovery. Once a migration is applied to staging or production, its bytes become immutable.

## Step 0: verify the baseline

Before applying any new migration, record the current migration ledger with the ledger query below. The expected baseline is 35 rows with maximum version `20260604000000`.

Run this relation inventory before the foundation tranche:

```sql
SELECT
  namespace.nspname AS schema_name,
  relation.relname AS relation_name,
  relation.relkind AS relation_kind
FROM pg_catalog.pg_class relation
JOIN pg_catalog.pg_namespace namespace
  ON namespace.oid = relation.relnamespace
WHERE relation.relkind IN ('r', 'p')
  AND (
    relation.relname = 'advocate'
    OR relation.relname LIKE 'advocate_%'
  )
  AND namespace.nspname IN ('public', 'private', 'audit')
ORDER BY namespace.nspname, relation.relname;

SELECT
  (SELECT count(*) FROM public.advocate) AS legacy_advocate_rows,
  (
    SELECT count(*)
    FROM public.role_assignments
    WHERE advocate_id IS NOT NULL
  ) AS advocate_role_assignment_rows;
```

For the audited 35-migration baseline, the only mutable Advocate relation is `public.advocate`. Both counts must be zero. An unexpected Advocate relation or nonzero count requires a reviewed data migration plan before proceeding.

### Existing-data mutation inventory

The foundation tranche intentionally performs two irreversible reconciliations on existing primary-site data. It deletes exact duplicate `public.role_assignments` rows after preserving the earliest row, and it changes every open sponsorship beneficiary with `budget_goal = -1` from an invalid fulfilled state to either `Partially Funded` or `New` while clearing `goal_fulfilled_at`.

Capture the prestate count and protected identifier-set digest before the foundation push:

```sql
WITH ranked_assignments AS (
  SELECT
    assignment.id,
    row_number() OVER (
      PARTITION BY
        assignment.user_id,
        assignment.role_id,
        assignment.organization_id,
        assignment.advocate_id
      ORDER BY assignment.created_at, assignment.id
    ) AS duplicate_rank
  FROM public.role_assignments assignment
),
duplicate_assignments AS (
  SELECT id
  FROM ranked_assignments
  WHERE duplicate_rank > 1
),
open_beneficiaries_requiring_repair AS (
  SELECT beneficiary.id
  FROM public.beneficiaries beneficiary
  WHERE beneficiary.budget_goal = -1
    AND (
      beneficiary.status = 'Budget Fulfilled'
      OR beneficiary.goal_fulfilled_at IS NOT NULL
    )
)
SELECT
  (SELECT count(*) FROM duplicate_assignments)
    AS duplicate_role_assignments_to_delete,
  encode(
    extensions.digest(
      convert_to(
        coalesce(
          (
            SELECT jsonb_agg(id ORDER BY id)::text
            FROM duplicate_assignments
          ),
          '[]'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) AS duplicate_role_assignment_id_set_sha256,
  (SELECT count(*) FROM open_beneficiaries_requiring_repair)
    AS open_beneficiaries_to_repair,
  encode(
    extensions.digest(
      convert_to(
        coalesce(
          (
            SELECT jsonb_agg(id ORDER BY id)::text
            FROM open_beneficiaries_requiring_repair
          ),
          '[]'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) AS open_beneficiary_id_set_sha256;
```

Store only these aggregate counts and digests in protected release evidence. After the foundation tranche, rerun the query. Both counts must be zero. Retain the before and after results together. A nonzero poststate means the tranche is incomplete or an invariant changed, and release work stops.

## Step 1: apply the complete reviewed series

Complete the baseline inventory, existing-data mutation inventory, caller pause, and source evidence above. Use the pinned release worktree for both dry-run and application. The pending set must contain exactly 68 versions from `20260716133000` through `20260720102000`, with no previously applied Advocate version. Apply the series using the controlled migration procedure above.

Require 103 ledger entries with exact expected membership, maximum version `20260720102000`, and a zero-pending dry-run. Recheck the role-assignment and beneficiary repair postconditions. Keep provider automation and invitation delivery disabled.

Run the complete pgTAP suite and all remaining required concurrency harnesses against the resulting schema. The invitation settlement suite must prove that current shared-issuer claims work immediately without a historical cutover receipt, while preserving receipt immutability and service-only access. No legacy claim signature, arm transaction, drain timer, or legacy proof quarantine is part of the first release.

Before any authorized canary, verify that the new tenant, invitation, delivery, publication, and proof-issuance tables contain no unexplained rows. Record only aggregate counts. After a canary, account for its immutable receipts separately from removable fixtures. Continue with the exact staging deployment and provider gates below.

## Migration ledger query

Run this query before the first write and after each tranche:

```sql
SELECT
  count(*)::integer AS total_migration_rows,
  min(version) AS minimum_version,
  max(version) AS maximum_version,
  count(*) FILTER (
    WHERE version >= '20260716133000'
  )::integer AS advocate_release_migration_rows,
  encode(
    extensions.digest(
      convert_to(
        coalesce(
          jsonb_agg(
            jsonb_build_array(
              version,
              coalesce(name, ''),
              statements
            )
            ORDER BY version
          )::text,
          'null'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) AS applied_migration_ledger_sha256
FROM supabase_migrations.schema_migrations;
```

The ledger digest is observational database evidence only. No trusted hosted oracle has established expected statement-ledger digests for these checkpoints, and the value is not expected to equal the source full-set digest because it hashes the stored migration ledger representation. Never use it as migration integrity evidence. Record it only to correlate before and after states.

Version count and maximum version are also insufficient by themselves. Integrity requires the clean pinned source commit, exact source full-set and release-slice digests, exact ordered CLI migration membership, zero-pending checkpoint result, migration-specific postconditions, and the required database tests. If any of those facts disagree, stop even when the ledger count looks correct.

## Step 2: deploy the fail-closed Vercel boundary

Complete the project creation and caller audit pre-step before beginning this step. Then create the project's first Production deployment. Do not create another project, attach a hostname, activate a provider worker, or authorize public traffic in this step.

### Configuration before the first Production deployment

1. Confirm the local `.vercel/project.json`, selected Vercel team, and selected project identify only `creator-share-advocate-staging`. Stop if any binding identifies `creator-share-www`.
2. Reconfirm the exact project controls from the pre-step, including Node 24, Yarn `1.22.22`, `yarn install --frozen-lockfile`, `yarn build`, Next.js, region `sfo1`, disabled automatic domain assignment, disconnected Git deployment, and disabled Vercel Analytics.
3. Enable automatic Vercel System Environment Variables and prove the resulting deployment receives authentic `VERCEL_DEPLOYMENT_ID` and `VERCEL_GIT_COMMIT_SHA` values. Do not create operator-supplied lookalike values.
4. Set `NEXT_PUBLIC_BASE_URL` and `NEXT_PUBLIC_SITE_URL` to exactly `https://advocate-staging.creatorshare.com`, with no trailing slash.
5. Set `ADVOCATE_INVITATION_CANONICAL_ORIGIN` to exactly `https://advocate-staging.creatorshare.com`.
6. Set `NEXT_PUBLIC_SUPABASE_URL` to exactly `https://destjwstohzmufshfnuy.supabase.co`, with the matching staging publishable and secret credentials. The application must fail its build if those values can reach another Supabase project.
7. Set `ADVOCATE_PROVIDER_AUTOMATION_MODE=disabled`. Keep `ADVOCATE_CLOUDFLARE_API_TOKEN`, `ADVOCATE_CLOUDFLARE_ZONE_ID`, `ADVOCATE_CLOUDFLARE_CNAME_TARGET`, `ADVOCATE_VERCEL_API_TOKEN`, and `ADVOCATE_VERCEL_PROJECT_ID` absent from the deployment.
8. Keep Stripe in test mode, PayPal on its exact sandbox origin, application email on the approved Ethereal submission boundary, and every staging recipient restriction required by the payment runbook. Keep live provider credentials absent.
9. Keep `LLM_API_KEY`, `LLM_API_HOST`, `NEXT_PUBLIC_MAPTILER_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_MANAGER_CHAT_ID` absent.
10. Install all required staging cryptographic secrets as distinct server-only values. Every secret must satisfy its parser, and no private secret may equal another private secret or any public credential.
11. Confirm the Vercel plan supports the declared 120-second and 300-second function limits and every declared schedule. A repository setting does not prove account entitlement.

The first Production deployment creates all 11 schedules declared in `vercel.json`. There is no separate cron activation step. Every schedule must be harmless before the deployment is created.

Generate nine distinct temporary secrets. Each must differ from `CRON_SECRET` and from every other environment secret. Configure the following overrides before the first Production deployment:

- `ADVOCATE_PROVISIONING_WORKER_SECRET`
- `ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET`
- `ADVOCATE_INVITATION_EMAIL_WORKER_SECRET`
- `ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET`
- `ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_WORKER_SECRET`
- `PAYMENT_GATEWAY_EVENT_WORKER_SECRET`
- `SPONSOR_WELCOME_EMAIL_WORKER_SECRET`
- `SUBSCRIPTION_CANCELLATION_WORKER_SECRET`
- `DATA_RETENTION_WORKER_SECRET`

Vercel Cron sends `CRON_SECRET`. Each route that selects one of these nine dedicated overrides must therefore reject the scheduled request with `401` before creating a database client, claiming work, sending email, or contacting a provider. The publication canary and publication sentinel routes intentionally have no dedicated override. They authenticate `CRON_SECRET`, then return HTTP `200` with the fixed body `{"ok":true,"code":"automation_disabled"}` because provider automation is disabled. Their disabled path must execute before a database client or provider adapter is created.

The expected first-deployment schedule behavior is:

| Scheduled route                                         | Schedule       | First-deployment result                                        | Later staging action                                                         |
| ------------------------------------------------------- | -------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/api/internal/advocates/provisioning`                  | Every minute   | `401` through `ADVOCATE_PROVISIONING_WORKER_SECRET`            | Keep denied. Provider automation cannot be active in exact Advocate staging. |
| `/api/internal/advocates/publication-canaries`          | Every minute   | `200` with `automation_disabled`                               | Keep provider automation disabled.                                           |
| `/api/internal/advocates/publication-sentinel`          | Every minute   | `200` with `automation_disabled`                               | Keep provider automation disabled.                                           |
| `/api/internal/advocates/logo-reconciliation`           | Every minute   | `401` through `ADVOCATE_LOGO_RECONCILIATION_WORKER_SECRET`     | Keep denied until a separately reviewed storage canary authorizes it.        |
| `/api/internal/advocates/invitations`                   | Every minute   | `401` through `ADVOCATE_INVITATION_EMAIL_WORKER_SECRET`        | Remove only this override after both invitation canaries succeed.            |
| `/api/internal/advocates/public-metrics`                | Daily at 01:13 | `401` through `ADVOCATE_PUBLIC_METRIC_RELEASE_WORKER_SECRET`   | Keep denied until the public metric release gate is separately accepted.     |
| `/api/internal/advocates/lifecycle-cleanup`             | Every minute   | `401` through `ARCHIVED_ADVOCATE_DOMAIN_CLEANUP_WORKER_SECRET` | Keep denied until the lifecycle gate is separately accepted.                 |
| `/api/internal/payments/gateway-events`                 | Every minute   | `401` through `PAYMENT_GATEWAY_EVENT_WORKER_SECRET`            | Keep denied until payment gateway canaries are separately accepted.          |
| `/api/internal/sponsorships/welcome-emails`             | Every minute   | `401` through `SPONSOR_WELCOME_EMAIL_WORKER_SECRET`            | Keep denied until the welcome email canary is separately accepted.           |
| `/api/internal/sponsorships/subscription-cancellations` | Every minute   | `401` through `SUBSCRIPTION_CANCELLATION_WORKER_SECRET`        | Keep denied until cancellation provider canaries are separately accepted.    |
| `/api/internal/retention`                               | Hourly at :17  | `401` through `DATA_RETENTION_WORKER_SECRET`                   | Keep denied until the retention gate is separately accepted.                 |

Deploy a reviewed application commit whose `supabase/migrations` full-set digest is the exact final digest in this runbook. Record the Vercel deployment ID, Git revision, immutable generated Production URL, complete environment-name inventory, and all 11 installed schedules. Record no environment value.

### Phase A: immutable URL validation

The generated Vercel URL is not an Advocate public hostname. Application routing intentionally admits only authenticated internal worker paths on that host. It cannot validate public browsing, Supabase Auth redirects, invitation links, cookies, tenant routing, privacy presentation, or cleanup behavior for either staging hostname.

Use the immutable URL only for these checks:

1. Send an unscheduled `POST` with no body to `/api/internal/advocates/release-preflight` using `Authorization: Bearer <CRON_SECRET>`. Retain only the categorical response and independently matched deployment ID and revision.
2. Send the same request without authorization and require the fixed `401` response.
3. Probe each of the nine overridden worker routes with `CRON_SECRET`. Require the exact fixed unauthorized category and prove from database counts and invocation telemetry that no client, claim, email, payment, retention, or provider work began.
4. Probe the publication canary and publication sentinel routes with `CRON_SECRET`. Require the exact fixed `automation_disabled` category and prove no database or provider work began.
5. Observe at least two scheduled one-minute intervals and the next applicable longer cadence. When waiting for a longer cadence is impractical, invoke that route manually with the exact scheduler credential and require the same fixed category from the exact deployed revision.
6. Rerun the aggregate database preflight. Every mutable Advocate count must still be zero.

Do not make a valid provider request merely to make the release preflight green. This staging deployment deliberately remains fail closed.

### Exact release preflight categories

Use the following three evidence phases:

- Phase A, immutable URL, all nine worker overrides present.
- Phase B, exact hostnames attached and verified, all nine worker overrides still present.
- Phase C, exact-host invitation canaries complete and only `ADVOCATE_INVITATION_EMAIL_WORKER_SECRET` removed. The other eight overrides remain.

Every phase must return schema version `1` and `providerReadiness: not_probed`. The expected category matrix is:

| Check                                            | Phase A      | Phase B      | Phase C      | Reason                                                                                                            |
| ------------------------------------------------ | ------------ | ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `deployment_identity`                            | `configured` | `configured` | `configured` | Vercel supplies the authentic Production deployment ID and 40-character Git revision.                             |
| `provider_automation_gate`                       | `invalid`    | `invalid`    | `invalid`    | Exact Advocate staging requires `disabled`; this production-oriented preflight accepts only active provider mode. |
| `cross_subdomain_cookie_trust`                   | `unverified` | `unverified` | `unverified` | Parent-domain attribution cookies are not authorized in this release.                                             |
| `cross_subdomain_cookie_trusted_collector`       | `unverified` | `unverified` | `unverified` | The collector requires later provider evidence.                                                                   |
| `cross_subdomain_cookie_fresh_provider_evidence` | `unverified` | `unverified` | `unverified` | Fresh provider evidence is intentionally absent.                                                                  |
| `supabase_configuration`                         | `configured` | `configured` | `configured` | The exact staging project URL and correctly typed credentials are installed.                                      |
| `worker_configuration`                           | `invalid`    | `invalid`    | `invalid`    | At least one deliberate Vercel-incompatible dedicated worker override remains in every phase.                     |
| `email_configuration`                            | `invalid`    | `invalid`    | `invalid`    | The production-oriented preflight accepts only the Creator Share apex, while staging requires its exact host.     |
| `cloudflare_configuration`                       | `unverified` | `unverified` | `unverified` | Application provider credentials remain absent even after manual exact-record attachment.                         |
| `vercel_configuration`                           | `unverified` | `unverified` | `unverified` | Application provider credentials remain absent even after manual exact-domain attachment.                         |
| `stripe_us_configuration`                        | `unverified` | `unverified` | `unverified` | Live publication payment configuration is outside this staging boundary.                                          |
| `stripe_uk_configuration`                        | `unverified` | `unverified` | `unverified` | Live publication payment configuration is outside this staging boundary.                                          |
| `paypal_configuration`                           | `unverified` | `unverified` | `unverified` | Live publication payment configuration is outside this staging boundary.                                          |
| `cryptographic_configuration`                    | `configured` | `configured` | `configured` | All required staging cryptographic values are present, valid, and server only.                                    |
| `secret_separation`                              | `unverified` | `unverified` | `unverified` | Required live provider secrets are intentionally absent.                                                          |

The exact overall `configurationState` is `invalid` in all three phases. Only `provider_automation_gate`, `worker_configuration`, and `email_configuration` may be `invalid`. An invalid result for any other check is an unrelated configuration defect and stops the release. A category may not be changed from its expected value merely because a request returned HTTP `200`.

Removing only the invitation override in Phase C does not make `worker_configuration` configured because eight deliberate overrides remain. Prove invitation authorization directly from its route and database evidence. Do not misreport the preflight.

## Step 3: attach only the two exact staging hostnames

Begin this step only after the final schema checkpoint, Phase A preflight, schedule fail-closed evidence, and aggregate zero-state query all pass. Provider automation remains disabled, and the application deployment retains no Cloudflare or Vercel provider credentials.

Use operator-controlled provider APIs or provider control planes, not the application provisioning worker. The DNS target must be the dedicated staging project's provider-reported project-specific target. Never guess a generic Vercel target and never reuse a target copied from `creator-share-www`.

Perform and record the exact sequence:

1. Capture the Vercel project domain inventory and authoritative Cloudflare DNS answers for both exact names. Require both names to be absent from every Vercel project and require no conflicting A, AAAA, CNAME, or proxied record.
2. Add only `advocate-staging.creatorshare.com` and `canary.advocate-staging.creatorshare.com` to `creator-share-advocate-staging`. Record each opaque domain identifier, the exact pending verification state, and Vercel's provider-reported project-specific DNS target.
3. Require both domain objects to report the same intended dedicated project and reviewed Production deployment. If Vercel reports another assignment, transfer requirement, redirect, branch binding, custom environment binding, or unexpected target, stop before DNS.
4. Create one exact DNS-only Cloudflare CNAME for each hostname. Each CNAME must point to the provider-reported project-specific target from step 2 and must have `proxied: false`. Create no wildcard and no sibling record.
5. Query authoritative DNS until both exact CNAMEs are visible and match byte for byte after canonical hostname normalization. Record the DNS observation time, record identifiers, names, targets, TTLs, and DNS-only state without recording provider credentials.
6. Require Vercel to verify both exact domains, issue a valid certificate, and bind them to the exact reviewed deployment. Record fixed domain, certificate, deployment, and revision categories.
7. Request both hosts over HTTPS without overriding DNS. Require valid TLS, the exact Host, no redirect to another Creator Share project, and the reviewed deployment identity. Confirm a random sibling such as `unassigned.advocate-staging.creatorshare.com` has no DNS record and cannot reach the application.
8. Rerun the release preflight through the exact staging root and require the Phase B matrix. The preflight remains an authenticated internal request.

If any step after DNS creation fails, remove both Cloudflare CNAMEs first. Verify authoritative DNS absence, then detach both exact Vercel domain objects. This order stops public routing before releasing platform ownership. If failure occurs before DNS creation, detach any newly added Vercel domain object and verify the project domain inventory returns to its pre-step state. Never point either hostname at the existing production project as a diagnostic shortcut.

## Step 4: exact-host Auth, email, routing, privacy, and cleanup canaries

Only the exact hostnames can validate these surfaces. Configure hosted Supabase Auth for project `destjwstohzmufshfnuy` with the reviewed templates, exact email confirmation setting, exact 3,600-second OTP expiry, and only the four exact staging redirect paths defined in the payment runbook. Do not add a wildcard URL, Vercel generated URL, preview URL, sibling tenant, or production fallback.

Keep all nine worker overrides while running the canaries. Use the dedicated invitation worker secret only for controlled direct invitation worker requests. The Vercel schedule continues to receive `401`.

Run and preserve sanitized evidence for:

1. Root routing at `advocate-staging.creatorshare.com`, including the exact authentication and account-management surfaces that the staging root is permitted to serve.
2. Tenant routing at `canary.advocate-staging.creatorshare.com`, which must map only to the canonical `canary.creatorshare.com` staging tenant record. Other nested labels and every unassigned sibling must fail closed.
3. Hosted new-account email confirmation and hosted existing-account magic-link sign-in through the exact staging root with separate browser cookie jars, same-origin confirmation POST, fragment removal, secure cookie attributes, and no proof material in a server-visible URL, log, referrer, analytics event, or browser storage.
4. One new-account Advocate invitation and one existing-account Advocate invitation through the exact staging host and Ethereal boundary. Require a single recipient-fence outcome, exact target identity, one immutable redemption receipt, no cross-account disclosure, and no production email.
5. Public Advocate presentation and analytics privacy. The public surface may expose only approved aggregate metrics and the allowed abbreviated sponsor recognition. It must expose no sponsor email, full last name, account identifier, payment identifier, or private audit data.
6. Browser attribution isolation. Cookies remain host scoped, are hints rather than authority, and do not create parent-domain or cross-host post-visit attribution in this release.
7. Cleanup of every tracked canary user, invitation, outbox row, mailbox message, browser session, portal fixture, and provider test object using the scoped cleanup procedure in the linked runbooks. Prove unrelated rows and mailbox messages remain untouched.
8. The aggregate database preflight after cleanup. Every value expected to return to zero must do so, and every immutable canary receipt expected to remain must match the run's protected evidence.

Stop on any ambiguous Auth issuance, email handoff, identity match, invitation claim, payment state, or cleanup result. Ambiguity is not a passing canary.

After both invitation canaries and their cleanup evidence pass, remove only `ADVOCATE_INVITATION_EMAIL_WORKER_SECRET` from Production and create a new reviewed deployment. The invitation schedule already exists. This change authorizes that schedule to use `CRON_SECRET`; it does not create or enable a cron. Require the next invocation to authenticate, claim zero unexpected rows, and return the exact healthy empty-work category. Keep the other eight overrides and provider automation disabled. Rerun the release preflight and require the Phase C matrix.

Follow the payment and domain publication runbooks for every later provider or worker promotion. Exact Advocate staging must never set provider automation to active.

## Rollback boundaries

| Boundary                                                    | Permitted response                                                                                                                                                                                              | Forbidden action                                                                                                                                               |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before database application | Stop and preserve the source and target evidence. | Do not repair or rewrite migration history. |
| After partial database application | Keep callers paused, preserve the exact ledger and failure evidence, and review forward recovery. | Do not deploy against a partial schema or replay an applied migration. |
| After complete database application | Use only an application proven compatible with the installed schema; keep workers disabled until their release gates pass. | Do not restore an older database across external authentication or payment activity. |
| After first Production deployment, before domain attachment | Keep the nine overrides and disabled provider mode. Replace the deployment only with another reviewed fail-closed build. Preserve all deployment, invocation, and schedule evidence.                            | Do not assume deployment rollback removes the 11 installed schedules, delete the project to hide evidence, or point the production Creator Share project here. |
| After Vercel domain objects, before Cloudflare DNS          | Detach only the two new exact domain objects and verify their absence.                                                                                                                                          | Do not add a wildcard, transfer a production hostname, or create DNS to diagnose a platform ownership conflict.                                                |
| After Cloudflare DNS creation                               | Remove both exact DNS records first and verify authoritative absence. Then detach the two Vercel domain objects and preserve the failed certificate and routing evidence.                                       | Do not detach Vercel first while DNS can still route, proxy the records, or retarget them to another project.                                                  |
| After hosted Auth, email, invitation, or payment activity   | Use scoped forward cleanup and the linked runbook procedures. Preserve immutable receipts and external handoff evidence.                                                                                        | Do not destroy the dedicated project, force-delete ambiguous canary state, delete unrelated mailbox data, or use the pre-release backup as a blind rewind.     |
| After invitation schedule authorization                     | Restore a new distinct invitation override in a reviewed deployment to deny future scheduled claims, then classify any in-flight claim or handoff before further action.                                        | Do not assume changing an environment value terminates an old invocation, revoke evidence prematurely, or reintroduce the retired direct-proof worker.         |

Every migration in this release is forward only once committed. If uncertainty exists, the safe state is the exact current schema with every caller paused or fail closed. A serverless platform can preserve old code after a deployment, and an email provider can accept work before the application receives its response. Neither ambiguity is solved by restoring yesterday's database.

## Completion checklist

The staging migration and deployment boundary is complete only when:

- The pinned source, exact baseline, source digest, ordered pending migration set, and before/after ledger evidence agree.
- The complete series and its existing-data repairs pass the documented postconditions.

- The pre-foundation and post-foundation evidence records the duplicate role-assignment deletion set and the open-beneficiary repair set.
- All 103 migrations are present with the exact final source digest and zero pending migrations.
- The full database and concurrency gates pass.
- The Vercel deployment belongs only to `creator-share-advocate-staging`.
- Automatic Vercel System Environment Variables supplied the authentic deployment ID and Git revision.
- The first Production deployment installed exactly 11 schedules, and every route produced its specified fail-closed result before any claim or provider work.
- Provider automation remains disabled.
- The immutable deployment URL passed only the internal route, schedule, and provider-free preflight checks appropriate to that host.
- The preflight returned exactly the Phase A, Phase B, and Phase C categories, with no unrelated invalid check.
- Both exact DNS-only CNAMEs use the dedicated project's provider-reported project-specific target and both exact Vercel domain objects bind to the reviewed deployment.
- No wildcard, automatic alias, sibling record, redirect, branch binding, or production-project assignment exists.
- Hosted Auth, email, routing, privacy, and cleanup evidence is retained without secrets.
- Only the invitation worker override was removed, only after both invitation canaries and their cleanup passed. The other eight overrides remain.
- Every later payment and publication step is handed to the two linked Advocate runbooks.
