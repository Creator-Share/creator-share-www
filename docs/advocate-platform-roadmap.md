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

Passwordless email OTP or magic link is the default. A password is optional. Guest sponsorship remains available.

After verifying an email, an account can claim historical subscriptions associated with that email across Stripe US, Stripe UK, and PayPal. Claims attach records to a stable sponsor identity. Subsequent access uses that stable identity instead of repeating an email query.

Changing an account email preserves already attached subscriptions and does not automatically claim another email address's history. Manual identity reconciliation and a team support tool are fast follows.

Existing sponsors may receive a one time invitation campaign only after identity backfill and reconciliation are complete. That outreach requires separate approval.

### 3.6 Account management contract

An authenticated sponsor can:

- View every claimed sponsorship and subscription.
- Open the correct provider flow to update a payment method.
- Cancel future billing after recent verification.

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

Invitations use at least 256 bits of randomness. Only a digest is stored. Invitations are email bound, expire after seven days, can be revoked, are single use, and redeem atomically. User editable authentication metadata must never grant authorization.

Creator Share super administrators remain separate from advocate membership. Domain, ownership, and tenant lifecycle changes require Creator Share approval. An override requires a reason and an audit event.

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

Database and provider logs corroborate DDL, direct SQL, policy changes, disabled triggers, and managed service actions that row triggers cannot reliably identify. Unified ingestion of every external log into one interface is a fast follow.

## 5. Privacy boundaries

Advocate users receive purpose built aggregate analytics. They never receive raw access to sponsor identities, emails, payment customer data, browser visitors, or attribution rows.

Authorized advocate administrators may see a recognition label consisting of full first name and the first initial of the last name. They may not see contact information. That label must not be paired with exact timestamps, exact amounts, granular location, device details, or an individual journey history.

No explicit recognition consent is required for this private administrative surface. Public sponsor names are not part of the MVP.

Segmented behavioral cells with fewer than five sponsors are suppressed. Complementary queries must not allow trivial reconstruction. Geography, time, and monetary values are bucketed where needed.

Public metric selections come from a fixed allowlist of privacy safe metrics. Advocates cannot publish arbitrary queries.

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
3. Add the exact domain to the Vercel project through its API.
4. Add an exact DNS only CNAME in Cloudflare through a zone scoped API token.
5. Poll domain verification and TLS readiness.
6. Run an HTTP canary that proves the hostname resolves to the expected advocate.
7. Run checkout initiation canaries for supported providers.
8. Publish only after all required checks pass.

The provisioner stores desired and observed state, external object IDs, configuration version, attempts, timestamps, and sanitized failures. Retries are idempotent. A scheduled reconciler detects drift.

Deactivation disables the tenant first, removes DNS before releasing the Vercel domain, and preserves attribution and financial history.

Production tenant hosts are exactly one label below `creatorshare.com`. The apex, `www`, and every reserved label are non-tenant.

Initial reserved labels should include:

- `www`, `app`, `api`, `admin`, `auth`, `login`, `account`, and `accounts`.
- `dev`, `development`, `staging`, `stage`, `test`, `preview`, and `local`.
- `tanzania`, `support`, `help`, `status`, `docs`, `blog`, and `media`.
- `mail`, `email`, `smtp`, `imap`, `pop`, `cdn`, `static`, and `assets`.
- `stripe`, `paypal`, `payments`, `checkout`, `billing`, and `webhooks`.
- `security`, `legal`, `privacy`, `terms`, `abuse`, and `postmaster`.
- `advocate`, `advocates`, `creator`, `creators`, `campaign`, and `campaigns`.

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
| Sanitized audit metadata                    | Indefinite.                                               |
| Provider and infrastructure logs            | Longest practical retention supported by plan and budget. |

Deletion and anonymization jobs must preserve aggregate and financial integrity while removing expired direct identifiers.

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
- Add the durable welcome email sequence.
- Cryptographically erase sealed checkout contact material after terminal settlement and welcome materialization while retaining noncontact fingerprints and audit evidence.

The v2 checkout database functions and application callers use an additive two phase release. Follow [the payment boundary release runbook](./advocate-payment-release-runbook.md). The database release gate is deployment evidence, not a runtime request flag. Legacy service scoped functions are revoked only in a later migration after the v2 caller deployment and warm instance drain are proven.

### Phase 2: Tenant routing and provisioning

- Resolve every host through exact active domain records.
- Add qualified exposure capture and the latest touch resolver.
- Implement Cloudflare and Vercel provisioning jobs and reconciliation.
- Add host aware provider return URLs.
- Add tenant, TLS, and checkout canaries.

### Phase 3: Advocate experiences

- Build the branded public browsing and sponsorship experience.
- Build branding, catalog, public metric, membership, and invitation administration.
- Build privacy safe direct and post visit analytics.
- Build the sanitized advocate audit view.
- Build Creator Share approval and override tools.

### Phase 4: Release validation

- Database reset and migration validation.
- RLS tests for anonymous, sponsor, advocate member, advocate nonmember, and Creator Share administrator personas.
- Unit tests for host, attribution, pricing, identity, and permission decisions.
- Integration tests for all gateways, currencies, modes, retries, renewals, refunds, disputes, and cancellations.
- Browser tests for primary, advocate, mobile, and provider return flows.
- Provisioning failure and drift exercises.
- Privacy reconstruction review and audit redaction review.
- Operational runbooks, metrics, alerts, rollback, and support training.

## 10. Substantive engineering callouts

### Very high: payment and financial event parity

The intent abstraction is compact. Retrofitting every Stripe and PayPal path, proving webhook idempotency, and reconciling renewals, refunds, reversals, disputes, and retries is not compact. This is the most consequential correctness work because it controls both money and reporting.

### High: live database security reconciliation

Migration history currently contains broad grants and a later RLS disablement on legacy role assignments. Repository migrations cannot be assumed to describe the live database. The team must inventory live state, produce a corrective migration, and test every persona.

### High: automated domain lifecycle

Creating one DNS record is easy. A reliable state machine across Cloudflare, Vercel, TLS, publication, retry, rename, suspension, deletion, drift detection, and takeover prevention is real infrastructure work.

### High: identity claims across historic providers

Email verification is low friction. Correctly linking historic subscriptions across two Stripe accounts and PayPal, avoiding collisions, preserving email change semantics, and providing reversible support operations requires careful reconciliation.

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
- Exposed application tables have verified RLS and least privilege grants.
- Every payment path creates and verifies a server owned intent.
- Webhooks are authenticated, idempotent, and authoritative.
- The exact host resolves through an active domain record.
- Provisioning, TLS, HTTP tenant, and checkout canaries pass.
- The dedicated visitor signing secret passes a production canary and differs from every payment or contact encryption key.
- The production build proves Edge middleware selection. A Vercel canary accepts one exact provisioned tenant hostname and rejects an unprovisioned sibling hostname.
- Every Creator Share sibling hostname has an approved DNS, hosting, and cookie trust inventory entry.
- Advocate roles cannot read sponsor contact or raw tracking data.
- Audit redaction and append only protections pass adversarial tests.
- Retention cleanup jobs are configured.
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

## 13. Decision log

All architecture questions required to begin implementation are closed. Any change to attribution windows, guest checkout, payment presentation, public identity exposure, DNS authority, tenant boundaries, or financial semantics requires an explicit architecture amendment in this document and an audit friendly migration or configuration version where applicable.
