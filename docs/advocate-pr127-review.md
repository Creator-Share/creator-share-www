# Advocate Platform implementation review

Review baseline: GitHub PR 127, head `03806587621477ef8c86b946e59431b053f5a9d5`, base merge commit `201ae2dc68f75c5b1d02c78dbcc2ac1c98f0adce`.

## Scope and authority

The owner confirmed on September 17, 2026 that none of this PR's migrations have been applied to production or staging. The new migration series may be consolidated or redesigned. Existing base migrations and their data upgrade path must remain supported.

The owner explicitly prohibited merging into `dev` on September 17, 2026. Review commits may update the PR branch; no merge or branch-protection mutation is authorized.

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

## Canonical currency guard

`isSupportedCurrency` normalized case before returning a TypeScript type predicate, incorrectly narrowing lowercase strings to an uppercase-only union. The PayPal billing catalog used that predicate without normalizing the returned value. The guard now checks canonical values exactly; the existing user-input coercion still normalizes lowercase currencies. The new regression fails on the original guard. All 12 server-free currency and catalog tests, 1,569 selected server-free tests, TypeScript, and lint passed. The currency endpoint test requires the hosted dev-server lane; no local server was started.

## Hosted validation of d42eb98

[Publication workflow 35179157120](https://github.com/Creator-Share/creator-share-www/actions/runs/35179157120) and [WebKit workflow 35179159010](https://github.com/Creator-Share/creator-share-www/actions/runs/35179159010) passed. Both independent application and database jobs completed successfully, including the provider-free and dev-server lanes, second migration consolidation, complete pgTAP suite, HTTP integration, all required concurrency harnesses, and forced cleanup. This also verifies the invitation form's delayed-JavaScript regression. Later helper removal, cancellation, cookie fallback, exact-origin, and currency changes await their own hosted revision.

## Shared strict request decoding

Thirteen request readers now share one bounded UTF-8 stream implementation. Each route retains its original Content-Length grammar, byte limit, and empty-body behavior. The helper rejects malformed UTF-8, counts streamed bytes, releases reader locks, and does not wait for producer cancellation after rejecting a body. This removes repeated chunk buffering and byte-array concatenation. Regression coverage checks split characters, truncated and malformed UTF-8, byte limits, locked and failed streams, and a cancellation callback that never settles. All 1,572 selected server-free tests, TypeScript, and lint passed. Hosted validation remains required for this revision.

The remaining team mutation, OTP verification, sponsor management, and cancellation readers now use the shared strict decoder. Malformed UTF-8 is rejected instead of silently becoming replacement characters in authentication input. Logo uploads and both payment webhook readers now reject oversized streams without waiting for cancellation cleanup; webhook-specific error classifications and payload erasure remain intact. Regression coverage exercises indefinitely pending cancellation for all three paths. All 1,576 selected server-free tests and TypeScript passed.

## Hosted validation and current base integration

[Publication workflow 35180038177](https://github.com/Creator-Share/creator-share-www/actions/runs/35180038177) and [WebKit workflow 35180039663](https://github.com/Creator-Share/creator-share-www/actions/runs/35180039663) passed on `67f86b5`, including the cookie fallback, exact provider origins, canonical currency, and cancellation fixes. The subsequent shared request reader changes require their own hosted validation.

The current `dev` base advanced to `8ee1a91` with the primary site's social preview. Its root-layout conflict is resolved by returning the new metadata only for the primary site, preserving advocate branding and the neutral, nonindexed payment shell. All 17 focused presentation and staging tests, the production build, and the Edge middleware gate passed. GitHub still reports `dev` as unprotected; the checks are not an enforced merge requirement.

## Direct first-release invitation installation

The owner confirmed that no Advocate migration has been applied to staging or production. The invitation outbox is created by this PR, so the one-time migration from its older worker has no deployed source state. Removed that quarantine table, three legacy fields, guard wrappers, arm and quarantine RPCs, and the concurrency harness dedicated to that retired cutover. Current shared-issuer reservations, recipient proof fences, ambiguous SMTP handling, immutable settlement receipts, and tenant authority tests remain. The release instructions now install the complete reviewed series instead of historical intermediate commits.

Strict structural replay removes exactly 40 cutover catalog entries and changes only the bodies of ten related functions. Retained function grants and other security attributes are unchanged. Eight representative legacy-data projections remain identical. All 1,576 server-free tests pass. This is a candidate awaiting the full hosted database suite and remaining concurrency harnesses, tracked in FF-069. It is not an upgrade path for an already applied Advocate migration series. Target inspection must stop if it contradicts the declared undeployed state.

## Remaining compatibility review

After consolidation, six function-definition groups still repeat within the same name and signature generation. They total 563 earlier definition lines and include migration-time audit context, later table dependencies, and SQL functions whose creation validates dependencies. Their deletion is not established as safe.

The payment runbook also distinguishes two histories that need separate treatment. The four prepare, quote, begin, and attach compatibility RPCs originate inside this undeployed PR. The primary site's older Stripe and PayPal return endpoints predate the PR and may still receive existing customer returns. Removing the former must not imply removing the latter. Current v2 SQL also calls private core implementations renamed from those earlier definitions. No payment compatibility surface has been removed by this investigation.

## Hosted validation of direct first-release installation

[Publication workflow 35181492354](https://github.com/Creator-Share/creator-share-www/actions/runs/35181492354) and [WebKit workflow 35181492346](https://github.com/Creator-Share/creator-share-www/actions/runs/35181492346) passed on `f6293f8`. The full database suite passed all 63 files and 2,110 assertions. Current invitation claims, shared proof issuance, initial-owner authority, publication authority, branding races, HTTP integration, and forced cleanup passed without the retired cutover harness. FF-069 is complete. Hosted provider canaries remain separate.

## Required secret detection candidate

The application gate now checks complete Git history with Gitleaks 8.30.1, installed from checksum-pinned official release bytes. It requires full Git history, ignores inline suppression comments, redacts complete secret values, and fails if a synthetic credential is not detected. The local evaluation scanned 856 commits. Thirty findings were exact public identifiers or synthetic fixtures; three were historical Telegram credential occurrences removed before this PR, with rotation recorded in commit `91db88d`. That historical record is not fresh provider-side revocation evidence.

The configuration retains all default detection rules. Public-value exclusions match exact strings. Synthetic provider fixtures also require exact test paths. Historical exclusions match only three commit/file/rule/line fingerprints; a reintroduction remains detectable. No test directory, production source directory, or complete commit is excluded. The full-history scan, synthetic positive and negative controls, and all 99 provider-harness contracts passed locally. A fixture copied outside its allowed path was rejected. Hosted validation of the new step is pending under FF-056.

## Required-check policy preparation

Both validation workflows now run for every pull request targeting `dev`. Path filters would otherwise leave an expected required check pending when a PR changes only unmatched files. Four release-tooling regressions, the 99 provider-harness contracts, TypeScript, and lint pass. The secret scanner step passed on GitHub in publication run `35182345377` at `87399c7`; the rest of that workflow is still running.

[The proposed branch-protection payload](./dev-required-checks.json) requires `Publication authority database tests` and `Catalog recovery in WebKit` from the observed GitHub Actions app ID 15368, requires an up-to-date base, applies to administrators, and disables force pushes and branch deletion. It adds no review-count requirement or user/team push restriction. It has not been applied. The repository currently has seven other open PRs targeting `dev`, and these workflows are not yet in `dev`; applying the policy before PR 127 merges would prevent those other branches from merging until they produce the new checks. Repository-wide enforcement needs owner authorization and a coordinated activation point.

## Hosted validation of the secret-detection gate

[Publication workflow 35182345377](https://github.com/Creator-Share/creator-share-www/actions/runs/35182345377) and [WebKit workflow 35182345403](https://github.com/Creator-Share/creator-share-www/actions/runs/35182345403) completed successfully on `87399c7`. This supersedes the pending status above for that revision. Commit `18584a6` subsequently removes workflow path filters and awaits its own hosted results. No repository protection setting was changed.

A consolidated [findings report](./advocate-review-findings.md) separates repaired defects, remaining release evidence, and product decisions from this chronological investigation record.

## First-release checkout RPC retirement candidate

Removed the four unused public first-generation prepare, quote, begin, and attach wrappers. Current v2 interfaces and their private shared payment cores remain unchanged. Existing low-level business tests now call those cores as database-owner fixtures; public permission assertions target v2. Four obsolete wrapper rejection assertions now prove that the old public function is absent, the retained core exists, and no anonymous, authenticated, or service API role can execute it. The authenticated quote denial still invokes the current public v2 function.

Strict structural replay removes exactly four function entries and changes only the release-gate result. Every other catalog entry and all eight legacy data projections match. All 13 changed SQL files parse, and 1,576 selected server-free tests pass. Hosted database and concurrency validation remains mandatory under FF-070.

The release runbook no longer demands a drain migration for RPCs that were never deployed. It also corrects a separate unsafe retirement criterion: draining old application instances does not prove that customers cannot return from older provider sessions. Pre-PR Stripe and PayPal return endpoints remain until a separate provider-session inventory and recovery policy justify removal.

## Complete retention evidence candidate

The retention worker accepted obsolete three- and four-field sponsor-authentication results, reporting missing invitation-attempt and shared-proof cleanup counts as zero. Those intermediate versions exist only in this undeployed PR. The worker and database ledger validator now require all five current counters. The obsolete private count validator is also removed; its current replacement remains inaccessible to API roles.

Two regression cases fail on the original worker and pass after the change. They verify that the incomplete step is reported as failed, no partial counts become evidence, and advocate tracking cleanup still runs. All 21 retention tests, TypeScript, and lint pass. Structural replay removes exactly one unused function, changes only the current count-validator body, and preserves all other catalog entries and eight legacy data projections. FF-071 tracks the remaining hosted database validation.

## Checkout retirement hosted fixture correction

Publication run `35183402727` reached all 63 pgTAP files but failed when the sponsor recent-authentication fixture attempted a private core call as `service_role`. The new privilege boundary correctly rejected it. That fixture now seeds its pre-v2 payment state as the database owner, then switches back to `service_role` before public gateway ingestion, settlement, and sponsor-management assertions. No production grant was widened. The other pgTAP files passed; the complete suite and later harnesses still require a successful rerun. The corrected revision also includes the pending strict-retention candidate.

## Exact decimal checkout arithmetic candidate

The application used binary multiplication for rates that PostgreSQL validates as decimal numeric. Reproduced `2500 * 0.6134` rounding to 1,533 in JavaScript and 1,534 in PostgreSQL. A shared bounded minor-unit helper now rounds the exact serialized decimal rate with integer arithmetic. It handles scientific notation and returns an invalid numeric result for malformed inputs or unsafe output, preserving fail-closed callers without adding a dependency.

Applied it to fresh conversion, both sealed provider request validators, shared Stripe/PayPal checkout recovery, and PayPal payment and adjustment boundary checks. This does not change the partial-refund allocation policy or fix FF-072. Both new provider regressions fail on the old code. The full selected server-free suite passes 1,580 tests; 20 focused currency/provider tests and 42 recovery/webhook tests pass. TypeScript and lint pass. A separate in-process PostgreSQL numeric comparison matches all 1,600 amount/rate cases. FF-073 remains open until hosted validation passes.

## Hosted validation of checkout retirement and retention

[Publication workflow 35183888657](https://github.com/Creator-Share/creator-share-www/actions/runs/35183888657) and [WebKit workflow 35183888681](https://github.com/Creator-Share/creator-share-www/actions/runs/35183888681) passed on `bb92a25`. All 63 pgTAP files passed with 2,110 assertions, followed by the HTTP integration and all required concurrency and cleanup harnesses. The application gate passed 1,676 offline tests, 65 dev-server tests, and the 99-test provider contract. FF-070 and FF-071 are complete. The decimal arithmetic candidate `30a2370` requires its own hosted validation, and the partial-adjustment finding FF-072 remains open.

## Payment audit ingress consistency candidate

Six payment and sponsorship routes preferred `cf-connecting-ip` even though the approved Cloudflare topology is DNS-only. Executing the original Stripe context reader with conflicting headers selected the forged Cloudflare address instead of the Vercel address. A shared forensic reader now records a validated single `x-vercel-forwarded-for` address and bounded `x-vercel-id` only in the Vercel runtime. Other proxy assertions are not fallback evidence. User-agent metadata is byte bounded and control-character checked. Matching and self-assignment now generate request IDs instead of accepting an arbitrary client header.

This aligns the affected routes with the existing invitation and cancellation trust model and [Vercel's request-header documentation](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for). Four new regressions cover competing headers, absent trusted ingress, invalid or multiple addresses, IPv6, byte limits, and control characters. All 1,584 selected server-free tests, TypeScript, and lint pass. This protects audit evidence; no authorization or rate-limit bypass was established. Hosted validation remains pending under FF-074.

## Partial adjustment failure consequences

The unrepresentable foreign-currency adjustment fails after provider payment evidence is verified. Both webhook routes quarantine permanent evidence failures and acknowledge receipt. The provider's refund is not prevented or reversed by this application failure; the local financial movement is missing until the issue is repaired and the retained event is reconciled. This can overstate locally reported net funds. The correction needs a recovery path for already quarantined events, not only acceptance of future deliveries.

The settlement function already serializes adjustments by original movement using `pg_advisory_xact_lock`; its later row share lock is not evidence of a missing concurrency fence. Preserve that lock and committed replay behavior when changing allocation. A naive cumulative net calculation also needs care around interleaved dispute credit: debit one AUD cent, refund one cent, then restore the disputed cent can otherwise restore a different USD amount than the original dispute debit. That policy detail remains part of the owner decision and coordinated ledger design.

## Decimal arithmetic browser-fixture correction

Publication run `35184592681` passed its database job but failed the application job because the checkout fixture targeted ES2017 and rejected BigInt literals during type checking. The production build passed, as did WebKit run `35184592734`. The fixture now uses the production TypeScript target, ESNext. Its production-mode build passed locally without starting a website server, and its tracked configuration was restored after the build. The full hosted application and checkout browser gates still require a rerun. This revision also carries the pending forensic-context fix.

## Shared administrative forensic reader

Portal mutation, invitation, Creator Share lifecycle, and sponsor cancellation contexts now reuse the same ingress reader. This removes four more parsers and closes the administrative readers' missing Vercel runtime check. Oversized user-agent values are unavailable rather than silently truncated. The lifecycle regression explicitly checks a valid-looking Vercel IP header outside Vercel. All 1,584 selected server-free tests pass; the new focused assertion, TypeScript, and lint are checked separately. Hosted validation remains part of FF-074.

The [partial adjustment decision draft](./advocate-adjustment-accounting-decision.md) provides the pending owner's policy decision with an implementation map and executable arithmetic counterexample. It changes no financial behavior.

## Hosted decimal and payment forensic validation

[Publication run 35185296016](https://github.com/Creator-Share/creator-share-www/actions/runs/35185296016) completed successfully on `7cae034`, including both application and database jobs. The corresponding WebKit run `35185295959` also passed. This closes the decimal arithmetic candidate FF-073 and validates the six payment-route forensic changes. The administrative parser extension in `82c1b14` still requires hosted validation under FF-074. The partial adjustment accounting defect FF-072 remains open.

A further retention migration consolidation removes 189 net lines with exact final catalog and legacy fixture equality. Hosted validation of this latest consolidation is pending.

## Final-definition migration cleanup candidate

Removed 413 net SQL lines by retaining final definitions and their grants at valid dependency sites, moving the retention step vocabulary before its first use, and eliminating one intermediate audit actor-context version. Strict replay validates all function bodies and matches all 5,280 final catalog entries plus legacy fixture data byte for byte. The early audit actor-context implementation remains necessary for migration-time callers before the publication transport table exists. Hosted validation is pending; no product scope or final schema changed.

## PostCSS issue closure

The dependency refresh resolves the application and sanitize-html to the same installed PostCSS 8.5.28 package. Complete publication and WebKit logs for `7cae034` contain no `Package postcss can't be external` warning. The hosted production build, dev-server lane, and both browser overlays passed. FF-061 is complete; its earlier recommendation to retain the warning until a deliberate dependency refresh is superseded by this measured result.

## Private analytics longitudinal disclosure reproduction

Executed the actual private analytics function against the existing fixture structure with five unique historical contacts contributing 100 USD cents each and a sixth contributing 733 cents in the next reporting day. The initial official snapshot returned five contacts and 500 cents, unsuppressed; advancing only the function's reporting cutoff by one day returned six contacts and 1,233 cents, also unsuppressed. The difference discloses the sixth contribution exactly. This is an in-process SQL reproduction, not hosted authorization evidence. No identity is directly returned. FF-034 now tracks this as a current MVP P1; a reporting freshness/privacy decision is pending.

The preceding `e1f811e` checkpoint passed publication run 35185951229 and WebKit run 35185951267. FF-074 is complete. The 413-line final-definition cleanup still requires its own hosted run.

## Existing-contact privacy counterexamples

The same production analytics query also discloses isolated refunds and renewals after five contacts already support the measure. With no new sponsorship or contact, the refund execution changed disclosed refunds from 50 to 57 cents and net from 450 to 443. The renewal execution changed renewals from 50 to 57 and gross/net from 550 to 557. Both snapshots remained unsuppressed. This rules out a repair that gates only new contacts or hides only a single financial field while leaving its complement visible. Reporting behavior remains unchanged pending the owner decision.

## Unused application export cleanup

A repository-wide identifier and import review found three unimported modules: the old PayPal financial metadata encoder/parser, image-transformation helpers, and unused icons. It also found an uncalled goal-fulfilled email template, unused media wrappers, two constants, two type aliases, and an unused default PayPal dependency object. Removing them and their unused imports reduces application code by 449 net lines. Generated database types remain intact, and active pre-PR payment-return handlers are unchanged.

All 1,584 selected server-free tests, TypeScript, lint, and Git whitespace checks pass. No new service, browser server, provider, or email was started. Hosted validation remains pending for this application cleanup. The existing invitation and payment compatibility contracts remain required.

## Release checklist reconciliation

The completion audit and manual checklist now foreground the two confirmed financial and privacy implementation blockers. The historical caller audit is explicitly historical: its missing-project observation predates recorded project creation. Removed the obsolete complete-lifetime/virgin-exception prerequisite belonging to the deleted invitation cutover. Current target-ledger verification, unexpected-state reconciliation, capable-caller inventory, and migration-time caller isolation remain required. No deployment, provider configuration, or merge was performed.

## Final migration cleanup validated

Publication run 35186695547 and WebKit run 35186695502 passed on `ff01da5`, including both independent application and database jobs and the aggregate gate. This validates the additional 413-line migration cleanup. A final application caller scan found one thumbnail stub whose only caller had just been removed; removing it brings the pending application cleanup to 456 net lines. Only generated database utility exports remain in the single-reference scan. That scan is a dead-code heuristic, not proof that every remaining export is necessary.

## Gateway quarantine observability candidate

Quarantine produces terminal ignored events outside ordinary worker claims, so current worker health can remain green while review-required payment evidence accumulates. Both provider ingestion boundaries now emit a sanitized error signal after a newly committed quarantine. Duplicate delivery and persistence failure emit no success signal. Two new regressions fail on the original implementation; all 55 focused ingestion tests, TypeScript, and lint pass. The signal includes no provider event/object identifier, contact, amount, signature, ciphertext, or raw error.

The payment runbook adds a protected aggregate inventory and monitoring-delivery canary. Payload retention remains 90 days; neither logging nor fixing future arithmetic repairs already quarantined events. FF-075 remains pending hosted and alert-delivery evidence, and FF-072 still requires an audited recovery path.

## Shared worker trace parsing

Seven worker routes now reuse the shared forensic reader instead of separate trace parsers. Six previously accepted alternate proxy assertions without the configured Vercel runtime; the invitation worker already applied that runtime boundary. The shared reader retains the worker paths' visible-ASCII trace restriction while leaving user-agent handling separate. Worker-generated request IDs remain available outside Vercel. Production code loses 58 net lines.

Retention and public-metric route tests now exercise both configured Vercel and non-Vercel callers. Retention fixtures use the production-valid cron credential when VERCEL is enabled; dedicated retention credentials are correctly rejected in that runtime. All 39 focused tests, 1,588 selected server-free tests, TypeScript, lint, and Git whitespace checks pass. Hosted validation remains pending for this follow-up and the quarantine signal.

The preceding application cleanup passed publication run 35187383041 and WebKit run 35187383042 on `8fecade`. The 456-line application deletion is now hosted-validated.

## Measured product deferral recommendations

Measured the dedicated application surfaces and checked shared dependencies before refining the requested deferral recommendations. Public impact counters remain the clearest first option. Staff-managed delegate invitations are less attractive as a code-reduction strategy: initial-owner onboarding still needs shared proof and delivery machinery, while staff administration needs its own audited authority boundary. Plain-text branding affects only 390 lines in its dedicated editor and validator. The new deferral analysis distinguishes file footprints from promised savings and explicitly states that public-counter deferral does not repair private analytics disclosure. No capability has been removed.

## Database forensic hop correction

The audit identity reader prioritizes auth.uid over context actor identity when present; this review did not establish an actor-identity bypass. A separate capture defect was reproduced: explicit empty application IP and user-agent context still produced a forensic row containing synthetic PostgREST hop headers. Removing those fallbacks makes the same trigger execution produce no forensic row while preserving the business audit event.

Strict replay changes only audit.capture_row_change among 5,280 catalog entries and leaves representative legacy data identical. Added two pgTAP assertions for absent context and explicit application evidence with its exact 90-day expiry. This does not claim hosted authorization validation; the next database gate must run those assertions. FF-076 records the pending correction, and the roadmap now distinguishes row-audit context from infrastructure transport logs.

## Hosted operational evidence

Publication run 35188193933 and WebKit run 35188193834 passed on `b812f8c`, including both independent jobs and the aggregate gate. The quarantine signal and shared worker trace parsing are hosted-validated. FF-075 remains open for actual configured alert-delivery evidence; the database forensic correction FF-076 needs the next hosted database gate.

## Partial-adjustment amount-domain measurement

Executed the active Stripe deriveProportionalBaseUsdCents helper over every positive partial amount below original charges normalized to 2,500 USD cents, using the current configured rates. USD accepted 2,499 of 2,499; GBP accepted 1,849 of 1,849; EUR accepted 2,149 of 2,149. AUD rejected 1,000 of 3,499, including whole-dollar refunds of 1, 6, 8, 13, 15, 20, 22, 27, 29, and 34 AUD. The scan resets to the untouched original payment for each amount and makes no provider call. It quantifies the single-adjustment representability defect, not real-world event frequency or cumulative settlement correctness. The accounting decision draft now includes these limits and results.

## Hosted database expectation repair

Publication run 35188935007 failed on the database job while its application job and WebKit run 35188935099 passed. The foundation suite ran all 80 assertions but still declared 78. The invitation suite retained an older assertion requiring the removed PostgREST network fallback. Corrected the count and changed that assertion to require absent forensics while preserving every signed-session, actor, request, tool, reason, and operation check. Synthetic hop headers and caller-supplied network values remain in the fixture so either unsafe source would fail the assertion. Hosted database validation must pass before FF-076 can close.

## Key rotation implementation inventory

Confirmed that numbered fields do not imply multi-key support: the application loads one sponsorship root key, envelope validation expects its fixed header, and email identity constraints plus claim functions reject later HMAC versions. The root also derives deterministic checkout receipts. The existing runbook already prohibits replacing its value. Recorded the coordinated rotation and recovery limitation in the findings without inventing a new cryptographic design or changing identity semantics.

## Retention visitor lookup index

The existing exposure index required `is_qualified`, while the tracking purge's visitor existence check and visitor foreign-key cleanup must consider every exposure. Broadened that index to every nonnull visitor ID instead of adding a second index. Qualified attribution lookups retain the same leading visitor and descending-time keys; excluded exposures now consume index space too.

A 100,000-row in-process planner probe using the same visitor index and lookup predicate changed an absent visitor lookup from a sequential scan that filtered all 100,000 rows to an index-only lookup. This demonstrates index eligibility, not production workload latency or the full purge plan. Strict full migration replay changes exactly this one index among 5,280 catalog entries relative to the forensic correction and preserves all eight representative legacy data projections. Hosted database validation remains required.

The completion audit's obsolete closing claim that merging was merely a process decision has also been removed. Its table is explicitly historical; current financial and privacy findings govern release readiness.

## Legacy profile deletion integration finding

Both admin deletion route bodies are unchanged from the PR base. They delete public.users, while Advocate memberships reference auth.users. In a full migration replay, a synthetic analytics viewer had permission before profile deletion and retained both its Auth row and the same permission afterward. Normal triggers were enabled during deletion and both permission checks; only fixture construction bypassed triggers. FF-077 records the misleading offboarding boundary. Existing tenant suspension and revocation are the appropriate controls pending a coordinated global account lifecycle design. No live account or provider was changed.

## Hosted database forensic correction validated

Publication run 35189654393 and WebKit run 35189654400 passed on 4cc42a0. Both application and database jobs and the required aggregate concluded success. This closes FF-076 after the explicit count and invitation expectation repair. The subsequent visitor-index change must receive its own hosted validation. PR 127 remains open and draft, targeting dev; no merge was performed.

## Password login boundary repair

Two new route regressions failed on the current login implementation: an untrusted-origin request returned 200 and null JSON escaped as an uncaught TypeError. Added the same approved-primary-origin and JSON gate used by adjacent authentication routes, plus the shared strict body reader at 8,192 bytes and string credential checks. Authentication runs only after these checks. Removed the unused role query, whose result was ignored, and raw unexpected-error logging. Successful response and host-only identity behavior remain unchanged.

All 12 focused tests and 1,590 selected server-free tests pass, as do TypeScript, lint with zero warnings, and Git whitespace validation. Hosted validation remains pending. The profile-deletion reproduction was also strengthened: the actual analytics snapshot RPC returns an object both before and after profile removal, with the Auth row and permission intact. The owner account-lifecycle question is pending; no global deletion semantics were changed.

## Retention visitor index hosted validation

Publication run 35190442288 and WebKit run 35190442308 passed on 14dcc77. Both independent jobs and the aggregate concluded success. This validates the visitor-index change against the required hosted application, database, and browser lanes. The subsequent password-login correction passes local server-free checks and awaits its own hosted run.

## Sponsor assignment boundary repair

The self-assignment route used only a declared Content-Length bound and no origin gate. A route-level reproduction accepted both an untrusted origin and an oversized UTF-8 body without a truthful length header. Added the shared trusted-primary JSON boundary and bounded body reader. The existing caller already sends same-origin JSON. Database ownership checks and notification-on-first-assignment behavior remain unchanged.

Five route tests cover these regressions, authentication and identifier rejection, database denial, the authoritative RPC, and replay notification behavior. All 1,595 selected server-free tests, TypeScript, lint, and the release manifest verifier pass. The manifest now classifies 254 files, 243 required, with 160 offline entries. Hosted validation remains pending.

## Diagnostic provider authorization repair

The primary-site diagnostic endpoints were outside authenticated middleware prefixes and lacked route authorization. Email accepted a supplied recipient, Telegram used configured credentials, and test-child creation attempted writes under existing RLS. A shared guard now requires an approved primary origin and Creator Share super-administrator authority before every GET and POST handler. Same-origin GET fetches may omit Origin only with same-origin Fetch Metadata; cross-site and direct navigations are rejected.

Three denial regressions fail against the old routes. Five focused contracts preserve authorized email invocation and cover anonymous, ordinary-user, cross-origin, and navigation rejection without provider or database side effects. All 1,600 selected server-free tests, TypeScript, lint, and manifest validation pass. The manifest classifies 255 files, 244 required, with 161 offline entries. No real provider message or database write occurred. Hosted validation remains pending for this correction and the preceding assignment boundary.

## Password login hosted validation

Publication run 35191156280 and WebKit run 35191156285 passed on ce0ff91, including both independent jobs and the required aggregate. FF-078 is complete. The subsequent sponsor-assignment and diagnostic guards pass local checks but require a new hosted run. No merge into dev or live provider execution occurred.

## Shared administrator mutation origin guard

An AST inventory identified thirty role-only mutation calls without the explicit request guard used by newer routes. Migrated those calls to a shared request-aware administrator guard supporting JSON and multipart bodies. The diagnostic guard now delegates to that same origin implementation. Nine remaining role-only mutation call sites have their own explicit request guards; read handlers are unchanged.

The three-handler regression fails when their former role-only calls are restored, observing three authentication lookups for untrusted origins instead of zero. The corrected handlers pass, and a same-origin multipart request reaches normal image validation. The upload route uses the ordinary static Supabase import, avoiding its unnecessary dynamic-import seam. All seven authorization tests and 1,602 selected server-free tests, TypeScript, lint, and manifest verification pass. The authorization spec was renamed to reflect its broader scope without changing lane counts. Hosted validation remains pending. This does not claim a live-browser CSRF demonstration or change global account-deletion behavior.

## Beneficiary deletion integration reproduction

The authority review ruled out a suspected scoped SUPER_ADMIN bypass: the migration rejects existing scoped assignments and installs an insert/update guard. A separate deletion defect was reproduced. Current single and bulk routes remove dependent content before the beneficiary, while the new PayPal catalog and payment tables retain restrictive foreign keys.

In a full-schema in-process replay, a synthetic child with one activity, one media row, and a valid PayPal catalog reference remained after the beneficiary delete failed; its activity and media rows were gone. Triggers were disabled only for fixture setup, then enabled before all deletes. The failing final statement was isolated to model the separate route calls. No real storage objects were touched. FF-082 requires an atomic database deletion decision before storage cleanup, preserving the restrictive financial references and all-or-nothing bulk behavior.

Publication run 35192016933 and WebKit run 35192016482 passed on 98928f2, including both independent jobs and the aggregate. FF-079 and FF-080 are complete. The subsequent shared administrator guard needs its own hosted validation.

## Atomic beneficiary deletion candidate

The single and bulk routes now share one authenticated database command. It rechecks healthy global administrator authority and the live signed session, locks selected children in UUID order, and deletes database content in one transaction. Restrictive financial references remain authoritative. Storage cleanup receives candidates only after the RPC commits. Invalid and oversized batches are rejected before the command.

The original route regression fails by observing activity deletion, storage removal, media deletion, and then beneficiary deletion for both requests. The corrected routes pass all five contracts. Full-schema in-process execution preserves every child, activity, and media row after protected single and mixed bulk rejection, and returns cleanup candidates after successful deletion. All 1,607 selected server-free tests, TypeScript, lint, and manifest verification pass. The manifest classifies 258 files, 247 required. The hosted suite adds rollback and authority assertions plus four independently connected, server-observed financial-reference and account-ban interleavings. Those hosted checks are pending.

Storage cleanup remains best effort. A process crash, lost successful RPC response, or storage failure can leave orphan objects requiring reconciliation. The change prevents premature destructive cleanup; it does not claim durable object cleanup or exercise a real payment provider. No local service or live provider was started.

Publication run 35193169856 and WebKit run 35193169883 passed on ffe7337, validating the preceding shared administrator guard (FF-081). No merge into dev occurred.
