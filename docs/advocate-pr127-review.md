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

## Required CI isolation

Application build, offline contracts, and browser tests now run independently from the isolated Supabase database job. The existing required check name, `Publication authority database tests`, is retained as an aggregate requiring both jobs to succeed. A failed, skipped, or cancelled prerequisite cannot produce a successful aggregate. All 16 combinations of prerequisite outcomes are exercised against the actual gate shell. Provider isolation, loopback binding checks, mandatory database harnesses, and cleanup steps remain in place. Hosted execution remains to be verified.

The production build and Advocate Edge middleware artifact gate passed after allowing the build's existing Google Fonts download. No website server was started.

## Dependency security checkpoint

The authoritative Yarn graph initially reported 138 advisory findings, including critical Next.js image processing and Sharp native decoder advisories. These are package audit findings, not 138 demonstrated application exploits. Updated Next.js and its ESLint configuration to 15.5.24, Sharp to 0.35.4, sanitize-html to 2.17.7, and Nodemailer to 9.1.1. The Sharp update requires its exported `Metadata` type instead of the former namespace type.

Removed unused direct dependencies and their unused PayPal SDK declarations. The active Leaflet marker cluster plugin now declares its required `leaflet.markercluster` peer explicitly. Removed the stale npm lockfile; deployment and CI already use the declared Yarn 1.22.22 toolchain. The two lockfiles previously resolved different React versions.

Refreshed vulnerable transitive packages within their declared ranges. Two explicit security resolutions remain: PostCSS 8.5.28 replaces Next.js's exact 8.4.31 dependency, and `supabase/tar` 7.5.22 replaces the CLI's exact 7.5.13 dependency. Yarn reports these intentional exact-pin overrides during installation. Mailparser and ImapFlow development dependencies were updated within their existing major versions.

The refreshed Yarn audit reports zero known advisories across 723 dependencies. All 1,558 selected server-free tests and the production build, including TypeScript and the Edge middleware gate, passed. Browser and Supabase CLI compatibility still require hosted validation. A clean dependency audit does not establish application security.

## Hosted review checkpoint

Run 35176912563 independently executed both new jobs. Supabase startup, the complete pgTAP step, and the public catalog lane passed after migration consolidation. The HTTP browser test failed because a partial label locator also matched a tooltip. Later concurrency steps were skipped and remain unverified. The application browser fixture failed because its catalog tooltip requires a Chakra provider that the fixture did not supply. Both fixture defects have targeted repairs awaiting hosted validation. The aggregate required check correctly failed.

## Worker transport bounds

The logo cleanup fetch wrapper cleared its deadline when fetch returned response headers. A regression test proved that a stalled response body then had no deadline. Replaced manual timers and listeners with native abort signal composition, preserving both the invocation bound and cancellation supplied through Request or RequestInit. Storage error classification recognizes the native timeout outcome.

Provisioning's nominal response size limit previously buffered the entire response before checking JavaScript character count. The reader now enforces a byte limit during streaming and cancels rejected responses. A nonterminating multibyte response regression proves early rejection without relying on Content-Length. All 114 focused logo and provisioning tests passed without servers or provider calls.

The same response buffering weakness also appeared in payment readiness probes, publication payment canaries, PayPal billing catalog provisioning, checkout, webhook lookups, and cancellation error parsing. These now share `readBoundedResponseText`, preserving caller-specific failure classification. The reader counts raw streamed bytes, preserves split UTF-8 sequences, and propagates transport errors without exposing body content. The 1,561-test server-free suite passed after integration; the expanded provisioning suite passed all 67 tests, including three additional reader boundary cases. TypeScript passed.

Hosted run 35177735309 passed the full WebKit workflow on `b57ae52`. Run 35177733529 passed the repaired HTTP integration step and reached the database concurrency harnesses. These results precede the worker transport changes and do not establish final-head release readiness.

The shared PayPal client also lacked a default timeout for webhook verification and provider lookups. It now carries a 15-second deadline across OAuth acquisition and the API request, preserves earlier caller cancellation, refuses redirects, disables caching, and bounds the token response. Tokens must be nonempty bounded strings without whitespace or control characters. The combined server-free suite passed 1,565 tests; focused tests cover shared cancellation, request policy, and malformed token rejection. Lint and TypeScript passed.

## Hosted validation of b57ae52

[Publication workflow 35177733529](https://github.com/Creator-Share/creator-share-www/actions/runs/35177733529) and [WebKit workflow 35177735309](https://github.com/Creator-Share/creator-share-www/actions/runs/35177735309) passed. The publication log records 1,656 provider-free tests, 64 dev-server tests, 99 provider harness contracts, 15 seeded catalog tests, two Supabase HTTP tests, and all 63 pgTAP files with 2,131 assertions. Every required concurrency harness, PostgREST compatibility check, and forced-termination cleanup step succeeded. This validates the first schema consolidation, dependency update, CI isolation, and catalog fixture repairs on that revision. Subsequent worker transport fixes require their own final-head hosted run. Live provider canaries and physical-device evidence remain separate release requirements.

## Invitation hydration repair

Hosted run 35178462883 failed the recipient-correction browser test. Its screenshot shows the email populated but the previously entered access reason empty, leaving Send disabled. The initial server-rendered controlled inputs were editable before React attached handlers. Issue and revoke forms now disable their controls until hydration completes. A new browser test withholds JavaScript, asserts that inputs cannot be edited, releases scripts, and verifies successful entry and submission readiness. This repairs the production form rather than adding a timing delay to the test. Hosted execution of that regression remains required.

## Unreferenced helper cleanup

Removed eight exported helpers whose names occurred only at their definitions across tracked source, scripts, tests, configuration, and documentation. This includes unused country-based Stripe routing and its private parsing helpers, a duplicate PayPal repository factory, unused canary dispatch and provider predicate wrappers, and unused invitation and cookie helpers. No test was removed. All 1,565 selected server-free tests, TypeScript, and lint passed.

The Supabase bounded-fetch helper also replaced signals carried by Request inputs with its own timeout. A regression failed on caller cancellation before the repair and passed afterward. It now composes the Request signal with the timeout, matching its existing RequestInit behavior. All ten focused fetch and stateless-auth tests passed.

## Secure cookie fallback

The Supabase cookie helper documented an explicit loopback-only exception but also permitted nonsecure cookies when a nonproduction origin was absent or malformed. That fallback now requires Secure. The explicit HTTP loopback exception remains. Regression coverage rejects missing, malformed, credential-bearing, and whitespace-padded origins as reasons to weaken cookie transport security. The server-free suite passed 1,567 tests. This does not close the separate host-prefixed session migration tracked in FF-046.

## Exact provider redirect origins

Stripe Checkout and PayPal approval validators compared protocol and hostname but accepted nonstandard ports. They now compare the complete trusted origin, including the port. The PayPal publication canary uses the same exact-origin rule. Both checkout regressions failed on the original validation and passed after the repair; 36 focused checkout and canary tests, TypeScript, and lint passed. These are fail-closed provider-response checks, not evidence of a demonstrated external exploit.
