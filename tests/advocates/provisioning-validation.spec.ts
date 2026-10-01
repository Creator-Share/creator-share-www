import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  ClaimedDomainProvisioningJob,
  DomainProvisioningContext,
} from "@/lib/advocates/provisioning/types"

/**
 * Two provisioning worker guards that no test referenced.
 *
 * `assertSafeProviderEvidence` is what keeps raw provider text out of durable
 * evidence. It holds a key allowlist and a value contract; a mutation removing
 * the value check left the allowlist in place and the suite green, so an
 * adapter or a chatty provider response could persist arbitrary text into
 * append-only records that are meant to carry only fixed, sanitized codes.
 *
 * `assertContextMatchesJob` decides whether a claimed job may still act. A
 * mutation dropping the publish-eligibility term from the reconcile branch
 * also left the suite green, which would let a worker keep reconciling a
 * tenant an administrator had explicitly suspended or archived.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/provisioning-validation.spec.ts"),
)
const { assertSafeProviderEvidence, assertContextMatchesJob } = testRequire(
  "../../src/lib/advocates/provisioning/validation",
) as typeof import("../../src/lib/advocates/provisioning/validation")
nodeModule._load = originalModuleLoad

const ADVOCATE_ID = "11111111-1111-4111-8111-111111111111"
const DOMAIN_ID = "22222222-2222-4222-8222-222222222222"
const INTEGRATION_ID = "33333333-3333-4333-8333-333333333333"
const HOSTNAME = "hope.creatorshare.com"

function job(
  overrides: Partial<ClaimedDomainProvisioningJob> = {},
): ClaimedDomainProvisioningJob {
  return {
    jobId: "44444444-4444-4444-8444-444444444444",
    advocateId: ADVOCATE_ID,
    domainId: DOMAIN_ID,
    integrationId: INTEGRATION_ID,
    kind: "reconcile",
    provider: "cloudflare",
    attemptCount: 1,
    maxAttempts: 5,
    providerIdempotencyKey: "provisioning:reconcile:1",
    requestPayload: {
      schema_version: 1,
      reconciliation_policy: "lookup_before_mutation",
    },
    leaseToken: "55555555-5555-4555-8555-555555555555",
    ...overrides,
  } as ClaimedDomainProvisioningJob
}

function context(
  overrides: Partial<DomainProvisioningContext> = {},
): DomainProvisioningContext {
  return {
    advocateId: ADVOCATE_ID,
    advocateRelationshipStatus: "active",
    advocatePublicationStatus: "active",
    domainId: DOMAIN_ID,
    hostname: HOSTNAME,
    domainStatus: "active",
    integrationId: INTEGRATION_ID,
    integrationProvider: "cloudflare",
    integrationIsRequired: true,
    integrationStatus: "active",
    integrationExternalIdentifier: null,
    ...overrides,
  }
}

test.describe("provisioning worker validation", () => {
  test("keeps raw provider text out of durable evidence", async () => {
    // The allowlist alone is not the control. These keys are all allowed; it
    // is the value contract that stops provider prose, quoting, whitespace,
    // and injected newlines from reaching append-only evidence.
    const unsafeValues = [
      "not a safe code",
      'said "no"',
      "line\nbreak",
      "<script>",
      "trailing;drop",
      "",
      "x".repeat(501),
      "-leading-punctuation",
    ]

    for (const unsafe of unsafeValues) {
      expect(
        () => assertSafeProviderEvidence({ provider_status: unsafe }),
        `${JSON.stringify(unsafe)} must not reach durable evidence`,
      ).toThrow()
    }

    // A well-formed record still passes, so the assertion is about the value
    // contract rather than about rejecting everything.
    expect(() =>
      assertSafeProviderEvidence({
        provider_status: "pending_validation",
        provider_resource_id: "zone/abc-123",
        http_status: 202,
        verified: false,
      }),
    ).not.toThrow()
  })

  test("rejects unknown keys and malformed scalars in evidence", async () => {
    expect(() =>
      assertSafeProviderEvidence({
        provider_error_body: "anything",
      } as never),
    ).toThrow()

    for (const status of [99, 600, 200.5, "200" as never]) {
      expect(
        () => assertSafeProviderEvidence({ http_status: status as never }),
        `http_status ${String(status)} must be refused`,
      ).toThrow()
    }

    expect(() =>
      assertSafeProviderEvidence({ verified: "true" as never }),
    ).toThrow()
  })

  test("refuses to reconcile a tenant an administrator took down", async () => {
    // Suspend and archive are the lifecycle actions that set these statuses.
    // A worker that kept reconciling afterwards would continue mutating
    // provider state for a tenant Creator Share had explicitly taken down.
    for (const takenDown of [
      { advocateRelationshipStatus: "suspended" },
      { advocateRelationshipStatus: "archived" },
      { advocateRelationshipStatus: "invited" },
      { advocatePublicationStatus: "suspended" },
    ]) {
      expect(
        () =>
          assertContextMatchesJob(
            job({ kind: "reconcile" }),
            context(takenDown),
          ),
        `${JSON.stringify(takenDown)} must not be reconciled`,
      ).toThrow()
    }

    // An active tenant still reconciles, so the guard is asserted from both
    // sides rather than being satisfiable by refusing every reconcile.
    expect(() =>
      assertContextMatchesJob(job({ kind: "reconcile" }), context()),
    ).not.toThrow()
  })

  test("refuses to provision a tenant an administrator took down", async () => {
    // The provision branch carries the same eligibility term.
    expect(() =>
      assertContextMatchesJob(
        job({ kind: "provision" }),
        context({
          advocateRelationshipStatus: "suspended",
          domainStatus: "pending",
          integrationStatus: "pending",
        }),
      ),
    ).toThrow()

    expect(() =>
      assertContextMatchesJob(
        job({ kind: "provision" }),
        context({ domainStatus: "pending", integrationStatus: "pending" }),
      ),
    ).not.toThrow()
  })
})
