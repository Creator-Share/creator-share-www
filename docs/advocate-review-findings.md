# Advocate Platform review findings

Status: review in progress, September 17, 2026. The PR is not ready to ship: foreign-currency adjustment accounting, dispute loss bounds, and longitudinal private-analytics disclosure remain P1 blockers, and external release evidence is incomplete. No merge into `dev` is authorized.

The authoritative review baseline is PR 127 at `03806587621477ef8c86b946e59431b053f5a9d5`. The latest fully validated review revision is `dbf6ded`, including checkout RPC retirement, strict retention evidence, exact decimal arithmetic, shared forensic parsing, migration consolidation, application dead-code removal, and the quarantine signal. The database forensic correction, retention-index change, and password-login correction are hosted-validated. Sponsor assignment and diagnostic authorization are also hosted-validated. The shared administrator guard is also hosted-validated; atomic beneficiary deletion is now hosted-validated, while configured alert-delivery evidence remains external release work. Existing local checkouts were left intact; local services remain stopped.

## Repaired defects and unnecessary complexity

| Finding | Change | Evidence and limits |
| --- | --- | --- |
| A worker deadline ended at response headers, leaving stalled bodies unbounded. Several provider readers buffered the whole response before checking character length. | Keep cancellation active through body consumption and enforce streamed byte limits across provisioning, payment canaries, checkout, and webhook lookups. | Regression tests cover stalled bodies, multibyte limits, and inherited Request cancellation. Hosted application gates pass. This does not measure live provider availability. |
| Oversize request rejection could wait forever for producer cancellation. Some authentication readers silently replaced malformed UTF-8. | Share strict bounded decoding, reject invalid encoding, and make cancellation cleanup nonblocking. Preserve webhook-specific errors and payload erasure. | Pending-cancellation and malformed-input regressions; 1,576 selected server-free tests passed at the schema-cleanup checkpoint, followed by successful hosted application validation. |
| Provider redirect validation accepted a permitted hostname on an unintended port. | Validate the complete approved origin. | A nonstandard-port regression and hosted checkout tests pass. |
| Unknown nonproduction origins could weaken the authentication cookie Secure fallback. | Require Secure by default and retain only explicit local HTTP exceptions. | Focused cookie regressions and hosted validation pass. The separate app-wide cookie namespace decision remains open. |
| A currency type predicate accepted lowercase text while claiming it was a canonical uppercase currency. | Make the predicate exact; keep normalization in the input coercion function. | Currency and PayPal catalog regressions pass. |
| Invitation form inputs accepted typing before hydration, then lost that input. | Disable the controls until their component is ready. | Browser regression deliberately withholds JavaScript, verifies disabled controls, then checks retained input and submission after hydration. Hosted browser gates pass. |
| The dependency graph had known advisories and conflicting package-manager lockfiles. | Update affected dependencies, remove unused packages, declare the missing marker-cluster peer, and keep the deployment's canonical Yarn lockfile. | Recorded Yarn audit: zero known advisories across 723 dependencies. Production build and hosted browser/database tooling pass. Advisory counts are not exploit counts or a security guarantee. |
| The undeployed migration series repeatedly replaced the same functions. | Consolidate 53 function-definition groups within dependency and rename boundaries. | Structural comparison preserved the final catalog and representative legacy data; hosted Supabase, persona tests, and concurrency harnesses subsequently passed. |
| An extensive invitation cutover assumed an earlier version of this PR had been deployed. | Remove the obsolete quarantine table, legacy fields, compatibility wrappers, arm procedure, and cutover-only harness. Retain current proof fences, SMTP ambiguity handling, receipts, and authority controls. | Owner confirmed no Advocate migrations deployed. Structural replay removes exactly 40 obsolete catalog entries. Hosted suite passes 63 pgTAP files and 2,110 assertions plus remaining concurrency harnesses. Stop release if target inspection contradicts that premise. |
| Application test failures prevented database validation from running. | Run application and database jobs independently, retaining an aggregate check that requires both to succeed. | All 16 prerequisite outcome combinations tested; hosted runs exercised both failure and success. |
| Secret scanning was described as evidence but absent from required CI. | Add checksum-pinned full-history Gitleaks with positive and negative controls and narrow reviewed exceptions. | Actual hosted scanner step and full workflow pass. Three historical Telegram occurrences have exact fingerprints; recorded rotation is not fresh provider-side revocation evidence. |
| Required workflow path filters could leave checks permanently pending on unmatched PR changes. | Run both workflows for every PR targeting `dev`. | Four tooling regressions and 99 provider contracts pass locally. Hosted validation passed on `bb92a25`. |

At `b6f115d`, the review changes remove 27,919 lines and add 4,571, a net reduction of 23,348 across 179 files. This includes removal of the redundant 10,056-line npm lockfile. It is not a claim that 23,348 lines of application logic were eliminated. No product capability has been removed.

## Newly confirmed financial correctness findings

**P1: legitimate partial foreign-currency refunds can be rejected (FF-072).** The active Stripe adjustment helper rejects a two-cent AUD refund on a 3,500-cent AUD payment whose original normalized amount is 2,500 USD cents at the configured rate of 1.4. One USD cent converts to one AUD cent; two USD cents convert to three AUD cents. No integer input produces the required two cents. The problem also affects ordinary whole-dollar refunds: the active helper rejects a $1 AUD refund of that $35 AUD payment. An exhaustive single-refund scan rejects 1,000 of the 3,499 possible positive partial amounts at the current AUD rate; this is not a forecast of actual refund frequency. PayPal uses the same requirement, and SQL ingestion and settlement enforce it independently. This is not solved by relaxing the browser or one provider adapter. An existing test explicitly accepts rejection of unrepresentable currency slices, so green tests do not establish full refund parity. Both webhook routes quarantine this permanent evidence failure and acknowledge receipt. The provider can already have refunded the money while the local ledger omits the adjustment and overstates net funds. Repair must reconcile retained quarantined events as well as future deliveries.

The recommended repair preserves provider minor units exactly and allocates normalized USD cents cumulatively under the original-payment lock. It must allow zero-USD-cent deltas where appropriate and reconcile full refunds, repeated small refunds, dispute debits and credits, replay, and concurrent delivery. Independent rounding of each adjustment can overstate the total. An owner question about the accounting policy is pending; no financial policy change has been made. The [accounting decision draft](./advocate-adjustment-accounting-decision.md) records the affected boundaries, required invariants, and a dispute/refund interleaving that defeats naive cumulative rounding.

**P2: decimal and binary checkout rounding disagree at valid rates (FF-073).** JavaScript computes `Math.round(2500 * 0.6134)` as 1,533, while PostgreSQL numeric computes 1,534. The same mismatch occurs for 3,000 at 0.6255. Application conversion and recovery must agree with the database's immutable amount checks. This was reproduced with both runtimes, but not with the four currently configured rates. The candidate uses one exact decimal helper across conversion, sealed request validation, shared recovery, and PayPal boundaries. Both provider regressions fail on the old implementation. All 1,580 selected server-free tests pass, and 1,600 comparisons against PostgreSQL numeric match. Hosted publication and WebKit validation passed on `7cae034`; FF-073 is complete. This does not repair FF-072 or change refund allocation.

**Repaired P2 audit-evidence defect (FF-074):** six payment and sponsorship routes preferred caller-supplied Cloudflare IP headers despite DNS-only Cloudflare topology. The shared forensic reader now requires the Vercel runtime and a single valid ingress IP, removes other proxy fallbacks, and bounds metadata. Matching and assignment request IDs are server generated. A direct reproduction confirms the old precedence issue; four new regressions and 1,584 selected server-free tests pass. Hosted validation passed for these six routes on `7cae034` and the subsequent administrative parser extension on `e1f811e`. FF-074 is complete. This is an audit-integrity defect; no authorization bypass was established.

## Confirmed private analytics disclosure

**P1: consecutive daily totals reveal a single contribution (FF-034).** The actual analytics query returned five contacts and 500 USD cents, then six contacts and 1,233 cents at the next daily cutoff. Both responses were unsuppressed. Their difference exposes the new contact's exact 733-cent contribution, although it does not identify that contact by itself. Same-response cohort and complement checks do not prevent this longitudinal subtraction. Two further executions held contacts and sponsorships at five: refunds changed from 50 to 57 cents, while net fell from 450 to 443; renewals changed from 50 to 57 cents, while gross and net rose from 550 to 557. Both exposed one existing contact's seven-cent change without a new sponsor. The isolated reproduction used the current SQL function and fixture preparation, advancing only the reporting cutoff; hosted permission testing is separate.

The prior fast-follow treated this as future hardening before adding filters or exports. It affects the existing MVP. A [decision draft](./advocate-analytics-disclosure-decision.md) proposes preserving metrics while batching updates behind coordinated disclosure rules. That changes freshness for low-volume advocates, so the owner decision remains pending. No private reporting behavior has changed.

## Gateway quarantine operations

**P2 observability repair, monitoring delivery still pending (FF-075).** Verified gateway quarantines are acknowledged with HTTP 200 and stored as terminal `ignored` events. The ordinary worker excludes them, so its success does not establish an empty quarantine. The new candidate emits a sanitized signal only after a newly committed quarantine; it exposes no financial or provider-object details. Two regressions fail on the old implementation, and all 1,586 selected server-free tests, TypeScript, and lint pass. Hosted validation passed on `b812f8c`; configured alert-delivery evidence remains pending.

Encrypted gateway payloads, including quarantined ones, expire after 90 days. The payment runbook now provides a protected aggregate inventory and requires operator investigation before expiry. The accounting repair still needs an audited reconciliation path; neither log monitoring nor provider redelivery alone is a demonstrated recovery mechanism.

## Database forensic provenance

**P2 correction pending hosted validation (FF-076).** The row-audit trigger replaced missing application IP and user agent with PostgREST request headers. An isolated execution reproduced that substitution after the application explicitly supplied neither field. Capture now preserves missing evidence instead of recording a different request hop. Strict replay changes only the capture function and preserves legacy data; two database assertions cover absent and explicit context, including retention. No actor-identity bypass was established. Direct database transport evidence remains in managed infrastructure logs.

## Remaining implementation review

The application uses v2 checkout RPCs. A new candidate removes four public first-generation prepare, quote, begin, and attach wrappers that originated inside the undeployed PR. Shared private implementations remain unchanged. Existing unit fixtures call those cores; public privilege assertions target v2, and dedicated assertions require the retired wrappers to be absent and their cores inaccessible to API roles. Structural replay and the full hosted database and application gates pass; FF-070 is complete. Pre-PR customer return endpoints remain. Their old removal criterion was also corrected: a server-instance drain does not establish that no customer will return from an older provider session.

A retention candidate also rejects obsolete cleanup responses that omit current categories instead of reporting missing counters as zero. The worker and database validator now require the complete five-count response; later cleanup still runs after rejection. Two regressions fail on the old worker, all 21 retention tests pass, and structural replay removes only the unused old validator while updating the current one. The full hosted database and application gates passed on `bb92a25`; FF-071 is complete.

A refreshed inventory found seven repeated function groups. Two retention vocabulary groups now consolidate safely, removing 189 net lines with exact final catalog and legacy fixture equality. The remaining groups now have a further 413-line cleanup candidate: functions are defined once at valid dependency sites, with unchanged final bodies and privileges. Only the initial and final audit actor-context implementations remain, because migration-time callers precede the final implementation's transport table. Both consolidation candidates preserve the final catalog and legacy fixture bytes. Hosted validation passed for the 189-line pass on `e1f811e`; the 413-line pass passed on `ff01da5`.

A separate application cleanup removes 456 net lines of uncalled helpers, obsolete PayPal metadata encoding, an unused email template, and unimported media/icon modules. Repository caller inspection, all 1,584 selected server-free tests, TypeScript, lint, and hosted application/database/WebKit validation pass. Generated database types and active legacy payment-return handlers remain intact.

## Release evidence still missing

| Gate | Why green repository checks are insufficient | Required next evidence |
| --- | --- | --- |
| Hosted Supabase email proof behavior, FF-029 | Local and mocked issuance do not establish hosted supersession, concurrent account creation, expiry, or response-timing disclosure. | Authorized production-equivalent canary with complete provenance, cleanup, and explicit safe issuance policy. |
| Exact domain and payment-provider readiness | Schema-shaped provider facts do not prove DNS, TLS, Vercel tenant routing, provider authentication, checkout handoff, or return behavior. | The staging and publication runbooks' live canaries against the exact isolated configuration. |
| Physical mobile behavior | Playwright WebKit does not reproduce every iOS email-client, navigation-dialog, cookie, and provider-return behavior. | Recorded physical-device checks from the manual audit. |
| Required GitHub checks | `dev` is currently unprotected. Workflow success does not prevent a later merge from bypassing validation. | Owner-controlled activation of the prepared protection policy after coordinating availability of the checks on other open PRs. No setting has been changed. |
| Existing production security state | Repository migrations cannot prove current grants, roles, historical credentials, or infrastructure configuration. | Read-only target inventory and the documented release reconciliation. No hosted database or provider mutation was performed during this review. |

The full release inventory remains in the completion audit and staging manual audit. The rows above identify major unresolved evidence, not an exhaustive replacement for those gates.

## Decisions for the owner

App-wide host-prefixed Supabase session cookies, FF-046, require a migration strategy. A clean namespace cutover may require existing users to sign in again; session continuity adds migration behavior that needs adversarial testing. The review has not silently chosen that user-facing tradeoff. Less trusted sibling runtimes must not be introduced before that boundary is resolved.

The prepared [branch-protection payload](./dev-required-checks.json) is unapplied. It requires the two existing aggregate check names, an up-to-date base, and administrator enforcement, with no additional reviewer-count requirement. This affects other open PRs and remains an owner decision. It does not authorize merging PR 127.

## Optional product reductions

All current capabilities remain required until explicitly changed. The [measured deferral analysis](./advocate-mvp-deferral-options.md) identifies dedicated code surfaces, shared dependencies, and blockers each option leaves intact.

| Recommendation | Removed complexity | User-visible consequence |
| --- | --- | --- |
| Defer public impact counters first | Public release ledger, delayed disclosure calculations, recovery worker, metric-selection editor | Advocates launch without public fundraising counters. Private reporting and its FF-034 disclosure defect remain. |
| Consider direct attribution only for the first release | Cross-host exposure coordination, long observation windows, related retention and reporting | Primary-site sponsorships after an advocate visit receive no post-visit credit. This materially changes the product proposition. |
| Consider staff-managed delegate access only for operational reasons | Removes self-service administration but needs an audited staff replacement; initial-owner proof and delivery remain | Staff administer team access. Net engineering savings are uncertain, and the hosted proof canary remains. |
| Consider plain-text introductory content | Rich-text editor behavior and formatting surface | Logos and colors remain, but introductory text loses rich formatting. Savings are smaller. |

Payment correctness, tenant isolation, private-data protection, and cancellation support are not proposed reductions.

## Legacy account deletion does not revoke Advocate access

**P2 integration finding (FF-077):** both legacy administrator deletion routes remove `public.users`, not the Supabase Auth account. The bulk route separately removes legacy role assignments. Advocate membership references `auth.users`, and its permission function does not depend on the public profile. A synthetic delegate retained its Auth row and `portal.analytics.view` permission after executing the same public-profile deletion with normal database triggers enabled. The actual analytics snapshot RPC also returned an object both before and after deletion. Fixture setup used disabled triggers; the deletion and permission checks did not. This is database behavior evidence, not a live-session browser test.

These route bodies predate this PR, but their successful “user deleted” response is misleading for the new Advocate authority model. Do not use profile deletion as offboarding. Tenant membership suspension and revocation remain the supported Advocate controls. A complete repair should distinguish profile removal from global account disablement, protect owner transfer and sponsor access, and apply revocation atomically before reporting success. Simply swapping in Auth hard deletion would collide with retained records and ownership constraints. No global deletion semantics were silently changed.

## Retention query maintenance

The candidate broadens the existing exposure visitor index to include excluded exposures. Tracking cleanup must check all exposures, so the former qualified-only index could not support that visitor lookup. A 100,000-row planner probe changed the absent-visitor lookup from a sequential scan to an index-only scan. Full structural replay changes only the index and preserves representative legacy data. This does not measure production purge performance; the tradeoff is indexing excluded rows as well. Publication run 35190442288 and WebKit run 35190442308 passed on `14dcc77`.

## Password login request boundary

**Repaired P2 request boundary (FF-078):** password login accepted a cross-origin request and invoked authentication, while malformed JSON or a null body could throw outside the handler's error boundary. Unlike adjacent authentication routes, it had no streamed body limit or JSON-origin gate. New route regressions fail against the original implementation. The candidate reuses approved-primary-origin validation and the strict 8,192-byte body reader, rejects non-string credentials before authentication, and preserves the successful response and attribution identity cookie. It also removes an unused role query that never enforced authorization and avoids logging raw unexpected provider errors. Twelve focused tests, 1,590 selected server-free tests, TypeScript, and lint pass. Publication run 35191156280 and WebKit run 35191156285 passed on `ce0ff91`. This proves route behavior, not a live browser session-swapping demonstration.

## Sponsor assignment request boundary

**Repaired P2 assignment boundary (FF-079):** sponsor self-assignment accepted an untrusted-origin request and an oversized body without a truthful Content-Length header. Both new handler regressions fail on the prior implementation. The correction reuses the primary-origin and strict body-reading helpers while preserving the 4,096-byte bound, database ownership authority, replay, and one-time notification behavior. Five focused tests and all 1,595 selected server-free tests pass with TypeScript and lint. The new test file belongs to the required offline lane; the manifest verifies 254 classified files and 243 required files. Hosted validation remains pending. No browser exploit or live provider operation was performed.

## Diagnostic provider authorization

**Repaired P1 diagnostic authorization (FF-080):** primary-site test routes lacked route authorization, and middleware protects only the admin and portal API prefixes. The email diagnostic passed a query-string recipient directly to the payment-failure mailer; the Telegram diagnostic invoked the configured bot. These calls can consume production provider credentials when configured. The test-child route also attempted database writes, subject to its existing RLS. These routes predate the PR but remain reachable in the resulting application.

One shared guard now requires an approved primary host, same-origin request evidence, and Creator Share super-administrator authority before all five diagnostic handlers. Authorized diagnostics remain available. GET fetches without Origin require `Sec-Fetch-Site: same-origin`; cross-site and direct navigation cannot trigger mail. Three denial regressions fail against the old handlers. Five focused contracts and all 1,600 selected server-free tests pass, along with TypeScript, lint, and manifest validation. Provider calls and database writes were stubbed; no real email, Telegram message, or test child was created. Hosted validation is pending.

## Administrator mutation origin boundary

**P2 candidate repair (FF-081):** thirty mutation handlers used the shared role check without an explicit origin check. These include role changes, expenses, media uploads, matching, and provisioning. They now use one request-aware administrator guard; existing read paths retain the role-only helper, and nine other mutation handlers retain their existing explicit request guards. Diagnostic handlers reuse the same origin implementation instead of maintaining a duplicate.

A regression restoring the former role-only calls in three representative handlers reaches authentication for every untrusted-origin request. The corrected role, multipart-upload, and expense-delete handlers reject them before that lookup. A same-origin multipart test reaches the existing image validation, confirming uploads are not accidentally restricted to JSON. Seven authorization tests and all 1,602 selected server-free tests, TypeScript, lint, and manifest validation pass. Hosted validation passed on `ffe7337`. This proves handler behavior, not a live browser exploit; cookie SameSite and CORS impose additional browser constraints. Account-deletion semantics in FF-077 are unchanged.

## Failed beneficiary deletion loses content

**P1 integration defect (FF-082):** both single and bulk beneficiary deletion remove activities, storage objects, and media metadata before attempting the beneficiary delete. New financial references use `ON DELETE RESTRICT`. A full-schema reproduction with a valid synthetic PayPal catalog reference rejected the final beneficiary delete but left the child present with its activity and media rows removed. Normal triggers and constraints ran during deletion; only fixture construction bypassed triggers. No real storage operation was performed, but the route calls storage deletion before the same failing database operation.

The repair must execute the related database deletes atomically and return cleanup candidates only after commit. Financial restrictions must remain authoritative, and a failed or partially conflicting bulk request must preserve every selected child's content. A preliminary reference check alone would retain a race with concurrent checkout creation. Storage cleanup must never precede the atomic decision. The candidate now implements that transaction and passes five route contracts, full-schema rollback probes, and 1,607 server-free tests. Hosted pgTAP and all four real-session concurrency interleavings passed on `f904b01`. Storage cleanup remains best effort: crashes, lost successful responses, and storage errors can leave orphan objects requiring reconciliation. Durable cleanup is not claimed.

## Key rotation and recovery limitation

The version fields do not yet provide a working multi-key implementation. Sponsorship cryptography reads only `SPONSORSHIP_CRYPTO_SECRET_V1`, derives email lookup, envelope encryption, and checkout receipt keys from that root, and accepts only the current envelope header. Email identifier constraints and claim RPCs also require HMAC version one. Replacing the environment value would therefore break old envelope decryption and email lookup continuity; it can also change deterministic checkout receipts. The payment runbook correctly forbids replacement and requires a numbered migration plan. FF-022 and FF-032 cover parts of this work, but planned rotation needs one coordinated implementation and recovery exercise across these consumers. This is an acknowledged maintenance limitation, not a newly demonstrated cryptographic break. No key or identity semantics were changed during this review.

## Validation provenance

[Publication workflow 35182345377](https://github.com/Creator-Share/creator-share-www/actions/runs/35182345377) and [WebKit workflow 35182345403](https://github.com/Creator-Share/creator-share-www/actions/runs/35182345403) both passed on `87399c7`. They cover the application and database lanes, including current concurrency and cleanup harnesses. The local in-process database replay supports structural comparison only; hosted Supabase provides the real database execution evidence. Neither substitutes for live provider or physical-device canaries.

The [investigation record](./advocate-pr127-review.md) retains intermediate failures, repairs, commit-specific results, and their limitations. Later changes require fresh evidence before this report can describe them as validated.

The later [publication workflow 35183888657](https://github.com/Creator-Share/creator-share-www/actions/runs/35183888657) and [WebKit workflow 35183888681](https://github.com/Creator-Share/creator-share-www/actions/runs/35183888681) passed on `bb92a25`, including 63 pgTAP files with 2,110 assertions, all required concurrency and cleanup harnesses, 1,676 offline tests, 65 dev-server tests, and 99 provider contracts. This supersedes earlier pending statuses for checkout retirement, retention, and unconditional workflow coverage. Decimal arithmetic subsequently passed hosted validation; partial-refund allocation remains open.

[Publication workflow 35185296016](https://github.com/Creator-Share/creator-share-www/actions/runs/35185296016) and [WebKit workflow 35185295959](https://github.com/Creator-Share/creator-share-www/actions/runs/35185295959) passed on `7cae034`: 1,684 offline tests, 66 dev-server tests, 99 provider contracts, and 63 pgTAP files with 2,110 assertions. The WebKit overlay passed 29 tests in each browser, plus the dedicated recovery check. Both complete logs contain zero PostCSS externalization warnings; both importer paths resolve the same PostCSS 8.5.28 installation. FF-061 is complete.

[Publication workflow 35185951229](https://github.com/Creator-Share/creator-share-www/actions/runs/35185951229) and [WebKit workflow 35185951267](https://github.com/Creator-Share/creator-share-www/actions/runs/35185951267) passed on `e1f811e`, closing shared forensic parsing and the retention vocabulary consolidation. The application passed 1,684 offline tests, 66 dev-server tests, and 99 provider contracts; the database passed 63 pgTAP files with 2,110 assertions and the required integration and concurrency gates.

[Publication workflow 35186695547](https://github.com/Creator-Share/creator-share-www/actions/runs/35186695547) and [WebKit workflow 35186695502](https://github.com/Creator-Share/creator-share-www/actions/runs/35186695502) passed on `ff01da5`, validating the final-definition migration cleanup. The subsequent application cleanup requires its own hosted run. Neither result resolves FF-072 or FF-034.

[Publication workflow 35187383041](https://github.com/Creator-Share/creator-share-www/actions/runs/35187383041) and [WebKit workflow 35187383042](https://github.com/Creator-Share/creator-share-www/actions/runs/35187383042) passed on `8fecade`, validating the application dead-code removal. The pending worker follow-up removes seven duplicate trace readers and passes 1,588 selected server-free tests, including the quarantine signal regressions. Hosted validation of that follow-up remains outstanding.

[Publication workflow 35188193933](https://github.com/Creator-Share/creator-share-www/actions/runs/35188193933) and [WebKit workflow 35188193834](https://github.com/Creator-Share/creator-share-www/actions/runs/35188193834) passed on `b812f8c`, validating the quarantine signal and worker trace consolidation. The later database forensic correction still needs its own hosted gate.

[Publication workflow 35189654393](https://github.com/Creator-Share/creator-share-www/actions/runs/35189654393) and [WebKit workflow 35189654400](https://github.com/Creator-Share/creator-share-www/actions/runs/35189654400) passed on `4cc42a0`, including both independent jobs and the required aggregate. FF-076 is complete. The later retention-index change remains pending; FF-072, FF-034, and FF-077 are unresolved.

[Publication workflow 35190442288](https://github.com/Creator-Share/creator-share-www/actions/runs/35190442288) and [WebKit workflow 35190442308](https://github.com/Creator-Share/creator-share-www/actions/runs/35190442308) passed on `14dcc77`, validating the broader visitor index. The later password-login repair requires fresh hosted evidence.

[Publication workflow 35191156280](https://github.com/Creator-Share/creator-share-www/actions/runs/35191156280) and [WebKit workflow 35191156285](https://github.com/Creator-Share/creator-share-www/actions/runs/35191156285) passed on `ce0ff91`, closing FF-078. The subsequent sponsor-assignment and diagnostic guards require their own hosted results.

[Publication workflow 35192016933](https://github.com/Creator-Share/creator-share-www/actions/runs/35192016933) and [WebKit workflow 35192016482](https://github.com/Creator-Share/creator-share-www/actions/runs/35192016482) passed on `98928f2`, closing FF-079 and FF-080. The subsequent administrator guard passed on `ffe7337`; FF-082 was then reproduced and repaired on `f904b01`.

The shared administrator guard passed publication run 35193169856 and WebKit run 35193169883 on `ffe7337`. FF-081 is validated. Publication run 35195399935 and WebKit run 35195399933 passed on `f904b01`, validating FF-082 as well.

## Atomic deletion hosted evidence

On `f904b01`, publication run [35195399935](https://github.com/Creator-Share/creator-share-www/actions/runs/35195399935) and WebKit run [35195399933](https://github.com/Creator-Share/creator-share-www/actions/runs/35195399933) passed. The publication workflow records 1,707 offline tests, 66 dev-server tests, 99 provider contracts, 64 pgTAP files with 2,134 assertions, 15 catalog tests, and two local Supabase HTTP tests, plus all required concurrency and cleanup harnesses. The new deletion evidence proves four independent-session interleavings using server-observed blocking, with evidence written after disposable database cleanup. The earlier missing-seed fixture failure remains documented.

These results close the premature content-deletion defect. They do not close the financial accounting or private analytics findings, resolve global account-deletion policy, demonstrate durable orphan-object cleanup, or authorize a merge or production activation.

## Banned administrator retains direct Data API authority

**P1 authorization defect (FF-083):** `private.is_creator_share_super_admin()` checked global role assignment without current account state. In a complete migration replay, a normal authenticated database role could read another sponsor's canonical subscription both before and after its administrator account was banned. The JWT claims were unchanged. The separate role-assignment self-read policy also continued exposing the role used by the application guard. Newer administrative commands check healthy accounts, but those command checks do not govern direct table and storage policies.

The candidate adds one private account-state predicate and uses it in the shared administrator predicate and role-assignment read policy. Banned, soft-deleted, and anonymous accounts lose effective administrator authority; active accounts retain it. The in-process reproduction now returns no subscription after the ban. Structural replay changes exactly the administrator function and role policy, adds one helper, and preserves all eight legacy-data projections. All 1,607 selected server-free tests, TypeScript, lint, and manifest validation pass. Hosted tests remain pending, including a real retained JWT, an Auth API ban, private reads, and a blocked write through PostgREST.

This correction does not define what the legacy Delete user action should do (FF-077), require a new email-verification policy for existing administrators, or claim that every in-flight transaction or revoked session is immediately fenced. Commands requiring transaction-level authority locks retain their stronger checks. No live account was changed.

A further undeployed-history cleanup removes ten function versions that were created only to be dropped later, deleting 1,635 net migration lines. The final 5,282-entry catalog and eight legacy-data projections remain exactly equal to the preceding account-state candidate. Active invitation, audit, branding, catalog, metric, payment-worker, and retention behavior is preserved. Hosted validation passed for this cleanup and the corrected FF-083 denial contracts.

An additional application cleanup removes an unread sponsorship-in-progress context and its global provider, eliminating 80 net application lines and unnecessary local-storage writes. Its only caller cleared state; no caller read it or set an in-progress flag. The obsolete 292-line reservation implementation report also described hooks and endpoints absent from the current branch and has been removed. Actual checkout intents, operation recovery, and existing database history remain. Local checks pass; hosted checkout/browser evidence is pending for this cleanup.

The FF-083 review also reproduced retained delegate access after a ban: portal.view remained true, the tenant base row stayed readable, and get_my_advocate_portal_access returned the portal. The candidate now applies the same account-state helper to the delegate view predicate and portal-list RPC. Normal-role replay denies all three after the ban while preserving active access. Eight additional database assertions and the real-JWT HTTP case cover this extension; hosted validation passed at 231c0d7. Transactional mutation authority checks remain intact.

## Global account-state and schema cleanup hosted evidence

Publication run [35197836385](https://github.com/Creator-Share/creator-share-www/actions/runs/35197836385) and WebKit run [35197836392](https://github.com/Creator-Share/creator-share-www/actions/runs/35197836392) passed on `817e2de`. This validates the global administrator account-state repair, including the real retained-JWT Auth-ban test through PostgREST, and the 1,635-line migration cleanup. The run records 1,707 offline tests, 66 dev-server tests, 99 provider contracts, 65 pgTAP files with 2,148 assertions, 15 catalog tests, and three local Supabase HTTP tests, plus all required concurrency and cleanup harnesses.

Publication run [35199012868](https://github.com/Creator-Share/creator-share-www/actions/runs/35199012868) and WebKit run [35199012853](https://github.com/Creator-Share/creator-share-www/actions/runs/35199012853) subsequently passed at `231c0d7`, validating the delegate-read extension and unused browser-state removal. The publication run records 1,707 offline tests, 66 dev-server tests, 99 provider contracts, 65 pgTAP files with 2,156 assertions, 15 catalog tests, and three local Supabase HTTP tests. All required concurrency and cleanup harnesses passed. FF-083 is complete; this does not resolve the separate Delete user product decision or claim universal session revocation.

## Dispute loss bounds need an accounting amendment

**P1 financial correctness defect (FF-084):** the Stripe adapter treats a dispute larger than its charge as a permanent provider mismatch, while settlement forbids a payment's aggregate net from becoming negative. A focused adapter probe reproduced rejection of 1,300 cents against a 1,250-cent captured charge. Stripe documents larger disputes, grouped recurring-charge disputes, and disputes for the full amount after partial refunds. [Provider contract](https://support.stripe.com/embedded-connect/questions/how-disputes-work?locale=en-GB)

These require explicit handling of provider losses beyond the attributed principal and, for grouped disputes, allocation across payments or an unallocated reconciliation state. The accounting decision document now includes these requirements. No live incident frequency is inferred, and no production accounting policy was changed.

## Exhausted gateway work can disappear from batch health

**P2 operational recovery gap (FF-085):** the database increments the attempt count when claiming, but future claims require that count to remain below the maximum even after the ten-minute processing lease expires. A worker crash on its final claim can therefore strand a `processing` event. `runPaymentGatewayEventBatch` and its route derive terminal failure health only from the current batch, so a later empty batch can return success without inspecting that retained event. This conclusion follows from the active claim predicate, transition trigger, and batch implementation; it is not a live crash canary.

The payment runbook now supplies a protected aggregate query covering exhausted `failed` events and expired final `processing` leases. Persistent monitoring and an audited resolution boundary remain required. Quarantine acknowledgment must remain separate from replay or financial reconciliation. No automatic financial retry or service health behavior was changed by this documentation.

## Sponsor read authority after an account ban

**P2 authorization defect (FF-086):** recurring sponsorship, one-time history, and legacy PayPal presentation RPCs checked only authenticated role and user identity. A normal database role with unchanged claims could still read its recurring sponsorship after an Auth ban. Full-schema before/after execution now denies all three functions with SQLSTATE 42501 while preserving active access. The fix reuses the existing account-state predicate; only the three function definitions change and all eight legacy-data projections remain equal.

Eight added database assertions cover active access, banned access, expiry restoration, and soft deletion. The real retained-JWT Auth/PostgREST test now exercises these sponsor endpoints as well. Hosted validation is pending. This does not alter historical ownership or erase sponsorship records.

## Updated review footprint

Against review baseline `0380658`, local revision `6b6b41f` changes 248 tracked text files, with 6,585 additions and 30,521 deletions: 23,936 net fewer lines. Lockfiles account for 10,602 of that reduction. Excluding lockfiles, the net reduction is 13,334 lines. Application and support paths (`src` and `scripts`) shrink by 1,491 lines, undeployed migrations by 11,477, database tests by 232, and application/harness tests by 299. Documentation/workflows add 135 net lines and other configuration adds 30. Binary files are excluded from these Git numstat measurements. These figures measure the review diff, not the entire PR or production-code deletion alone. No product capability has been removed.

The last fully validated revision remains `231c0d7`. Later snapshot and sponsor-access changes need a complete successful hosted gate; passing individual files or an application-only job does not establish that result.

The same review also found a direct profile self-read policy that relied only on retained user identity. With the in-process Auth stub granted schema usage, an ordinary database role read its own profile both before and after a ban. The candidate now uses the shared account-state predicate in that policy: active reads remain available and banned reads return no rows. Two additional database assertions and the HTTP regression cover this extension. Strict comparison changes only that policy and preserves legacy data. Hosted evidence remains pending.

## Shared legacy email error disclosure

**P2 privacy defect (FF-087):** `sendEmail` logged the complete SMTP exception, persisted arbitrary exception messages in `email_logs.error`, and returned the raw exception to callers. Its logging-error handlers also emitted raw database exceptions. A fixture containing a marked provider response and rejected recipient fails both new privacy regressions against the former code.

The candidate returns a fixed delivery-failure message, writes only that fixed error, and logs fixed operational messages. One shared outcome write replaces three repeated blocks, removing 30 net application lines. Three contracts cover transport disclosure, accepted delivery despite a logging exception, and missing credentials without a provider call. Existing recipient and subject fields in the email log remain unchanged, as does historical data; no broad claim about other legacy handlers or log erasure is made. Hosted validation remains pending.

## Current complete hosted checkpoint

Publication run [35202955091](https://github.com/Creator-Share/creator-share-www/actions/runs/35202955091) and WebKit run [35202955007](https://github.com/Creator-Share/creator-share-www/actions/runs/35202955007) passed at `dbf6ded`. Evidence includes 1,707 offline tests, 66 dev-server tests, 99 provider contracts, 65 pgTAP files with 2,169 assertions, 15 catalog tests, three local Supabase HTTP tests, and every required concurrency and cleanup harness. This validates the snapshot simplification, corrected out-of-order dispute recovery scenario, and sponsor/profile account-state checks. FF-086 is complete. The later legacy email privacy repair remains pending its own hosted validation.

## Activity notification reporting and subject binding

**P2 correctness defect (FF-088):** the legacy activity notification route discarded delivery outcomes and reported the audience size as `emailsSent`, while its administration UI ignored both response status and body. The route also retrieved an activity by ID without confirming it belonged to the requested child whose audience would receive it. This is an authorized-administrator workflow defect, not a demonstrated unauthenticated exploit.

The candidate binds activity and child, stops before sending on audience lookup failure, counts accepted versus failed or rejected outcomes, and makes the UI warn when delivery cannot be confirmed. It does not retry automatically. Removing the unreachable fallback for null emails already excluded by the database query, unused default sponsor lookup, and duplicate audience mapping reduces these application files by 80 net lines. Four route contracts pass; mutations restoring the former count behavior or removing child binding each fail their regression. Counts describe transport acceptance, not inbox delivery. No live email or local server was used, and no end-to-end browser proof is claimed for this UI change.

## Email privacy hosted checkpoint

Publication [35203991700](https://github.com/Creator-Share/creator-share-www/actions/runs/35203991700) and WebKit [35203991580](https://github.com/Creator-Share/creator-share-www/actions/runs/35203991580) passed at `d32f82e`, validating the shared legacy email privacy repair and closing FF-087. The later activity notification changes still require their own hosted result.
