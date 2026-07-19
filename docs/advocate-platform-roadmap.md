# Advocate Platform Architecture and Delivery Roadmap

Status: Approved for implementation

Decision date: July 16, 2026

This document supersedes the earlier draft specification. It records the product decisions, security boundaries, data model, delivery sequence, and release gates for the Creator Share Advocate Platform.

## 1. Product outcome

Creator Share will provide invited advocates, including creators and social influencers, with a branded subdomain where their audience can browse every eligible child and complete the same sponsorship experience available on the primary Creator Share site.

Each advocate experience includes:

- An automatically provisioned `slug.creatorshare.com` domain.
- Primary and accent colors, a logo, a rich text opening header, and a rich text About Us biography.
- All eligible children by default, with optional featured children or a selected only catalog.
- Advocate controlled selection of approved public impact metrics.
- Private, aggregate analytics for direct and post visit sponsorship behavior.
- Delegate access through predefined roles.
- A scoped, sanitized audit history.

Advocates never receive a commission. They do not receive sponsor contact details or unrestricted individual behavior histories.

## 2. Approved terminology

The platform uses advertising attribution terminology instead of the draft term Mindshare.

| Term                              | Definition                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct sponsorship                | A sponsorship intent created on an active advocate domain.                                                                                                                      |
| Post visit attributed sponsorship | A sponsorship intent created on the primary site after the latest qualifying advocate exposure, with a lag of no more than 30 days.                                             |
| Post visit observed sponsorship   | A primary site sponsorship after an advocate exposure, with a lag greater than 30 days and no more than 365 days. It is reported as observation, not official attributed funds. |
| Unattributed sponsorship          | A sponsorship intent with no qualifying advocate source.                                                                                                                        |

The reporting bands are mutually exclusive:

- 0 through 24 hours.
- More than 24 hours through 7 days.
- More than 7 days through 30 days.
- More than 30 days through 365 days, observed only.

The system stores the exact lag. Cumulative views such as within one day or within one week may be derived, but overlapping totals must never be added together.

The MVP does not assign fractional dollar weights. Any future modeled score must be versioned and reported separately from actual collected funds.

## 3. Core architectural decisions

### 3.1 Advocate is the sole tenant root

The `advocates` table is the tenant aggregate for the MVP. There is no separate `advocate_portals` table.

An advocate contains tenant identity and lifecycle state:

- Stable ID and unique slug.
- Display name and advocate type.
- Relationship status, such as invited, active, suspended, or archived.
- Publication status, such as draft, provisioning, active, failed, or suspended.
- Child display mode.
- Creator Share ownership and lifecycle metadata.
- Version and timestamps.

Domains, branding, public metrics, child selections, memberships, invitations, and provisioning state live in related tables. This keeps the tenant root legible without turning one row into a junk drawer with excellent posture.

Tenant lifecycle is asymmetric. Suspension is an audited, reversible operational stop that disables public tenant resolution and reconciliation while preserving provider attachments. Archive is an audited, irreversible relationship decision that disables the tenant immediately and requests strictly ordered provider cleanup after a 20 minute quiescence period. Neither action deletes sponsorship, attribution, financial, membership, or audit history, and slugs are never released automatically for reuse.

### 3.2 Server owned sponsorship intent

Every supported Stripe or PayPal flow must begin with a local, server created `sponsorship_intent`.

The browser may request a child, sponsorship type, and permitted options. The server validates and locks:

- The exact active advocate domain, if any.
- Direct or post visit attribution.
- Child eligibility and canonical pricing.
- Blind, named, one time, or recurring sponsorship semantics.
- Currency and payment account routing.
- Sponsor or guest linkage.
- The validated return domain.

Provider objects carry only the opaque intent ID and required provider fields. They do not carry a client composed financial truth.

This extra object is important because a browser payload is a request from an untrusted computer. If webhooks later trust client selected beneficiary IDs, amounts, currency conversions, or attribution identifiers, a modified client can create internally consistent but unauthorized records. The intent also gives retries across gateways one identity, makes webhook processing idempotent, and preserves attribution after cookies or sessions disappear.

### 3.3 Payment presentation remains unchanged

Advocate domains use the same payment presentation as the current Creator Share experience:

- Stripe hosted Checkout.
- The existing PayPal provider handoff.
- The same child, currency, payment scope, and provider availability.

The browser may briefly visit a provider controlled surface. It must return to the exact validated advocate domain stored on the intent.

Stripe hosted Checkout does not require Payment Method Domain registration for every advocate hostname. Per advocate Stripe domain registration would become necessary if Creator Share later adopts Embedded Checkout, Elements, or advocate hosted wallet surfaces. That work is explicitly outside the MVP.

### 3.4 Attribution is server decided, not cookie decided

The browser stores only an opaque first party visitor token. It never stores the advocate ID as the source of truth.

A qualified advocate page exposure is appended on the server with:

- Visitor token linkage.
- Authenticated sponsor identity linkage when available.
- Advocate and exact domain.
- Server timestamp.
- Qualification and exclusion state.

Known automation hints, prefetches, health checks, hidden frames, staff previews, and advocate administrators are excluded from conversion metrics. The visitor token proves server issuance, not a human visit. Direct and post visit sponsorship outcomes are payment backed, but raw reach metrics are not abuse resistant until the Cloudflare controls in FF-024 are complete.

At intent creation:

1. An active advocate hostname produces direct attribution.
2. Otherwise, the most recent qualifying exposure no more than 30 days old produces post visit attribution.
3. Otherwise, an exposure no more than 365 days old produces an observed association.
4. Otherwise, the intent is unattributed.

Direct attribution always wins. The decision is locked to the intent. Renewals inherit it. Refunds, reversals, and disputes change net funds, but do not rewrite the historical source.

Multiple advocate visits use latest qualifying visit for the MVP. Multi touch models are a fast follow.

### 3.5 Sponsor identity is confidence based

An email address is a useful contact key, but it is not proof of a unique human. The MVP therefore reports:

- Verified sponsor accounts.
- Unique sponsor contacts, based on normalized email keys.
- Estimated unique sponsors only where the methodology is disclosed.

The platform must not promise an exact count of distinct people.

Account creation is encouraged, not mandatory. After a first successful sponsorship, including a blind sponsorship, the sponsor receives:

1. The existing branded provider confirmation or receipt.
2. One Creator Share welcome email with a prominent account claim and management link.

An email magic link is the default account entry. A password is optional. Guest sponsorship remains available. Generic sign in and recent-action reauthentication never create an account. Account creation is allowed only through a validated, unconsumed initial sponsorship claim for its exact verified email or the explicit bounded password registration surface. Both paths require exact email confirmation, and neither path reveals account existence or delivery outcome.

Every sponsor email proof returns through the exact canonical primary host. The token hash travels only in the URL fragment, is removed from browser history before any request or analytics can run, and is verified only after the person deliberately selects Continue. The stateless flow works when the requesting browser and the consuming browser are different. Known accounts, unknown accounts, throttled requests, and email-provider failures receive the same public accepted response so the route cannot enumerate accounts or delivery policy.

After verifying an email, an account can claim historical subscriptions associated with that email across Stripe US, Stripe UK, and PayPal. Claims attach records to a stable sponsor identity. Subsequent access uses that stable identity instead of repeating an email query.

Changing an account email preserves already attached subscriptions and does not automatically claim another email address's history. Manual identity reconciliation and a team support tool are fast follows.

Existing sponsors may receive a one time invitation campaign only after identity backfill and reconciliation are complete. That outreach requires separate approval.

### 3.6 Account management contract

An authenticated sponsor can:

- View every claimed sponsorship and subscription.
- Open the correct provider flow to update a payment method.
- Cancel future billing after recent verification.

Payment-method management and cancellation both require a server-recorded email-authentication receipt no more than 15 minutes old. The receipt is bound to the exact healthy Supabase Auth user and exact live session. A recently issued or refreshed JWT, password login, or ambiguous authentication-method claim is not sufficient by itself.

Stripe management uses a short-lived regional Billing Portal `payment_method_update` session only after exact sponsor ownership, provider-chain, customer-exclusivity, live-subscription, supported collection-mode, and recent-authentication checks. The runtime must fail closed when a live subscription has its own `default_payment_method` or `default_source`, because those values override the customer default changed by the Billing Portal. Before promotion, both live Stripe accounts require a complete override inventory. An empty inventory plus the runtime guard permits the customer-level portal flow. Any existing override blocks release until it is reconciled or a durable exact-subscription update flow is implemented. The returned Stripe URL is a bearer destination. It must never enter application-controlled logs, analytics, databases, persistent web storage, or outbound referrers. Browser navigation history is controlled by the browser and provider and cannot be represented as application persistence.

PayPal management sends the sponsor to PayPal Automatic Payments only after a clear confirmation that they must select Creator Share. Provider customer IDs, subscription IDs, configuration IDs, and provider responses never cross the authenticated browser RPC boundary.

Cancellation stops future billing. It does not automatically refund prior payments. Provider webhooks remain authoritative.

Changing amount, frequency, child, or provider requires cancellation and a new sponsorship intent.

## 4. Data model

The exact migration is authoritative. The intended bounded contexts are:

### 4.1 Tenant and presentation

- `advocates`
- `advocate_domains`
- `advocate_domain_integrations`
- `domain_provisioning_jobs`
- `advocate_branding`
- `advocate_public_metric_selections`
- `private.advocate_public_metric_releases`
- `advocate_beneficiaries`

Branding is intentionally constrained. Rich text is sanitized against a strict allowlist. No advocate supplied script, style sheet, raw HTML, iframe, tracking pixel, or arbitrary URL execution is permitted.

Child presentation modes are:

- `all`, every eligible child.
- `all_featured`, every eligible child with selected children featured.
- `selected`, only selected children.

The beneficiary relation uses a real foreign key. It does not use the draft's polymorphic cause type and cause ID pair.

### 4.2 Delegated access

- `advocate_memberships`
- `advocate_roles`
- `advocate_permissions`
- `advocate_role_permissions`
- `advocate_membership_roles`
- `advocate_invitations`
- `advocate_invitation_roles`

MVP roles are Owner, Administrator, Brand editor, Catalog curator, Analytics viewer, and Audit viewer.

Application code checks permissions, not display names. Memberships are database backed so revocation takes effect immediately.

Invitations use at least 256 bits of randomness. The invitation authority stores only a digest. A separate forced row security delivery outbox may temporarily retain the recipient and capability in authenticated encryption envelopes so a durable worker can send the invitation. That transport material is unavailable to browser roles and ordinary administrators, and it is never returned by an application route. Invitations are email bound, expire after seven days, can be revoked, are single use, and redeem atomically. The emailed capability and Supabase magic link proof travel only in the URL fragment. The neutral interstitial removes that fragment from browser history before parsing it and requires a deliberate Continue action before redemption. User editable authentication metadata must never grant authorization.

Redemption requires a freshly verified, provider signed `magiclink` authentication method reference and exact binding to the invitation target. A refreshed access token is not proof of a fresh email authentication event. Before release, a production equivalent canary must establish whether generating another Supabase email proof for the same account supersedes an earlier unconsumed proof. The release policy must follow measured provider behavior, not folklore in a nicer jacket.

Creator Share super administrators remain separate from advocate membership. Domain, ownership, and tenant lifecycle changes require Creator Share approval. The browser boundary reauthorizes a healthy Creator Share super administrator. Publication, lifecycle actions, and cleanup recovery bind the reviewed advocate version. Ownership transfer instead binds the expected current owner membership and an eligible target membership. Every mutation also requires a stable operation ID and reason, then stores an append-only exact replay receipt. Advocate owners and delegates cannot directly perform those changes. Tenant-initiated ownership transfer requests with a later Creator Share approval step are deferred to FF-036.

### 4.3 Identity and attribution

- `browser_visitors`
- `advocate_exposures`
- `sponsor_identities`
- `sponsor_identifiers`
- `sponsorship_intents`
- `sponsorship_attributions`
- `payment_attempts`
- `gateway_events`
- `account_claims`
- `private.sponsor_email_authentication_receipts`
- `private.sponsor_passwordless_email_delivery_reservations`
- `private.sponsor_passwordless_email_verification_attempts`
- A durable email outbox.

Provider identifiers are scoped to their provider account. Stripe US and Stripe UK customer IDs are separate namespaces.

Emails used for lookup are keyed HMAC values. Contact data remains behind a stricter privacy boundary. Provider events have unique constraints for idempotency.

Existing subscriptions and financial ledger rows link to the intent and sponsor identity where known. Existing history remains valid when those links are null.

### 4.4 Audit

Application owned business changes write to a private, append only `audit.audit_events` table through database triggers.

Each event can record:

- Event ID, sequence, timestamp, and transaction ID.
- Schema, table, operation, and record key.
- Advocate scope.
- Actor user, effective user, system actor, and database role.
- Administrative surface, route, job, webhook, request, session, correlation, and provider IDs.
- Redacted before and after values and changed columns.
- Sanitized network and user agent metadata.
- Required reason and supplemental metadata.

Raw row copying is forbidden because it would create a second sponsor PII database.

The forensic row audit is not an advocate delegate presentation model. Advocate users with `portal.audit.view` receive a separate append only, policy versioned disclosure ledger populated at business change write time. It has no historical backfill. Each disclosed entry contains only an opaque tenant cursor, a timestamp rounded to the second, one fixed event key, one fixed actor kind, one privacy limited actor label, and the exact fixed area keys for that event. Portal member labels may contain a validated first name and last initial. Creator Share staff and automation use fixed generic labels.

The delegate ledger contains only disclosure fields plus private, ungranted transaction and source sequence links for deduplication and forensic correlation. Its reader never exposes sponsor facts, contact data, money, global sequences, source audit identifiers, account identifiers, row keys, changed column names, reasons, request metadata, network forensics, provider identifiers, or free form text. The reader is tenant scoped, permission checked, ordered by newest recorded ledger entry, and limited to fixed pages of 50 entries using opaque cursors. Unknown event shapes and near matches are omitted instead of being guessed into public history.

Database and provider logs corroborate DDL, direct SQL, policy changes, disabled triggers, and managed service actions that row triggers cannot reliably identify. Unified ingestion of every external log into one interface is a fast follow.

Creator Share ownership, lifecycle, and cleanup recovery decisions also write protected append-only semantic receipts. The receipts bind command semantics plus trace and signed authentication session only, without copying provider payloads, contact data, or transport metadata. Each high risk database function derives session identity from the verified Supabase JWT. The browser cannot supply or override it. A repeated operation succeeds only when its semantic request binding matches exactly. Browser routes capture bounded client IP and user agent values solely in `audit.audit_event_forensics` for 90 days. These fields never affect replay equality or enter advocate delegate history.

Exceptional lifecycle transitions use private transaction-bound mutation guards keyed to the current transaction and exact advocate. Runtime principals cannot forge those guards through browser input, service role calls, or session configuration. The same functions reauthorize the actor and lock the affected tenant and descendants before mutation.

## 5. Privacy boundaries

Advocate users receive purpose built aggregate analytics. They never receive raw access to sponsor identities, emails, payment customer data, browser visitors, or attribution rows.

Authorized advocate administrators may see a recognition label consisting of full first name and the first initial of the last name. They may not see contact information. That label must not be paired with exact timestamps, exact amounts, granular location, device details, or an individual journey history.

No explicit recognition consent is required for this private administrative surface. Public sponsor names are not part of the MVP.

Segmented behavioral cells with fewer than five sponsors are suppressed. Complementary queries must not allow trivial reconstruction. Geography, time, and monetary values are bucketed where needed.

Public metric selections come from a fixed allowlist of privacy safe metrics. Advocates cannot publish arbitrary queries.

### 5.1 MVP private analytics boundary

The private advocate dashboard reads one fixed database projection. It does not accept arbitrary filters, date ranges, groupings, exports, or raw identifiers. The projection uses the preceding complete UTC day as its exclusive cutoff and includes only finalized attribution records with at least one recorded sponsorship payment before that cutoff.

Official outcomes combine direct sponsorships with post visit attributed sponsorships no more than 30 days after exposure. Observed outcomes from more than 30 days through 365 days remain separate. The five timing bands are mutually exclusive. Renewals add to collected funds but never add sponsorships or sponsor contacts.

Every visible cell requires at least five distinct normalized sponsor contact keys. A timing breakdown is withheld in full if any nonempty timing cell is below that threshold. Original currency detail is likewise withheld in full if any represented currency is below the threshold. A renewal, account, adjustment, or commitment measure also requires five contributing contacts. When one measure is withheld, complementary gross or net values are withheld wherever subtraction could recover it. Timing and currency measures are suppressed across their entire family when another cell could reveal a small subgroup. Suppressed responses carry no hidden values. Zero cells may be shown as zero.

Financial values come from the immutable sponsorship movement ledger. Initial payments, renewals, completed refunds and reversals, dispute debits, and dispute credits remain separate. Net collected funds use the signed ledger result. Monthly and annual active commitments are reported separately because their periodic amounts are not interchangeable. The annualized projection multiplies monthly commitments by twelve and leaves annual commitments unchanged. Subscription state is reconstructed from applied lifecycle evidence and settled cancellation operations before the cutoff, and its latest verified paid period must cover the cutoff.

Creator Share staff and members of the attributed advocate portal are excluded through an immutable eligibility decision written when the attribution row is created. The rollout classifies any preexisting attribution exactly once under an exclusive lock, using only global role and same-portal membership evidence that existed when its server-owned intent was created. The column has no permissive default, so a missing trigger fails closed. Later membership changes and replayed backfills do not rewrite historical eligibility. If an environment has hard-deleted historical role or membership evidence, deployment requires an explicit reconciliation decision because current tables cannot reconstruct that lost history. Anonymous checkout cannot infer an identity it does not possess.

The dashboard may report verified sponsor accounts and normalized sponsor contacts as different concepts. Neither is presented as an exact count of people. Contact count comparability across a future HMAC key rotation is deferred to FF-032. Pending provider adjustments are not inferred from gateway payloads and are deferred to FF-033 until a provider-neutral state exists.

The MVP exposes no date filters, exports, recognition joins, or arbitrary cohorts. FF-034 tracks stronger protection against temporal differencing across repeated cumulative snapshots before any of those surfaces are added.

### 5.2 MVP public metric release boundary

Anonymous public metrics use a stricter boundary than the private dashboard because anyone can save successive responses and compare them. The page request never calculates a live total. A daily recovery worker may create append only releases only from one fixed source cutoff per week, one full week behind the current Monday at 00:00 UTC. Repeated invocations against that cutoff are idempotent and do not increase the public cadence.

The public allowlist contains only monotonic outcomes:

- Distinct children supported through canonical beneficiary evidence.
- Gross successful sponsorship payments normalized to USD.
- Direct sponsorships.
- Official post visit attributed sponsorships no more than 30 days after exposure.

Active sponsorships, net funds, verified accounts, normalized contacts, and 30 to 365 day observed association remain private. Their changes can expose a cancellation, refund, account claim, contact count, or nonofficial attribution outcome.

Each public metric advances independently only after at least five distinct eligible normalized sponsor contacts changed that metric since its prior released cutoff. Count values round down to multiples of five. Gross funds round down to multiples of 100 USD. Public copy presents every released value as a lower bound. If the contact threshold is not met or the rounded bucket does not advance, the prior release and cutoff remain unchanged. An initial metric remains generically unavailable until both requirements are met.

Releases are calculated for all four approved metrics regardless of current advocate selection. An advocate may choose visibility and order, but changing a selection cannot calculate, accelerate, reset, or distinguish a privacy decision. The browser receives only the key, public order, released or pending state, rounded value and unit, lower bound qualifier, and released cutoff. It never receives a raw total, contributor count, candidate value, threshold result, release identifier, sponsor fact, or suppression reason.

Children supported means distinct historical beneficiaries reached by an eligible official paid intent. A standard sponsorship uses its immutable intent beneficiary. A blind subscription uses its immutable assignment row only after that assignment predates the release cutoff. Unassigned blind sponsorships and partnership sponsorships do not count. One beneficiary counts once even when several sponsors provide support.

The release table is system written, append only, and audited. Its worker uses one fixed database projection with a server-derived cutoff and an overlap-safe transaction lock. It accepts no caller-selected advocate, metric, cutoff, threshold, or bucket. FF-034 retains advanced privacy work before any finer cohorts, exports, public recognition, arbitrary queries, or exact values are introduced.

## 6. Financial reporting

Store both original currency details and normalized USD values using the conversion evidence applicable at transaction time.

Report at least:

- Initial collected funds.
- Renewal collected funds.
- Gross collected funds.
- Completed refunds and reversals.
- Pending disputes or adjustments.
- Net collected funds.
- Active recurring commitment.
- Annualized commitment, clearly labeled as a projection.

Renewals increase collected totals but do not increase sponsor or sponsorship counts. A canceled subscription retains its collected history and leaves active commitment totals. A new subscription after cancellation receives a new intent and a fresh attribution decision.

Financial views should support both cohort reporting and cash activity reporting so later refunds do not silently make historical charts appear haunted.

## 7. Automated domain provisioning

Cloudflare remains authoritative DNS for the MVP. True wildcard DNS is not required.

For each advocate, an idempotent provisioner will:

1. Reserve and validate the slug against the database backed reserved registry.
2. Create the inactive advocate and exact domain record.
3. Add the exact domain to the Vercel project through its API, then require provider verification with no redirect, Git branch, or custom environment binding.
4. Add an exact DNS only CNAME in Cloudflare through a zone scoped API token.
5. Reconcile each provider attachment until every required integration reports its bounded API readiness evidence, then leave the domain in `verifying`.
6. Prove strict DNS absence for one random unprovisioned sibling, then reconcile and independently resolve the fixed reserved negative sentinel before comparing its verified HTTPS 404 byte for byte with the hidden tenant root.
7. Preserve the structured canary report in protected release evidence and calculate its SHA256 digest.
8. Require a Creator Share super administrator to promote the exact domain with the expected advocate version, evidence digest, deployment identity, and reason.

The provisioner stores desired and observed state, external object IDs, configuration version, attempts, timestamps, and sanitized failures. Retries are idempotent. A scheduled reconciler detects drift. Provider API readiness never publishes a tenant by itself. Cloudflare record creation, Vercel attachment, Stripe account access, and PayPal credential access do not prove that the exact public hostname serves the right tenant over TLS or can safely initiate checkout.

The one-minute provisioner route uses a 50 second absolute monotonic invocation deadline under Vercel's 60 second limit. Scheduling, claim, context, reconciliation recording, and lease work abort before a reserved final 10 second settlement window. Completion and retry remain bounded by the same absolute route deadline. Provider HTTP timeouts are derived from the same remaining work budget. A timeout after provider acceptance therefore converges through exact lease-fenced reconciliation instead of allowing a serial database call to run through the host termination boundary.

All vendor provisioning and reconciliation remains API driven and requires no manual vendor console work. MVP publication is a separate audited release decision over independently captured canary evidence. This preserves automated infrastructure while preventing a weak provider status from silently opening a money accepting tenant.

Deactivation separates reversible suspension from irreversible archive. Suspension disables public tenant resolution and reconciliation but leaves provider attachments intact. Archive disables the tenant immediately, suppresses reconciliation, and waits through a 20 minute quiescence period before provider cleanup. The archive coordinator runs once per minute and permits at most one current provider job for the tenant.

Archive cleanup is serial and strictly ordered: Cloudflare, Vercel, Stripe US, Stripe UK, then PayPal. Each phase advances only after verified success for the preceding provider. A failed or cancelled current job produces the terminal `needs_attention` state. Automation does not skip, reorder, or invent retries. After the provider issue is corrected, a Creator Share super administrator may submit one exact recovery request with the current version, stable operation ID, and reason. The database derives the only eligible terminal job and provider phase. The browser cannot select the provider, integration, job, phase, or retry order.

Cloudflare cleanup removes the exact tenant DNS record, and Vercel cleanup releases the exact tenant project domain. The later Stripe US, Stripe UK, and PayPal phases retire only Creator Share's local hosted-checkout integration projections. They do not delete payment-provider accounts, catalog objects, customers, or subscriptions.

All suspension, archive, cleanup, recovery, and ownership changes preserve attribution, sponsorship, financial, membership, and append-only audit history. Provider cleanup does not release the slug for reuse.

Production tenant hosts are exactly one label below `creatorshare.com`. The apex, `www`, and every reserved label are non-tenant.

Initial reserved labels should include:

- `www`, `app`, `api`, `admin`, `auth`, `login`, `account`, and `accounts`.
- `dev`, `development`, `staging`, `stage`, `test`, `preview`, and `local`.
- `tanzania`, `support`, `help`, `status`, `docs`, `blog`, and `media`.
- `mail`, `email`, `smtp`, `imap`, `pop`, `cdn`, `static`, and `assets`.
- `stripe`, `paypal`, `payments`, `checkout`, `billing`, and `webhooks`.
- `security`, `legal`, `privacy`, `terms`, `abuse`, and `postmaster`.
- `advocate`, `advocates`, `creator`, `creators`, `campaign`, and `campaigns`.
- `publication-sentinel`, reserved permanently for shared negative-control infrastructure.

The registry is extensible. Slugs are never released automatically for reuse.

### 7.1 Why Cloudflare stays authoritative

Benefits:

- No risky zone migration during the product build.
- Existing Cloudflare controls and records remain intact.
- Exact records provide clean tenant lifecycle isolation.
- Cloudflare and Vercel APIs can both be fully automated.

Costs:

- Provisioning and reconciliation touch two vendors.
- Credentials and failure states exist for both vendors.

Moving DNS to Vercel would simplify wildcard certificates and remove one provisioning call, but would require a complete record inventory, nameserver migration, Cloudflare feature parity review, rollback plan, and new operational ownership. It does not remove the need for payment domain registration if Embedded Checkout is adopted later. The cost benefit does not favor migration for this MVP.

## 8. Retention

| Data                                        | Default retention                                         |
| ------------------------------------------- | --------------------------------------------------------- |
| Financial records and attribution decisions | Indefinite.                                               |
| Business audit events with redacted content | Indefinite.                                               |
| Raw exposure and visitor linkage            | About 400 days.                                           |
| Raw IP address and user agent forensic data | 90 days.                                                  |
| Encrypted checkout contact material         | Until terminal settlement and welcome materialization.    |
| Recent sponsor email-authentication receipt | Fifteen-minute authority, removed by the next hourly run. |
| Passwordless delivery reservation           | Twenty-four-hour quota window plus the next hourly run.   |
| Passwordless verification attempt           | Twenty-four-hour quota window plus the next hourly run.   |
| Policy versioned advocate delegate events   | Indefinite, with no historical backfill.                  |
| Provider and infrastructure logs            | Longest practical retention supported by plan and budget. |

Deletion and anonymization jobs must preserve aggregate and financial integrity while removing expired direct identifiers.

Browser client IP and user agent values captured during Creator Share ownership, lifecycle, and cleanup recovery actions live solely in `audit.audit_event_forensics` under the 90 day row above. Their deletion does not alter the indefinitely retained semantic decision receipt or redacted business audit event.

The MVP runs one bounded retention invocation hourly at minute 17. It independently commits checkout contact erasure, welcome email contact redaction, gateway payload redaction, raw audit forensic deletion, sponsor authentication evidence deletion, and advocate tracking deletion in privacy-first order. Expired recent-authentication receipts are removed by the next healthy run, for a maximum healthy lifetime of about 75 minutes from authentication. Passwordless reservations remain for the complete 24-hour quota window and are removed by the next healthy run, for a maximum healthy lifetime of about 25 hours. Later steps still run after an earlier failure. Sanitized append-only run evidence records failures and remaining backlog, and every nonclean invocation must alert for retry. Operational details live in [the advocate domain publication runbook](./advocate-domain-publication-runbook.md).

## 9. Delivery sequence

### Phase 0: Security and schema foundation

- Reconcile live grants, policies, functions, and migration history.
- Correct the unsafe legacy role assignment posture.
- Add the advocate tenant, domain, branding, catalog, membership, invitation, and audit schema.
- Add identity, exposure, intent, attribution, payment attempt, gateway event, claim, and outbox schema.
- Add automated database security checks.

This phase is a release gate. The current invitation flow cannot be extended because it trusts user editable metadata for role assignment.

### Phase 1: Trusted payment and identity core

- Add the server owned intent API.
- Refactor Stripe US, Stripe UK, and PayPal creation to consume intents.
- Make provider webhooks idempotent and authoritative.
- Add refund, reversal, dispute, and renewal ledger parity.
- Add passwordless account claim and sponsorship management.
- Add stateless cross-device magic-link sign in and recent-action authentication with privacy-safe atomic delivery limits.
- Add the durable welcome email sequence.
- Cryptographically erase sealed checkout contact material after terminal settlement and welcome materialization while retaining noncontact fingerprints and audit evidence.

The v2 checkout database functions and application callers use an additive two phase release. Follow [the payment boundary release runbook](./advocate-payment-release-runbook.md). The database release gate is deployment evidence, not a runtime request flag. Legacy service scoped functions are revoked only in a later migration after the v2 caller deployment and warm instance drain are proven.

### Phase 2: Tenant routing and provisioning

- Resolve every host through exact active domain records.
- Add qualified exposure capture and the latest touch resolver.
- Implement Cloudflare and Vercel provisioning jobs and reconciliation.
- Add the authenticated Creator Share onboarding surface that reserves each tenant and starts the exact provider workflow.
- Add host aware provider return URLs.
- Add tenant, TLS, strict random sibling DNS absence, persistent negative sentinel, and checkout canaries.
- Require audited super-administrator publication after independent exact-host canary evidence. Follow [the advocate domain publication runbook](./advocate-domain-publication-runbook.md).

### Phase 3: Advocate experiences

- Build the branded public browsing and sponsorship experience.
- Build branding, catalog, public metric, membership, and invitation administration.
- Build privacy safe direct and post visit analytics.
- Build the policy versioned advocate audit disclosure ledger and sanitized view.
- Build Creator Share approval and exact replay tools for ownership, suspension, resume, repair, irreversible archive, and terminal cleanup recovery.
- Build usable provisioning-status and publication controls that preserve their stable operation identity across timeouts and page reloads.
- Enforce 20 minute archive quiescence, strict five-provider cleanup order, one-minute coordination, and browser-independent recovery targeting.

Catalog administration uses optimistic advocate version fencing, exact ordered child selections, and unsaved-change protection. Chromium and other reliable Navigation API engines synchronously confirm browser history traversal. Apple WebKit uses a session draft because its current traversal cancellation and replay behavior cannot safely support a delayed custom decision. The versioned draft key and payload bind the authenticated account, immutable advocate ID, and portal slug. The stored payload contains only canonical catalog choices and the single-line change note, binds the saved catalog fingerprint, rejects unknown children and noncanonical shapes, and rebinds to the current aggregate advocate version only when the saved catalog itself is unchanged. Draft writes flush on ordinary updates, page hiding, and document visibility loss. A storage failure is visible to the administrator, and WebKit falls back to a native traversal prompt when its Navigation API is available. Save, explicit reset, and a confirmed discard leave a deliberately clean form even when another browser listener later cancels navigation.

Catalog eligibility is introduced through a forward-only migration so an existing database and a fresh reset execute the same transition. Previously recorded migrations remain byte stable. Administration exposes a child's presentation fields only while that child is currently eligible for the public advocate catalog. A selected child that becomes ineligible remains available for removal by opaque identifier, but its name, username, status, and reason for exclusion do not cross the portal boundary.

`yarn test:advocate:webkit` is the required automated release gate. The matching GitHub workflow installs Playwright WebKit and exercises back and forward recovery with an iPhone viewport and device profile. This is browser-engine emulation, not evidence from Mobile Safari on physical iOS hardware. Release evidence must therefore also include a manual current-iOS smoke check covering back navigation, forward navigation, tab backgrounding, and return after process eviction. Neither automated nor manual evidence may place sponsor, contact, or payment data in browser storage.

### Phase 4: Release validation

- Database reset and migration validation.
- RLS tests for anonymous, sponsor, advocate member, advocate nonmember, and Creator Share administrator personas.
- Unit tests for host, attribution, pricing, identity, and permission decisions.
- Integration tests for all gateways, currencies, modes, retries, renewals, refunds, disputes, and cancellations.
- Production-equivalent canaries for passwordless account enumeration, delivery limits, custom templates, mail scanners, cross-device completion, token leakage, live-session recent authentication, and Stripe US, Stripe UK, and PayPal payment management.
- Browser tests for primary, advocate, mobile, and provider return flows, including automated Playwright WebKit emulation and a separate manual current iOS catalog draft recovery smoke check.
- Live PostgREST role claim canaries for both service key formats, authenticated sponsor calls, and anonymous and ordinary-user deny controls.
- Provisioning failure and drift exercises.
- Privacy reconstruction review and audit redaction review.
- Audit persona, cursor isolation, exact event mapping, near match exclusion, append only, and no backfill review.
- Operational runbooks, metrics, alerts, rollback, and support training.

## 10. Substantive engineering callouts

### Very high: payment and financial event parity

The intent abstraction is compact. Retrofitting every Stripe and PayPal path, proving webhook idempotency, and reconciling renewals, refunds, reversals, disputes, and retries is not compact. This is the most consequential correctness work because it controls both money and reporting.

### High: live database security reconciliation

Migration history currently contains broad grants and a later RLS disablement on legacy role assignments. Repository migrations cannot be assumed to describe the live database. The team must inventory live state, produce a corrective migration, and test every persona.

### High: automated domain lifecycle

Creating one DNS record is easy. A reliable state machine across Cloudflare, Vercel, Stripe US, Stripe UK, PayPal, TLS, publication, retry, repair, reversible suspension, irreversible archive, drift detection, and takeover prevention is real infrastructure work. Archive adds a 20 minute quiescence boundary, a strict serial cleanup coordinator, terminal intervention state, and exact recovery that must not let a browser choose or reorder provider work.

The publication negative control is shared infrastructure, not a disposable fake tenant. It requires a permanently reserved label, a dedicated scheduled reconciler, exact API reconciliation in both providers, provider verification convergence, independent DNS pinning, normal TLS verification, and a byte-identical application rejection. Routine provider, DNS, certificate, and transport propagation remains nonterminal. No tenant canary is claimed until the shared preflight is ready. The final canary then repeats a read-only provider inspection and every network observation independently. A truly absent random sibling cannot also provide an HTTPS rejection because it has neither DNS nor a certificate, which is why the proof deliberately separates five-type DNS absence from the hosted sentinel. Scheduled attempts retain only append-only fixed stage and outcome codes plus a hashed request reference in the protected audit schema.

### High: identity claims across historic providers

Email verification is low friction. Correctly linking historic subscriptions across two Stripe accounts and PayPal, avoiding collisions, preserving email change semantics, and providing reversible support operations requires careful reconciliation.

### High: delegate invitation authentication and delivery

The invitation is both an authorization grant and a cross-device email flow. It must bind a specific account and email, keep capability and provider proof out of request targets and browser storage, distinguish a fresh email authentication event from a refreshed session, survive mobile email clients, and remain single use under concurrency. Supabase proof supersession and SMTP acceptance ambiguity are provider behaviors with security and delivery consequences. They require production equivalent canaries, durable quarantine, and explicit operator policy.

### High: privacy safe analytics

Aggregate SQL is straightforward. Preventing small cohort, complement, export, audit, and recognition surfaces from reconstructing sponsor behavior requires a deliberate query boundary and adversarial tests.

### Medium to high: auth across subdomains

The experience must handle cookies, magic links, OTP entry, return URLs, CSRF, origin validation, session refresh, and mobile email clients across primary and advocate hosts. The plan must not promise cross device attribution for anonymous visits that cannot technically be joined.

### Medium to high: cross-subdomain attribution token

Post visit attribution requires one pseudonymous token to survive an advocate visit and a later primary site checkout. The token must be authenticated, normalized against cookie tossing, hashed identically at exposure and checkout, and handled without blocking payment if analytics cryptography fails. Its parent domain scope also sends it to every Creator Share sibling host, so production release requires a complete DNS and hosting trust inventory. A dedicated signing key keeps middleware separate from payment and contact encryption.

### Medium: constrained branding

Colors and logos are routine. Rich text sanitation, contrast validation, storage controls, cache invalidation, preview, rollback, and prevention of advocate supplied tracking require engineering discipline.

## 11. Release gates

No advocate tenant may publish until all of the following are true:

- Legacy invitation privilege escalation is removed or isolated from all advocate access.
- Advocate invitation redemption proves a fresh email authentication event, remains single use under concurrency, and passes the provider proof supersession canary for overlapping advocate and sponsor account links.
- Sponsor magic links use the exact hosted template and redirect allowlist, require explicit continuation, create no session on page load or scanner fetch, work across browser cookie jars, and leak no token into request URLs, referrers, storage, analytics, history, or logs.
- Generic sponsor sign in and recent-action authentication never create accounts. Account creation is limited to a validated unconsumed initial sponsorship claim or the explicit bounded password registration surface, both with exact email confirmation and uniform public delivery responses.
- Sponsor cancellation and payment-method management require an unexpired server receipt bound to the exact healthy user and exact live authentication session.
- The passwordless delivery limiter atomically partitions public sign-in and registration capacity from protected reauthentication and validated claim capacity inside hard provider ceilings. Token verification has a separate purpose-separated source and global limiter, stores no token-derived material, and runs before the provider call.
- Exposed application tables have verified RLS and least privilege grants.
- Every payment path creates and verifies a server owned intent.
- Webhooks are authenticated, idempotent, and authoritative.
- Both regional Stripe Billing Portal configurations are enabled, the live subscription override inventory is empty or explicitly reconciled, and runtime checks fail closed on subscription-level payment-method overrides or unsupported collection modes.
- The exact host remains nonpublic in `verifying` until the independent canary report is complete.
- Provisioning, TLS, HTTP tenant, and checkout canaries pass.
- A random sibling proves exact DNS absence, while the separately resolved and pinned `publication-sentinel.creatorshare.com` proves automated provider readiness, normal TLS, hostname verification, and the byte-identical neutral 404.
- A Creator Share super administrator promotes the expected advocate version and exact primary domain through the audited publication function using the protected canary report digest.
- The dedicated visitor signing secret passes a production canary and differs from every payment or contact encryption key.
- The production build proves Edge middleware selection. A Vercel canary accepts one exact provisioned tenant hostname and rejects an unprovisioned sibling hostname.
- Every Creator Share sibling hostname has an approved DNS, hosting, and cookie trust inventory entry.
- Advocate roles cannot read sponsor contact or raw tracking data.
- Audit redaction and append only protections pass adversarial tests.
- Creator Share ownership and lifecycle controls prove staff reauthorization, optimistic state fencing, required reasons, exact replay, append-only receipts, and transaction-bound mutation guards.
- Archive exercises prove immediate suppression, 20 minute quiescence, one-minute coordination, strict Cloudflare, Vercel, Stripe US, Stripe UK, and PayPal cleanup order, terminal `needs_attention`, and exact super administrator recovery without browser-selected provider or job input.
- Browser lifecycle forensics remain private, are absent from advocate delegate responses, and are removed after 90 days without deleting semantic audit history.
- Retention cleanup jobs are configured, including hourly removal of expired sponsor authentication receipts, passwordless delivery reservations, and passwordless verification attempts after their complete quota windows.
- Sealed checkout contact ciphertext is erased after its recovery and welcome duties end.
- Rollback and suspension procedures are exercised.

## 12. MVP exclusions

The following are intentionally excluded from the first release and tracked in the repo-wide fast follow register:

- Campaigns and campaign specific attribution.
- Custom top level domains and foreign parent subdomains.
- Multi touch attribution and modeled fractional credit.
- Embedded Stripe Checkout and per-domain wallet registration.
- PayPal Apple Pay domain registration.
- Custom advocate role construction.
- Public sponsor recognition.
- Unified external forensic log ingestion.
- Team support tooling for identity merges and missing subscription inquiries.
- Existing sponsor outreach before approved reconciliation.
- Tenant-initiated ownership transfer requests and Creator Share approval workflow.
- A richer Creator Share lifecycle operations console beyond the bounded MVP controls and generic attention state.

## 13. Decision log

The MVP initial-owner bootstrap uses an email-first, single-use invitation. A Creator Share super administrator submits the exact reserved slug, display name, advocate type, owner email, reason, and stable operation ID. One transaction creates an ownerless `invited` and `draft` tenant, default branding, and encrypted initial-owner delivery authority. Successful redemption verifies the exact healthy email account and capability, creates the sole Owner membership atomically, activates the advocate relationship, and only then starts the exact five-provider provisioning topology. Abandoned, expired, or revoked invitations perform no provider work and keep the slug reserved for audited reissue. Creator Share staff never become temporary portal owners.

Any change to attribution windows, guest checkout, payment presentation, public identity exposure, DNS authority, tenant boundaries, owner bootstrap, or financial semantics requires an explicit architecture amendment in this document and an audit friendly migration or configuration version where applicable.
