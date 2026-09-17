# Advocate Platform implementation review

Review baseline: GitHub PR 127, head `03806587621477ef8c86b946e59431b053f5a9d5`, base merge commit `201ae2dc68f75c5b1d02c78dbcc2ac1c98f0adce`.

## Scope and authority

The owner confirmed on September 17, 2026 that none of this PR's migrations have been applied to production or staging. The new migration series may be consolidated or redesigned. Existing base migrations and their data upgrade path must remain supported.

Feature parity with the GitHub PR remains required. Product scope reductions require separate approval. Production provider operations and publication are outside this review's authority. Local services must remain stopped unless explicitly authorized under the workspace's September 14 directive.

## Review sequence

1. Establish current source, dependency, and validation baselines.
2. Trace payment creation, settlement, identity claims, and tenant authorization across application and database boundaries.
3. Remove unreachable application implementations and consolidate undeployed schema revisions without weakening invariants.
4. Review public and private projections, retention, invitation delivery, and operational recovery.
5. Simplify browser state and validation tooling; resolve current CI failures with behavioral evidence.
6. Validate the final implementation and reconcile release documentation with actual evidence.

## Baseline evidence

The current GitHub head has two failing required workflows. Publication authority database tests stopped at the dev server lane, before database setup or database tests. Catalog recovery in WebKit failed in its first browser step. Production build, lint, and the provider-free lane passed in that publication workflow. These historical results do not establish that the current database or browser gates pass.

The local development and advocate checkouts contain unrelated uncommitted work and were left intact. Review changes live in an isolated checkout fetched directly from GitHub.

The release manifest's offline lane means provider-free, not server-free. Several fixtures start Next.js servers internally even with `PW_NO_WEBSERVER=1`. Local validation must select only inspected server-free tests until service startup is authorized.

## Findings under investigation

- Removed the first-generation Stripe checkout and transaction orchestrator after confirming no production callers. Six existing behavioral tests now exercise the live v2 checkout. Two tests specific to the obsolete orchestrator were removed; the live Stripe and PayPal recovery suites remain. Net reduction: 392 lines across application code and tests.
- The PR adds 68 database migrations containing repeated function definitions and historical cutover machinery. Consolidation must preserve final grants, function security attributes, trigger ordering, base-data transformations, and enum transaction boundaries.

## Release status

Not merge-ready. Review and validation are in progress. Hosted provider canaries and physical-device evidence remain separate from repository validation.

## Validation checkpoint

- 44 focused Stripe and PayPal checkout tests passed.
- 1,558 tests passed across 150 inspected server-free files, one worker, zero retries. Eight files from the provider-free lane were excluded because they contain process or server operations requiring separate inspection or startup authority.
- TypeScript compilation and scoped lint passed.
- A temporary in-process PostgreSQL replay reached the final migration. It uses minimal Auth and Storage schemas and geographic substitutes, so it supports structural comparison only. It does not establish hosted behavior, geographic correctness, RLS persona coverage, or concurrency correctness.

## Product deferral recommendations

All capabilities remain in scope unless the owner approves a change.

| Candidate | Implementation savings | Product consequence |
| --- | --- | --- |
| Post-visit attribution and year-long observation | Exposure collection, cross-origin visitor coordination, retention, and attribution-specific reporting | Credit is limited to checkouts begun on an advocate portal |
| Advocate-selected public metrics | Public disclosure ledger, delayed releases, worker, and editor | No public fundraising counters at launch |
| Self-service delegate invitations | Advocate invitation issuance, delivery recovery, and team invitation UI; sponsor authentication still needs its own proof controls | Creator Share staff provision access |
| Rich text editing | Editor state and formatting behavior; plain text must still be escaped | Branding supports plain text, logo, and colors |

Defer public metrics first if scope reduction is approved. Post-visit attribution offers a broader simplification but changes the advocate proposition substantially. Preserve payment correctness, tenant isolation, private-data protection, and cancellation support.

## Schema consolidation checkpoint

The first schema cleanup consolidates 44 repeated function definitions. See [the consolidation record](./advocate-schema-consolidation.md) for the affected functions, structural comparison, legacy-data fixture comparison, and validation limits. This is a candidate awaiting real Supabase validation, not a completed release gate.
