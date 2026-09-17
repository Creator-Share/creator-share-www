# Advocate Platform review findings

Status: review in progress, September 17, 2026. No merge into `dev` is authorized. This report does not approve production activation.

The authoritative review baseline is PR 127 at `03806587621477ef8c86b946e59431b053f5a9d5`. The latest fully validated review revision is `87399c7`. The subsequent workflow coverage fix, `18584a6`, is pushed and awaits its own hosted results. Existing local checkouts were left intact; local services remain stopped.

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
| Required workflow path filters could leave checks permanently pending on unmatched PR changes. | Run both workflows for every PR targeting `dev`. | Four tooling regressions and 99 provider contracts pass locally. Hosted validation of this later change remains pending. |

At `87399c7`, the review changes remove 25,835 lines and add 3,697, a net reduction of 22,138 across 126 files. This includes removal of the redundant 10,056-line npm lockfile. It is not a claim that 22,138 lines of application logic were eliminated. No product capability has been removed.

## Newly confirmed financial correctness findings

**P1: legitimate partial foreign-currency refunds can be rejected (FF-072).** The active Stripe adjustment helper rejects a two-cent AUD refund on a 3,500-cent AUD payment whose original normalized amount is 2,500 USD cents at the configured rate of 1.4. One USD cent converts to one AUD cent; two USD cents convert to three AUD cents. No integer input produces the required two cents. PayPal uses the same requirement, and SQL ingestion and settlement enforce it independently. This is not solved by relaxing the browser or one provider adapter. An existing test explicitly accepts rejection of unrepresentable currency slices, so green tests do not establish full refund parity.

The recommended repair preserves provider minor units exactly and allocates normalized USD cents cumulatively under the original-payment lock. It must allow zero-USD-cent deltas where appropriate and reconcile full refunds, repeated small refunds, dispute debits and credits, replay, and concurrent delivery. Independent rounding of each adjustment can overstate the total. An owner question about the accounting policy is pending; no financial policy change has been made.

**P2: decimal and binary checkout rounding disagree at valid rates (FF-073).** JavaScript computes `Math.round(2500 * 0.6134)` as 1,533, while PostgreSQL numeric computes 1,534. The same mismatch occurs for 3,000 at 0.6255. Application conversion and recovery must agree with the database's immutable amount checks. This was reproduced with both runtimes, but not with the four currently configured rates. The candidate uses one exact decimal helper across conversion, sealed request validation, shared recovery, and PayPal boundaries. Both provider regressions fail on the old implementation. All 1,580 selected server-free tests pass, and 1,600 comparisons against PostgreSQL numeric match. Hosted validation remains pending. This does not repair FF-072 or change refund allocation.

## Remaining implementation review

The application uses v2 checkout RPCs. A new candidate removes four public first-generation prepare, quote, begin, and attach wrappers that originated inside the undeployed PR. Shared private implementations remain unchanged. Existing unit fixtures call those cores; public privilege assertions target v2, and dedicated assertions require the retired wrappers to be absent and their cores inaccessible to API roles. Structural replay and 1,576 server-free tests pass; hosted validation is pending under FF-070. Pre-PR customer return endpoints remain. Their old removal criterion was also corrected: a server-instance drain does not establish that no customer will return from an older provider session.

A retention candidate also rejects obsolete cleanup responses that omit current categories instead of reporting missing counters as zero. The worker and database validator now require the complete five-count response; later cleanup still runs after rejection. Two regressions fail on the old worker, all 21 retention tests pass, and structural replay removes only the unused old validator while updating the current one. Hosted evidence is pending under FF-071.

Six other repeated function-definition groups remained in the earlier inventory; that inventory must be refreshed after the current candidates. Migration-time execution and later schema dependencies prevent treating them as simple duplicate text. No safe deletion has yet been established.

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

All current capabilities remain required until explicitly changed.

| Recommendation | Removed complexity | User-visible consequence |
| --- | --- | --- |
| Defer public impact counters first | Public release ledger, delayed disclosure calculations, recovery worker, metric-selection editor | Advocates launch without public fundraising counters. Private reporting remains. |
| Consider direct attribution only for the first release | Cross-host exposure coordination, long observation windows, related retention and reporting | Primary-site sponsorships after an advocate visit receive no post-visit credit. This materially changes the product proposition. |
| Consider staff-managed delegate access | Self-service invitation UI and some advocate delivery/recovery operations | Creator Share staff administer team access. Sponsor authentication and secure authorization still remain necessary. |
| Consider plain-text introductory content | Rich-text editor behavior and formatting surface | Logos and colors remain, but introductory text loses rich formatting. Savings are smaller. |

Payment correctness, tenant isolation, private-data protection, and cancellation support are not proposed reductions.

## Validation provenance

[Publication workflow 35182345377](https://github.com/Creator-Share/creator-share-www/actions/runs/35182345377) and [WebKit workflow 35182345403](https://github.com/Creator-Share/creator-share-www/actions/runs/35182345403) both passed on `87399c7`. They cover the application and database lanes, including current concurrency and cleanup harnesses. The local in-process database replay supports structural comparison only; hosted Supabase provides the real database execution evidence. Neither substitutes for live provider or physical-device canaries.

The [investigation record](./advocate-pr127-review.md) retains intermediate failures, repairs, commit-specific results, and their limitations. Later changes require fresh evidence before this report can describe them as validated.
