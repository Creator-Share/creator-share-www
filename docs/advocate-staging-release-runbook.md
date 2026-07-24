# Advocate Staging Release Runbook

This runbook controls the first staged release of the Advocate Platform into Supabase project `destjwstohzmufshfnuy` and the dedicated Vercel project `creator-share-advocate-staging`. It divides the 68 pending database migrations into a foundation tranche of 65, one coordinated invitation proof cutover migration, and two final authority and hostname migrations.

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
| Database source boundary   | `f55c10c000cb7d695f74b0ea06035723f63ab6e1` or a reviewed descendant with an identical migration set |

Never link the Advocate worktree to the existing `creator-share-www` Vercel project. Never attach a wildcard, a `www` alias, a branch alias, or an automatic production domain. Vercel Production is used here only because custom domains and scheduled functions bind to that environment. The dedicated project remains Creator Share staging.

## Audited migration checkpoints

The source digests below use the same framing as the repository database concurrency gates. For each sorted SQL migration, hash the UTF8 filename, one zero byte, the exact file bytes, and one zero byte. The full-set digest covers every migration present at that commit. The tranche digest covers only the release slice named in the row.

| Checkpoint               | Exact commit                               | Total migrations | Boundary                                                                   | Release slice | Full-set SHA256                                                    | Slice SHA256                                                       |
| ------------------------ | ------------------------------------------ | ---------------: | -------------------------------------------------------------------------- | ------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Existing remote baseline | `201ae2dc68f75c5b1d02c78dbcc2ac1c98f0adce` |               35 | `20260604000000_add_email_to_subscriptions_and_subscription_id_to_tledger` |   35 existing | `a7eb00bba505b56745a28df8dcd8d220f3faed20124dbcaba580d298ca5a31a1` | Not applicable                                                     |
| Foundation tranche       | `8f08e20239a490daf22589c4e6511ffae92eaf0d` |              100 | `20260720090000_password_recovery_receipt_consumption`                     |        65 new | `8bdbee39d45e5443421584fd8578d3dfbe5fd7d36bdd280ead59bcff285829ad` | `8708ef4b3bdfbc232ceed2d8a1fcb87d791fe08ac2cb1b2fedbda0e54275faed` |
| Invitation proof cutover | `5aaa04a8deb5ee56f5df5df380c7dd58b05b4d39` |              101 | `20260720100000_advocate_invitation_email_proof_settlement`                |         1 new | `492d329c05bbef56c28e6e4bdd689f8ce46eb0fd0dc84db08cf4477ba9ad9cf3` | `2a134cb439c8225476cc19a3aeecf09c9db394d5ed7d1ccbb00882be0bd600e3` |
| Final staging boundary   | `f55c10c000cb7d695f74b0ea06035723f63ab6e1` |              103 | `20260720102000_advocate_staging_subdomain_reservation`                    |         2 new | `7e4f0c9b5bb900c8fed721520fcd8549510c9ee189f2c8d88a8390abb3f75854` | `5d1a3c110f66fa7e4b7213c2ddef6906b8d129ac894cd68274cc7905706b9dda` |

The three final migration files also have these direct file digests:

| Migration                                                       | File SHA256                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `20260720100000_advocate_invitation_email_proof_settlement.sql` | `1f63d5d237c2eb82158788b30b2d82dd936d86904b9c116606c02c548021c3d1` |
| `20260720101000_advocate_branding_actor_authority.sql`          | `48d1cf5d4f04e741eb4d76e3c68dd1e4aa05c81c1db5ed2dd2bca5c3a21f959f` |
| `20260720102000_advocate_staging_subdomain_reservation.sql`     | `eb011dff7710d1700f70c84336ac243145ae80591f040a8682c5caa401376d62` |

At each checkpoint, use a clean detached worktree at the exact commit. Link that worktree only to `destjwstohzmufshfnuy`. A descendant commit is acceptable for the application deployment only after proving that its `supabase/migrations` full-set digest remains `7e4f0c9b5bb900c8fed721520fcd8549510c9ee189f2c8d88a8390abb3f75854`.

## Release ledger

Maintain one private, append-only release ledger. Record no access token, database password, service key, SMTP credential, bearer value, email address, invitation identifier, or provider payload. Each checkpoint entry must contain:

1. UTC start and completion timestamps.
2. Operator identity and change reference.
3. Supabase project reference and Vercel team and project identifiers.
4. Exact Git commit, clean-checkout result, migration boundary, full-set digest, and tranche digest.
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
- Migration dry-run output contains any version outside the intended tranche.
- The remote migration ledger differs from the expected count or boundary.
- Any preflight count expected to be zero is nonzero.
- A prior worker invocation might still be running.
- A pre-handoff invitation row has an unexpired five-minute lease.
- Any invitation delivery has begun and provider acceptance is unknown.
- Hosted OTP expiry evidence is absent, older than the release evidence window, or outside 1 through 3,600 seconds.
- Arm or quarantine returns SQLSTATE `55P03`, `55000`, a lock timeout, a statement timeout, or an unexpected count.
- A domain, deployment, invocation, cron schedule, or tenant state appears that is not in the release ledger.
- A migration tranche stops after only part of its intended ledger range has committed.
- Any deployment or scheduler capable of reaching `destjwstohzmufshfnuy` is missing from the historical caller census.

Never repair migration history to make a mismatch disappear. Never restore the retired invitation claim signature. Never continue by deploying a partially compatible application.

## Pre-Step: create the isolated Vercel project and audit every possible caller

Create the dedicated `creator-share-advocate-staging` Vercel project before Step 0 so its complete lifetime can be audited. Record the project ID, team ID, creation time, exact project-creation audit event, and initial zero results for deployments, domains, invocations, and cron schedules without recording credentials. Stop if the project already exists, the creation event is missing or ambiguous, or any initial zero result is nonzero until its complete prior lifetime is reconciled.

Configure these project controls before any Production deployment:

1. Framework Next.js, repository root, Node 24, Yarn `1.22.22`, `yarn install --frozen-lockfile`, `yarn build`, and region `sfo1`. The package manager identity must match the exact `packageManager` field in `package.json`.
2. Automatic custom Production domain assignment disabled.
3. Git automatic deployment disconnected until this staging release is accepted.
4. Vercel Analytics disabled.
5. Automatic Vercel System Environment Variables enabled. The application preflight requires authentic `VERCEL_DEPLOYMENT_ID` and `VERCEL_GIT_COMMIT_SHA` values.
6. Only the isolated staging Supabase origin and credentials.
7. `ADVOCATE_PROVIDER_AUTOMATION_MODE=disabled`.
8. No custom domain and no deployment before the virgin decision is recorded.

The caller audit is broader than the new project. Inventory every deployment and scheduler that has, or historically had, enough configuration to call this Supabase project. At minimum, inspect:

- Every deployment in every Creator Share Vercel project and environment, including the existing `creator-share-www` project.
- Every current and historical Vercel cron schedule and invocation for those deployments.
- GitHub Actions, external cron services, queue consumers, and manually configured worker hosts.
- Supabase Edge Functions, database cron jobs, webhooks, and scheduled jobs.
- Persistent local or hosted processes operated by the team.
- Every domain or alias that routed to one of those deployments.

Match capability using the exact Supabase project origin or project reference and the presence of a credential path that could call the relevant Auth, REST, or RPC boundary. Inspect secret values only inside the approved secret store. Record only a fixed match result and evidence reference. A deployment does not become irrelevant merely because it belongs to another project or no longer owns a domain. Historical warm instances and direct generated URLs remain part of the audit.

For every capable deployment or scheduler, prove the complete deployment lifetime, cron lifetime, invocation history, and retirement state. If provider retention does not cover its complete lifetime, the virgin exception is unavailable. Freeze or fail-close every capable caller before Drain A. Creating an empty new Vercel project does not pause an older deployment.

## Controlled migration application

Use the reviewed Supabase CLI binary already installed in the Advocate worktree. Do not invoke a package runner from a detached historical worktree because it can download a different CLI version. Verify the exact binary before every checkpoint:

```sh
SUPABASE_CLI=/Users/aubreyfalconer/dev/creator-share/creator-share-www-advocate-platform/node_modules/.bin/supabase
test "$("$SUPABASE_CLI" --version | head -n 1)" = "2.90.0"
test "$(shasum -a 256 "$SUPABASE_CLI" | awk '{print $1}')" = "2193788e0b8a20959aba99a154d24d430a6f62594aaa0a78c2c090155e58a933"
```

Stop if either assertion fails. Record the CLI version and SHA256 in the private release ledger. Any intentional CLI upgrade requires a separate review and new checksum.

Use a separate detached worktree for each checkpoint so the CLI cannot see later migrations. Choose a new local directory for each checkpoint and substitute the exact commit from the checkpoint table:

```sh
git worktree add --detach "$CHECKPOINT_DIRECTORY" "$CHECKPOINT_COMMIT"
git -C "$CHECKPOINT_DIRECTORY" status --porcelain=v1
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" link --project-ref destjwstohzmufshfnuy
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" migration list --linked
"$SUPABASE_CLI" --workdir "$CHECKPOINT_DIRECTORY" db push --linked --dry-run
```

The status output must be empty. Compare the linked migration list and dry-run output to the intended tranche before approving the write. Apply the tranche and immediately repeat the read-only checks:

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

Each migration file commits independently and the migration ledger can therefore advance partway through a tranche. A partial tranche is a release stop, not permission to rerun the whole command.

- If only 1 through 64 of the 65 foundation migrations commit, immediately capture the complete migration ledger query, exact `migration list` result, CLI exit category, failing migration version, source commit, source digests, and aggregate counts that can still be queried. Do not deploy any application.
- If the one-migration invitation cutover fails, prove whether the ledger remains at 100 or reached 101. At 100, keep every invitation caller paused. At 101, treat the cutover as committed and proceed only through the arm and quarantine sequence after review.
- If only the first of the final two migrations commits, the ledger contains 102 rows with maximum version `20260720101000`. Keep every application and hostname detached until the staging reservation migration is reviewed and applied.

Never use migration history repair, a down migration, a blind retry, or an old application as recovery. First determine whether the failing file's transaction rolled back completely, inspect database locks and invariant evidence, and have a reviewer approve a forward-only recovery from the exact current ledger. A retry of the same unapplied file is allowed only when its prior transaction is proven absent, its source digest is unchanged, the environmental cause is corrected, and the reviewer records that decision. An already applied migration is never edited or replayed.

## Step 0: baseline and virgin-project decision

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

For the audited 35-migration baseline, the only mutable Advocate relation is `public.advocate`. Both counts must be zero. An unexpected Advocate relation or any nonzero count makes the legacy pause path mandatory.

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

### Rigorously bounded virgin dedicated-project exception

The exception can waive only Drain A, the pre-migration legacy worker pause. It never waives the post-migration arm transaction, Drain B, quarantine, ledger checks, or application canaries.

Approve the exception only when every fact below is independently proven and recorded:

1. The dedicated Vercel project exists in the expected Creator Share team, was created for this release, and has zero deployments in every environment from creation through the decision time.
2. The dedicated project has never had a Git deployment, manual deployment, promotion, rollback, alias, custom domain, function invocation, edge invocation, background invocation, or manual invocation.
3. The dedicated project has zero installed cron schedules because no Production deployment has occurred, and it has zero historical cron invocations.
4. The complete cross-project caller audit proves that no other deployment, generated URL, domain, Vercel cron, external scheduler, Supabase scheduler, queue consumer, or persistent process has ever been capable of reaching the Advocate surfaces in `destjwstohzmufshfnuy`.
5. Complete audit retention covers every capable deployment and scheduler from creation through retirement. An empty result with a shorter retention window is not absence evidence.
6. Neither exact staging hostname is attached to any Vercel project, and neither hostname has a DNS record or historical staging certificate attributable to this release.
7. The pre-tranche database relation inventory is exactly the audited baseline described above, with zero `public.advocate` rows and zero advocate-scoped role assignments.
8. Before the foundation tranche, `public.advocate_domains`, `public.advocate_invitations`, and `public.advocate_invitation_email_outbox` do not exist.
9. After the foundation tranche, the complete aggregate query below returns zero for every mutable tenant, domain, invitation, outbox, publication, operation, audit, and worker field.
10. No evidence source reports an ambiguous, truncated, retained, or still-running caller.

The known empty `public.advocate` baseline relation does not by itself invalidate the exception. Any other Advocate relation before the foundation tranche, any row in that baseline relation, any nonzero aggregate after the foundation tranche, any capable historical caller, or any unavailable proof invalidates the exception. If even one proof is unavailable, the legacy pause path and Drain A are mandatory.

## Step 1: apply the foundation tranche of 65

Use a clean detached worktree at commit `8f08e20239a490daf22589c4e6511ffae92eaf0d`. Confirm the full-set and tranche digests from the checkpoint table. This is the audited application checkpoint immediately before the invitation proof cutover work. Its `supabase/migrations` tree is `915efc53b9daf5e9e55eff268cf9108ea8e3f64b`, with the exact 100-file migration set recorded above. Link that worktree to the exact staging Supabase project using the stored CLI credential. Do not put a token or password in command history.

Run a linked migration dry-run. It must list exactly 65 versions, beginning with `20260716133000` and ending with `20260720090000`. Apply only after the list matches. Then run the same dry-run again. It must report no pending migration at this checkpoint.

The first ledger checkpoint must report:

- Total migration rows: `100`
- Maximum version: `20260720090000`
- Release migration rows from `20260716133000`: `65`
- Source full-set SHA256: `8bdbee39d45e5443421584fd8578d3dfbe5fd7d36bdd280ead59bcff285829ad`

This tranche is not merely additive. It renames the historical `public.advocate` table to `public.advocates`, changes existing foreign-key targets, replaces row security policies, removes or replaces RPC signatures, installs new trigger guards, and changes worker and checkout authority surfaces. Do not route an older application to the resulting schema unless a separate compatibility review proves that exact application commit against the complete 100-migration database. An unproven old deployment is not a rollback target.

Run the full provider-free database gates required by the two linked Advocate runbooks. Do not deploy an application or attach a domain yet.

### Aggregate preflight after the foundation tranche

Run this query as the protected database operator. It returns counts only and exposes no contact or identifier.

```sql
WITH snapshot AS (
  SELECT
    (SELECT count(*) FROM public.advocates) AS advocates,
    (SELECT count(*) FROM public.advocate_domains) AS domains,
    (SELECT count(*) FROM public.advocate_domain_integrations) AS integrations,
    (SELECT count(*) FROM public.domain_provisioning_jobs) AS provisioning_jobs,
    (SELECT count(*) FROM public.advocate_branding) AS branding_rows,
    (
      SELECT count(*)
      FROM public.advocate_public_metric_selections
    ) AS public_metric_selections,
    (SELECT count(*) FROM public.advocate_beneficiaries) AS beneficiary_rows,
    (SELECT count(*) FROM public.advocate_memberships) AS memberships,
    (
      SELECT count(*)
      FROM public.advocate_membership_roles
    ) AS membership_role_rows,
    (SELECT count(*) FROM public.advocate_invitations) AS invitations,
    (
      SELECT count(*)
      FROM public.advocate_invitation_roles
    ) AS invitation_role_rows,
    (
      SELECT count(*)
      FROM public.advocate_invitation_email_outbox
    ) AS invitation_outbox,
    (SELECT count(*) FROM public.advocate_exposures) AS advocate_exposures,
    (
      SELECT count(*)
      FROM public.sponsorship_intents
      WHERE source_advocate_id IS NOT NULL
    ) AS advocate_sponsorship_intents,
    (
      SELECT count(*)
      FROM public.sponsorship_attributions
      WHERE advocate_id IS NOT NULL
    ) AS advocate_sponsorship_attributions,
    (
      SELECT count(*)
      FROM public.advocate_invitation_email_outbox
      WHERE attempt_count > 0
    ) AS attempted_outbox,
    (
      SELECT count(*)
      FROM public.advocate_invitation_email_outbox
      WHERE status = 'processing'
    ) AS processing_outbox,
    (
      SELECT count(*)
      FROM public.advocate_invitation_email_outbox
      WHERE status = 'processing'
        AND delivery_started_at IS NULL
    ) AS processing_before_handoff,
    (
      SELECT count(*)
      FROM public.advocate_invitation_email_outbox
      WHERE status = 'processing'
        AND delivery_started_at IS NOT NULL
    ) AS processing_after_handoff,
    (
      SELECT count(*)
      FROM public.advocate_invitation_email_outbox
      WHERE status = 'processing'
        AND delivery_started_at IS NULL
        AND locked_at > clock_timestamp() - interval '5 minutes'
    ) AS unexpired_pre_handoff_leases,
    (
      SELECT count(*)
      FROM public.advocate_invitations
      WHERE last_sent_at > clock_timestamp() - interval '3900 seconds'
    ) AS recent_invitation_sends,
    (
      SELECT count(*)
      FROM public.advocate_invitation_email_outbox
      WHERE attempt_count > 0
        AND contact_redacted_at IS NOT NULL
        AND contact_redacted_at >
          clock_timestamp() - interval '3900 seconds'
    ) AS recent_redacted_attempts,
    (
      SELECT count(*)
      FROM private.email_proof_issuance_gates
      WHERE issuance_flow = 'advocate-invitation'
    ) AS invitation_proof_gates,
    (
      SELECT count(*)
      FROM private.advocate_invitation_authentication_attempts
    ) AS invitation_authentication_attempts,
    (
      SELECT count(*)
      FROM private.advocate_logo_upload_reservations
    ) AS logo_upload_reservations,
    (
      SELECT count(*)
      FROM private.advocate_logo_reconciliation_jobs
    ) AS logo_reconciliation_jobs,
    (
      SELECT count(*)
      FROM private.advocate_public_metric_releases
    ) AS private_public_metric_releases,
    (
      SELECT count(*)
      FROM private.advocate_lifecycle_mutation_guards
    ) AS lifecycle_mutation_guards,
    (
      SELECT count(*)
      FROM private.advocate_ownership_transport_contexts
    ) AS ownership_transport_contexts,
    (
      SELECT count(*)
      FROM audit.advocate_portal_provisioning_starts
    ) AS provisioning_starts,
    (
      SELECT count(*)
      FROM audit.advocate_publication_canary_starts
    ) AS publication_starts,
    (
      SELECT count(*)
      FROM audit.advocate_publication_canary_reports
    ) AS publication_reports,
    (
      SELECT count(*)
      FROM audit.advocate_publication_approvals
    ) AS publication_approvals,
    (
      SELECT count(*)
      FROM audit.advocate_publication_canary_execution_leases
    ) AS publication_execution_leases,
    (
      SELECT count(*)
      FROM audit.advocate_publication_sentinel_reconciliation_runs
    ) AS sentinel_worker_runs,
    (
      SELECT count(*)
      FROM audit.advocate_publication_sentinel_reconciliation_events
    ) AS sentinel_worker_events,
    (
      SELECT count(*)
      FROM audit.advocate_delegate_events
    ) AS delegate_audit_events,
    (
      SELECT count(*)
      FROM audit.creator_share_advocate_lifecycle_actions
    ) AS lifecycle_action_receipts,
    (
      SELECT count(*)
      FROM audit.creator_share_advocate_ownership_transfers
    ) AS ownership_transfer_receipts,
    (
      SELECT count(*)
      FROM audit.creator_share_advocate_cleanup_recoveries
    ) AS cleanup_recovery_receipts,
    (
      SELECT count(*)
      FROM audit.creator_share_advocate_onboarding_receipts
    ) AS onboarding_receipts,
    (
      SELECT count(*)
      FROM audit.creator_share_advocate_initial_owner_reissue_receipts
    ) AS owner_reissue_receipts,
    (
      SELECT count(*)
      FROM audit.creator_share_advocate_initial_owner_revocation_receipts
    ) AS owner_revocation_receipts,
    (
      SELECT count(*)
      FROM audit.creator_share_advocate_invitation_redemption_receipts
    ) AS invitation_redemption_receipts,
    (
      SELECT count(*)
      FROM audit.data_retention_runs
    ) AS data_retention_runs,
    (
      SELECT count(*)
      FROM audit.data_retention_run_events
    ) AS data_retention_run_events,
    (
      SELECT count(*)
      FROM audit.audit_events
      WHERE advocate_id IS NOT NULL
    ) AS advocate_scoped_row_audit_events,
    (
      SELECT count(*)
      FROM audit.audit_event_forensics forensics
      JOIN audit.audit_events event
        ON event.id = forensics.audit_event_id
      WHERE event.advocate_id IS NOT NULL
    ) AS advocate_scoped_forensics,
    (
      SELECT count(*)
      FROM private.advocate_publication_transport_contexts
    ) AS publication_transport_contexts,
    (
      SELECT count(*)
      FROM private.advocate_publication_deployment_capabilities
    ) AS publication_capabilities
)
SELECT
  snapshot.*,
  (
    advocates = 0
    AND domains = 0
    AND integrations = 0
    AND provisioning_jobs = 0
    AND branding_rows = 0
    AND public_metric_selections = 0
    AND beneficiary_rows = 0
    AND memberships = 0
    AND membership_role_rows = 0
    AND invitations = 0
    AND invitation_role_rows = 0
    AND invitation_outbox = 0
    AND advocate_exposures = 0
    AND advocate_sponsorship_intents = 0
    AND advocate_sponsorship_attributions = 0
    AND attempted_outbox = 0
    AND processing_outbox = 0
    AND processing_before_handoff = 0
    AND processing_after_handoff = 0
    AND unexpired_pre_handoff_leases = 0
    AND recent_invitation_sends = 0
    AND recent_redacted_attempts = 0
    AND invitation_proof_gates = 0
    AND invitation_authentication_attempts = 0
    AND logo_upload_reservations = 0
    AND logo_reconciliation_jobs = 0
    AND private_public_metric_releases = 0
    AND lifecycle_mutation_guards = 0
    AND ownership_transport_contexts = 0
    AND provisioning_starts = 0
    AND publication_starts = 0
    AND publication_reports = 0
    AND publication_approvals = 0
    AND publication_execution_leases = 0
    AND sentinel_worker_runs = 0
    AND sentinel_worker_events = 0
    AND delegate_audit_events = 0
    AND lifecycle_action_receipts = 0
    AND ownership_transfer_receipts = 0
    AND cleanup_recovery_receipts = 0
    AND onboarding_receipts = 0
    AND owner_reissue_receipts = 0
    AND owner_revocation_receipts = 0
    AND invitation_redemption_receipts = 0
    AND data_retention_runs = 0
    AND data_retention_run_events = 0
    AND advocate_scoped_row_audit_events = 0
    AND advocate_scoped_forensics = 0
    AND publication_transport_contexts = 0
    AND publication_capabilities = 0
  ) AS virgin_mutable_state
FROM snapshot;
```

Every numeric result is expected to be zero for this first staging release, and `virgin_mutable_state` must be true. The parser resolves every relation and column in this query against the completed foundation schema. A missing or renamed relation is therefore a hard query failure, not a zero result. Seeded reserved labels, predefined roles, permissions, attribution policies, payment provider accounts, and other immutable dictionaries are intentionally not part of this zero-state assertion. The generic audit filter uses only `audit.audit_events.advocate_id IS NOT NULL` so migration-owned reserved-label dictionary events with no tenant do not invalidate virgin evidence.

## Step 2: Drain A, the legacy worker pause

Drain A and Drain B are separate safety intervals with different starting evidence. Never combine them or count one interval toward the other.

If and only if the complete virgin dedicated-project exception is approved, enter its evidence reference in the ledger and skip to Step 3. Otherwise:

1. Start from the complete caller census created before Step 0. Freeze every legacy Vercel project, deployment, generated URL, external scheduler, manual caller, queue consumer, and persistent process capable of reaching `destjwstohzmufshfnuy`.
2. For each still-deployed invitation route, configure a temporary dedicated `ADVOCATE_INVITATION_EMAIL_WORKER_SECRET` that differs from the credential its scheduler sends, then deploy that pause boundary without changing its database target.
3. Disable or revoke every non-Vercel scheduler at its own authority boundary. Record fixed disabled evidence.
4. Call every surviving exact invitation worker route with the formerly accepted scheduler credential and require `401` before any database claim. A 401 from only `creator-share-advocate-staging` is insufficient.
5. Confirm no uncatalogued deployment or scheduler can still authenticate, then record the latest server-observed pause timestamp across all callers as the start of Drain A.
6. Wait at least 70 complete seconds from that latest timestamp. This covers the retired worker's 60-second maximum plus a ten-second margin.
7. Prove from complete telemetry for every catalogued caller that no prior invitation worker remains active.
8. Rerun the aggregate preflight. Every count must remain zero.

Each 401 proves only that a new invocation on that exact route cannot claim. It does not prove an older invocation has ended or that another project was paused. Follow the ambiguity and delivery classification procedure in the two linked runbooks if any attempted or processing row exists. Do not proceed while an unexpired pre-handoff lease exists. Treat a begun handoff as potentially delivered.

## Step 3: apply the one-migration cutover

Keep the invitation worker disabled. Use a clean detached worktree at commit `5aaa04a8deb5ee56f5df5df380c7dd58b05b4d39`. Confirm the checkpoint digests.

The linked dry-run must list exactly:

`20260720100000_advocate_invitation_email_proof_settlement.sql`

Apply that migration, then require a zero-pending dry-run at this checkpoint.

The second ledger checkpoint must report:

- Total migration rows: `101`
- Maximum version: `20260720100000`
- Release migration rows from `20260716133000`: `66`
- Source full-set SHA256: `492d329c05bbef56c28e6e4bdd689f8ce46eb0fd0dc84db08cf4477ba9ad9cf3`

The migration removes the legacy four-argument claim function, installs the version 1 shared-issuer claim closed behind the quarantine receipt, and creates the immutable cutover ledger. The migration commit alone does not open claims.

## Step 4: arm transaction and Drain B

Generate a fresh nonzero UUID for the arm request and record it in the private release ledger. Prepare the complete block below as a private mode `0600` script outside the repository, replace the UUID once, review the complete script, and execute it noninteractively with stop-on-error behavior. Do not paste or run individual statements interactively.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

SELECT
  public.arm_advocate_invitation_legacy_email_proof_quarantine(
    'REPLACE_WITH_ARM_REQUEST_UUID'::uuid,
    NULL
  ) AS legacy_claim_fenced_at;

COMMIT;
```

Record the returned database timestamp. It is authoritative. The arm transaction must commit before quarantine begins.

Drain B begins at `legacy_claim_fenced_at`, not at the migration time, local clock time, Drain A, or operator observation time. Wait until the database clock is at least 70 complete seconds later. The quarantine function enforces this interval. Also confirm that no invitation worker invocation occurred during Drain B.

Do not run arm and quarantine in the same transaction. Do not subtract time already spent in Drain A.

## Step 5: quarantine transaction

Use fresh hosted Supabase Auth evidence to verify the exact email OTP expiry. The evidence must name project `destjwstohzmufshfnuy`, capture the provider Auth configuration field that controls email OTP expiry, report the exact value `3600`, include a sanitized canonical configuration digest and provider-observed timestamp, and be no more than 15 minutes old when the quarantine transaction begins. The transaction must commit within that 15-minute evidence window. Capture the same provider configuration again no later than five minutes after commit and require the same project reference, expiry, and canonical digest. If the prestate is older than 15 minutes, the transaction crosses the window, or the poststate differs, stop and investigate.

The `3600::smallint` input records this provider evidence, but the database always creates a fixed 3,900-second fence, consisting of the maximum one-hour proof lifetime plus a 300-second margin. Store only the project reference, exact expiry, timestamps, canonical digest, and fixed match result. Do not store the management credential or raw provider response.

Generate a second fresh nonzero UUID for the quarantine request. Prepare the complete block below as a separate private mode `0600` script outside the repository, replace the UUID once, review it, and execute it noninteractively with stop-on-error behavior. Run quarantine alone in this dedicated transaction. Do not execute the `SELECT`, assertion, and `COMMIT` as separate interactive actions.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '60s';

SELECT *
FROM public.quarantine_legacy_advocate_invitation_proofs(
  3600::smallint,
  'REPLACE_WITH_QUARANTINE_REQUEST_UUID'::uuid,
  NULL
);

DO $$
DECLARE
  receipt private.advocate_invitation_legacy_email_proof_quarantine%ROWTYPE;
BEGIN
  SELECT quarantine.*
  INTO STRICT receipt
  FROM private.advocate_invitation_legacy_email_proof_quarantine quarantine
  WHERE quarantine.quarantine_identity =
    'advocate_invitation_legacy_email_proof_v1';

  IF receipt.candidate_outbox_count <> 0
     OR receipt.unique_recipient_count <> 0
     OR receipt.quarantined_outbox_count <> 0
     OR receipt.created_gate_count <> 0
     OR receipt.preserved_gate_count <> 0
     OR receipt.executed_at IS NULL
     OR receipt.fence_expires_at IS DISTINCT FROM
       receipt.executed_at + interval '3900 seconds' THEN
    RAISE EXCEPTION 'Unexpected staging invitation proof quarantine receipt'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMIT;
```

For this first staging release, the exact expected aggregate result is:

- `candidate_outbox_count = 0`
- `unique_recipient_count = 0`
- `quarantined_outbox_count = 0`
- `created_gate_count = 0`
- `preserved_gate_count = 0`
- `fence_expires_at = executed_at + 3900 seconds`
- `executed_at` is a nonnull database timestamp at least 70 seconds after `legacy_claim_fenced_at`

If any count is nonzero, the assertion aborts the transaction. Issue `ROLLBACK` immediately if the client remains in an aborted transaction. Investigate rather than editing the assertion or accepting unexpected work.

After commit, replay the RPC once with the same verified `3600::smallint` expiry. It must return the original seven fields without extending the fence. A replay with a different smallint expiry must fail closed. Record only the contact-free aggregate receipt.

## Step 6: apply the final two migrations

Keep invitation delivery disabled. Use a clean detached worktree at commit `f55c10c000cb7d695f74b0ea06035723f63ab6e1`. Confirm the checkpoint digests.

The linked dry-run must list exactly, in order:

1. `20260720101000_advocate_branding_actor_authority.sql`
2. `20260720102000_advocate_staging_subdomain_reservation.sql`

Apply them, then require a zero-pending dry-run.

The final ledger checkpoint must report:

- Total migration rows: `103`
- Maximum version: `20260720102000`
- Release migration rows from `20260716133000`: `68`
- Source full-set SHA256: `7e4f0c9b5bb900c8fed721520fcd8549510c9ee189f2c8d88a8390abb3f75854`

Verify the staging reservation and zero assignment:

```sql
SELECT
  count(*) FILTER (
    WHERE label = 'advocate-staging'
      AND reason =
        'Reserved for the isolated Creator Share advocate staging tenant root.'
  ) AS exact_reservation_rows,
  (
    SELECT count(*)
    FROM public.advocates
    WHERE slug = 'advocate-staging'
  ) AS assigned_advocate_rows,
  (
    SELECT count(*)
    FROM public.advocate_domains
    WHERE hostname = 'advocate-staging.creatorshare.com'
  ) AS assigned_domain_rows
FROM public.advocate_reserved_subdomains;
```

The expected result is `1, 0, 0`.

Run the full database suite and the focused invitation proof quarantine concurrency gate before deployment. Preserve only sanitized gate evidence as defined in the linked runbooks.

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

Version count and maximum version are also insufficient by themselves. Integrity requires the clean pinned source commit, exact source full-set and tranche digests, exact ordered CLI migration membership, zero-pending checkpoint result, migration-specific postconditions, and the required database tests. If any of those facts disagree, stop even when the ledger count looks correct.

## Step 7: deploy the fail-closed Vercel boundary

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

## Step 8: attach only the two exact staging hostnames

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

## Step 9: exact-host Auth, email, routing, privacy, and cleanup canaries

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
| Before the foundation tranche                               | Stop with no database change. Preserve the complete caller audit and release ledger.                                                                                                                            | Do not repair or rewrite the existing migration ledger.                                                                                                        |
| After 1 through 64 of the 65 foundation migrations          | Keep every capable caller paused, capture the exact ledger and failure state, and use only a reviewed forward recovery from that exact boundary. Deploy no application.                                         | Do not run a down migration, replay an applied file, blindly rerun the tranche, or route any old application to the partial schema.                            |
| After all 65 foundation migrations, before cutover          | Leave the schema installed and invitation delivery disabled. Resume only with a reviewed compatible application and cutover plan. The duplicate role deletion and open-beneficiary status repair are permanent. | Do not describe the schema as additive, restore deleted duplicate assignments, reverse repaired beneficiary state from a backup, or use an unproven old app.   |
| Cutover migration failed with ledger still at 100           | Keep every invitation caller paused, prove the failed transaction is absent, correct the environmental cause, and obtain approval before retrying the exact unchanged file.                                     | Do not repair migration history or infer rollback from the CLI exit alone.                                                                                     |
| Cutover migration committed with ledger at 101, before arm  | Keep delivery disabled and continue forward through the reviewed arm and quarantine sequence.                                                                                                                   | Do not recreate the retired four-argument claim RPC.                                                                                                           |
| After arm, before quarantine                                | The arm is immutable. Keep delivery disabled, complete the database-enforced 70-second drain, then quarantine.                                                                                                  | Do not unarm, edit the singleton receipt, or run arm and quarantine in one transaction.                                                                        |
| After quarantine                                            | Keep the migration and immutable receipt. Use only a compatible shared-issuer application, or keep delivery disabled until one is available.                                                                    | Do not restore the old worker, clear recipient fences, retry quarantined rows, or restore a database backup across external email state.                       |
| After only the first of the final two migrations            | Keep every deployment and hostname detached. Capture the exact 102-row ledger with maximum version `20260720101000`, then use reviewed forward recovery for the staging reservation migration.                  | Do not deploy, attach a hostname, edit the applied branding migration, or pretend the two-file checkpoint completed atomically.                                |
| After both final migrations                                 | Roll an application only to a commit independently proven compatible with all 103 migrations while every worker remains fail closed.                                                                            | Do not delete the branding authority migration or staging reservation, and do not use an unproven old application.                                             |
| After first Production deployment, before domain attachment | Keep the nine overrides and disabled provider mode. Replace the deployment only with another reviewed fail-closed build. Preserve all deployment, invocation, and schedule evidence.                            | Do not assume deployment rollback removes the 11 installed schedules, delete the project to hide evidence, or point the production Creator Share project here. |
| After Vercel domain objects, before Cloudflare DNS          | Detach only the two new exact domain objects and verify their absence.                                                                                                                                          | Do not add a wildcard, transfer a production hostname, or create DNS to diagnose a platform ownership conflict.                                                |
| After Cloudflare DNS creation                               | Remove both exact DNS records first and verify authoritative absence. Then detach the two Vercel domain objects and preserve the failed certificate and routing evidence.                                       | Do not detach Vercel first while DNS can still route, proxy the records, or retarget them to another project.                                                  |
| After hosted Auth, email, invitation, or payment activity   | Use scoped forward cleanup and the linked runbook procedures. Preserve immutable receipts and external handoff evidence.                                                                                        | Do not destroy the dedicated project, force-delete ambiguous canary state, delete unrelated mailbox data, or use the pre-release backup as a blind rewind.     |
| After invitation schedule authorization                     | Restore a new distinct invitation override in a reviewed deployment to deny future scheduled claims, then classify any in-flight claim or handoff before further action.                                        | Do not assume changing an environment value terminates an old invocation, revoke evidence prematurely, or reintroduce the retired direct-proof worker.         |

Every migration in this release is forward only once committed. If uncertainty exists, the safe state is the exact current schema with every caller paused or fail closed. A serverless platform can preserve old code after a deployment, and an email provider can accept work before the application receives its response. Neither ambiguity is solved by restoring yesterday's database.

## Completion checklist

The staging migration and deployment boundary is complete only when:

- The release ledger contains all four migration checkpoints and all three post-write ledger digests.
- The 65 plus 1 plus 2 split was observed exactly.
- The pre-foundation and post-foundation evidence records the duplicate role-assignment deletion set and the open-beneficiary repair set.
- Drain A was completed, or the complete virgin dedicated-project exception was approved with evidence.
- Drain B began from the committed database arm timestamp and lasted at least 70 seconds.
- The immutable quarantine receipt contains the exact expected zero counts and 3,900-second fence.
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
