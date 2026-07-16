# Repo-Wide Fast Follow Register

This is the canonical register for intentionally deferred product, platform, security, and operational work. Every future task must review relevant entries, update any item it affects, add newly discovered debt, and close paid down work with evidence.

Status values are `proposed`, `accepted`, `in_progress`, `blocked`, `completed`, and `declined`.

| ID     | Status   | Priority | Item                                                   | Rationale and completion trigger                                                                                                                                                                                     |
| ------ | -------- | -------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FF-001 | accepted | P0       | Advocate campaigns                                     | Add campaign entities, scoped links, creative, and campaign analytics after the MVP attribution contract is stable. Complete when campaigns have explicit lifecycle, attribution, privacy, and reporting tests.      |
| FF-002 | accepted | P0       | Identity reconciliation support console                | Give authorized Creator Share staff reversible merge, split, claim, and missing subscription resolution tools with reason required audit events. Complete before support volume makes database intervention routine. |
| FF-003 | accepted | P0       | Existing sponsor account invitation campaign           | Backfill and reconcile sponsor identities, dry run collision reports, approve email copy and audience, then send a one time claim invitation. This requires separate product approval before outreach.               |
| FF-004 | accepted | P1       | Custom top level domains and foreign parent subdomains | Add ownership proof, certificate lifecycle, payment method domain handling where required, abuse controls, and deprovisioning. Trigger after exact Creator Share subdomains are operationally stable.                |
| FF-005 | accepted | P1       | Multi touch attribution                                | Preserve exposure history and add versioned multi touch models without rewriting factual direct or latest touch records. Complete when methodology, reporting language, and privacy impact are approved.             |
| FF-006 | accepted | P1       | Modeled fractional attribution                         | Add versioned decay or fractional scores separately from collected funds. Complete only after a documented business methodology and validation plan exist.                                                           |
| FF-007 | accepted | P1       | Unified forensic audit ingestion                       | Correlate application audit, Supabase platform and auth logs, database DDL and privileged SQL, Vercel, Cloudflare, Stripe, and PayPal events in one protected interface.                                             |
| FF-008 | accepted | P1       | Custom advocate role builder                           | Add tenant defined roles only after the predefined permission system has sufficient operational evidence and privilege escalation tests.                                                                             |
| FF-009 | accepted | P1       | Advanced account security                              | Evaluate passkeys, OAuth, recovery codes, stronger reauthentication, session management, and optional MFA after passwordless MVP adoption is measured.                                                               |
| FF-010 | accepted | P1       | Analytics exports                                      | Add privacy safe CSV and PDF exports with suppression, access logging, rate limits, and retention controls.                                                                                                          |
| FF-011 | accepted | P2       | Advanced cohort analytics                              | Add mature cohort conversion, funnel, geography, device, and retention views without exposing small sponsor groups.                                                                                                  |
| FF-012 | accepted | P2       | Non-child causes                                       | Add initiatives or other cause types through explicit foreign keys and domain models. Do not revive a generic polymorphic cause pair.                                                                                |
| FF-013 | accepted | P2       | Experimentation and lift measurement                   | Add holdouts and incrementality testing so influence can be separated from association where traffic volume permits.                                                                                                 |
| FF-014 | accepted | P1       | Embedded Stripe Checkout evaluation                    | Pilot exact-host payment entry, per-host Payment Method Domain registration, wallet readiness monitoring, and both Stripe accounts only if product value justifies the infrastructure cost.                          |
| FF-015 | accepted | P1       | PayPal Apple Pay                                       | Resolve its domain association and registration process, including automation limits, before enabling it on advocate domains.                                                                                        |
| FF-016 | accepted | P2       | Public sponsor recognition                             | Design a separate public recognition consent, revocation, privacy, and moderation surface if requested. Private advocate visibility remains separately constrained.                                                  |
| FF-017 | accepted | P1       | Vercel authoritative DNS evaluation                    | Revisit only after exact-domain provisioning is stable. Require complete record inventory, Cloudflare feature parity, rollback, and incident ownership.                                                              |

## Entry requirements

Every new entry must include:

- A stable ID.
- Status and priority.
- The deferred outcome.
- Why it is deferred.
- The condition that should trigger implementation.
- Acceptance evidence when completed.
- A pull request, issue, or decision link when one exists.

Completed entries stay in this file as historical decisions. Do not delete the receipts merely because the kitchen looks cleaner.
