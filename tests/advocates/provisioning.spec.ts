import { expect, test } from "@playwright/test"

import { isAuthorizedDomainWorkerRequest } from "../../src/lib/advocates/provisioning/auth"
import { CloudflareDomainAdapter } from "../../src/lib/advocates/provisioning/cloudflare"
import {
  loadCloudflareProvisioningConfig,
  loadDomainWorkerConfig,
  loadVercelProvisioningConfig,
} from "../../src/lib/advocates/provisioning/config"
import { VercelDomainAdapter } from "../../src/lib/advocates/provisioning/vercel"
import { processDomainProvisioningJob } from "../../src/lib/advocates/provisioning/worker"
import type { DomainProvisioningRepository } from "../../src/lib/advocates/provisioning/repository"
import type {
  ClaimedDomainProvisioningJob,
  DomainProviderAdapter,
  DomainProvisioningContext,
  ProviderReconciliation,
  SafeProviderEvidence,
} from "../../src/lib/advocates/provisioning/types"

const job: ClaimedDomainProvisioningJob = {
  jobId: "11111111-1111-4111-8111-111111111111",
  advocateId: "22222222-2222-4222-8222-222222222222",
  domainId: "33333333-3333-4333-8333-333333333333",
  integrationId: "44444444-4444-4444-8444-444444444444",
  kind: "provision",
  provider: "cloudflare",
  attemptCount: 1,
  maxAttempts: 8,
  providerIdempotencyKey: "a".repeat(64),
  requestPayload: {
    schema_version: 1,
    reconciliation_policy: "lookup_before_mutation",
  },
  leaseToken: "55555555-5555-4555-8555-555555555555",
  leaseExpiresAt: "2026-07-18T12:00:00.000Z",
  reconciliationRequired: true,
}

const context: DomainProvisioningContext = {
  advocateId: job.advocateId,
  advocateRelationshipStatus: "active",
  advocatePublicationStatus: "draft",
  domainId: job.domainId,
  hostname: "alice.creatorshare.com",
  domainStatus: "provisioning",
  integrationId: job.integrationId,
  integrationProvider: "cloudflare",
  integrationStatus: "provisioning",
  integrationExternalIdentifier: null,
}

const cloudflareConfig = {
  apiToken: "cloudflare_token_that_is_long_enough",
  zoneId: "a".repeat(32),
  cnameTarget: "cname.vercel-dns.com",
  ttl: 300,
  requestTimeoutMs: 5_000,
}

const vercelConfig = {
  apiToken: "vercel_token_that_is_long_enough",
  projectId: "prj_Abcdefgh12345678",
  teamId: "team_Abcdefgh12345678",
  requestTimeoutMs: 5_000,
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function queuedFetch(
  responses: Response[],
  calls: Array<{ url: string; init?: RequestInit }>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const response = responses.shift()
    if (!response) throw new Error("Unexpected provider request")
    return response
  }) as typeof fetch
}

function cloudflareEnvelope(result: unknown) {
  return { success: true, errors: [], messages: [], result }
}

test.describe("Cloudflare advocate domain adapter", () => {
  test("recognizes the exact DNS only CNAME without mutating it", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = new CloudflareDomainAdapter(
      cloudflareConfig,
      queuedFetch(
        [
          jsonResponse(
            cloudflareEnvelope([
              {
                id: "b".repeat(32),
                type: "CNAME",
                name: context.hostname,
                content: cloudflareConfig.cnameTarget,
                proxied: false,
              },
            ]),
          ),
        ],
        calls,
      ),
    )

    const result = await adapter.reconcile(job, context)
    expect(result).toMatchObject({
      outcome: "matches_intent",
      desiredStateVerified: true,
      evidence: {
        provider_status: "dns_only_cname_ready",
        verified: true,
        already_applied: true,
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain(
      `/zones/${cloudflareConfig.zoneId}/dns_records?`,
    )
    expect(calls[0].url).toContain("name=alice.creatorshare.com")
  })

  test("refuses to repair a conflicting record it cannot prove it owns", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = new CloudflareDomainAdapter(
      cloudflareConfig,
      queuedFetch(
        [
          jsonResponse(
            cloudflareEnvelope([
              {
                id: "c".repeat(32),
                type: "CNAME",
                name: context.hostname,
                content: cloudflareConfig.cnameTarget,
                proxied: true,
              },
            ]),
          ),
        ],
        calls,
      ),
    )

    const result = await adapter.reconcile(job, context)
    expect(result).toMatchObject({
      outcome: "conflict",
      desiredStateVerified: false,
      ownedResource: false,
      evidence: { message_code: "cloudflare_unowned_record_conflict" },
    })
    expect(calls).toHaveLength(1)
  })

  test("creates an exact unproxied CNAME after a not found reconciliation", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const recordId = "d".repeat(32)
    const adapter = new CloudflareDomainAdapter(
      cloudflareConfig,
      queuedFetch(
        [
          jsonResponse(cloudflareEnvelope([])),
          jsonResponse(
            cloudflareEnvelope({
              id: recordId,
              type: "CNAME",
              name: context.hostname,
              content: cloudflareConfig.cnameTarget,
              proxied: false,
              comment: `creator-share:advocate-domain-integration:${job.integrationId}`,
            }),
          ),
        ],
        calls,
      ),
    )

    const reconciliation = await adapter.reconcile(job, context)
    const evidence = await adapter.apply(job, context, reconciliation)

    expect(reconciliation.outcome).toBe("not_found")
    expect(evidence).toMatchObject({
      provider_resource_id: recordId,
      dns_record_id: recordId,
      provider_status: "create_accepted",
      verified: false,
    })
    expect(calls[1].init?.method).toBe("POST")
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      type: "CNAME",
      name: context.hostname,
      content: cloudflareConfig.cnameTarget,
      ttl: 300,
      proxied: false,
      comment: `creator-share:advocate-domain-integration:${job.integrationId}`,
    })
  })

  test("deletes only the integration owned record", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const recordId = "e".repeat(32)
    const deprovisionJob = { ...job, kind: "deprovision" as const }
    const adapter = new CloudflareDomainAdapter(
      cloudflareConfig,
      queuedFetch(
        [
          jsonResponse(
            cloudflareEnvelope([
              {
                id: recordId,
                type: "CNAME",
                name: context.hostname,
                content: cloudflareConfig.cnameTarget,
                proxied: false,
                comment: `creator-share:advocate-domain-integration:${job.integrationId}`,
              },
            ]),
          ),
          jsonResponse(cloudflareEnvelope({ id: recordId })),
        ],
        calls,
      ),
    )

    const reconciliation = await adapter.reconcile(deprovisionJob, context)
    expect(reconciliation).toMatchObject({
      outcome: "needs_apply",
      ownedResource: true,
    })
    await adapter.apply(deprovisionJob, context, reconciliation)
    expect(calls[1].init?.method).toBe("DELETE")
    expect(calls[1].url).toContain(recordId)
  })
})

test.describe("Vercel advocate domain adapter", () => {
  const vercelJob = { ...job, provider: "vercel" as const }
  const vercelContext = {
    ...context,
    integrationProvider: "vercel" as const,
  }

  test("keeps an exact project attachment pending until Vercel verifies it", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = new VercelDomainAdapter(
      vercelConfig,
      queuedFetch(
        [
          jsonResponse({
            name: context.hostname,
            projectId: vercelConfig.projectId,
            verified: false,
          }),
        ],
        calls,
      ),
    )

    const result = await adapter.reconcile(vercelJob, vercelContext)
    expect(result).toMatchObject({
      outcome: "matches_intent",
      desiredStateVerified: false,
      evidence: {
        provider_status: "attached_pending_verification",
        verified: false,
        already_applied: true,
      },
    })
    expect(calls[0].url).toContain("/v9/projects/")
    expect(calls[0].url).toContain(`teamId=${vercelConfig.teamId}`)
  })

  test("settles an exact project attachment only after Vercel verifies it", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = new VercelDomainAdapter(
      vercelConfig,
      queuedFetch(
        [
          jsonResponse({
            name: context.hostname,
            projectId: vercelConfig.projectId,
            verified: true,
          }),
        ],
        calls,
      ),
    )

    const result = await adapter.reconcile(vercelJob, vercelContext)
    expect(result).toMatchObject({
      outcome: "matches_intent",
      desiredStateVerified: true,
      evidence: {
        provider_status: "attached_verified",
        verified: true,
        already_applied: true,
      },
    })
  })

  test("attaches only the claimed hostname to the configured project", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = new VercelDomainAdapter(
      vercelConfig,
      queuedFetch(
        [
          jsonResponse({ error: { code: "not_found" } }, 404),
          jsonResponse({
            name: context.hostname,
            projectId: vercelConfig.projectId,
            verified: false,
          }),
        ],
        calls,
      ),
    )

    const reconciliation = await adapter.reconcile(vercelJob, vercelContext)
    const evidence = await adapter.apply(
      vercelJob,
      vercelContext,
      reconciliation,
    )

    expect(reconciliation.outcome).toBe("not_found")
    expect(evidence.provider_status).toBe("attach_accepted")
    expect(calls[1].url).toContain("/v10/projects/")
    expect(calls[1].init?.method).toBe("POST")
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      name: context.hostname,
    })
  })

  test("removes an attached domain from only the configured project", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const deprovisionJob = { ...vercelJob, kind: "deprovision" as const }
    const adapter = new VercelDomainAdapter(
      vercelConfig,
      queuedFetch(
        [
          jsonResponse({
            name: context.hostname,
            projectId: vercelConfig.projectId,
            verified: true,
          }),
          jsonResponse({ name: context.hostname }),
        ],
        calls,
      ),
    )

    const reconciliation = await adapter.reconcile(
      deprovisionJob,
      vercelContext,
    )
    await adapter.apply(deprovisionJob, vercelContext, reconciliation)
    expect(calls[1].init?.method).toBe("DELETE")
    expect(calls[1].url).toContain("/v9/projects/")
    expect(calls[1].url).toContain(encodeURIComponent(context.hostname))
  })
})

function fakeRepository(
  events: string[],
  overrides: Partial<DomainProvisioningRepository> = {},
): DomainProvisioningRepository {
  return {
    async claimJobs() {
      return [job]
    },
    async loadContext() {
      events.push("load_context")
      return context
    },
    async renewLease() {
      events.push("renew_lease")
    },
    async recordReconciliation() {
      events.push("record_reconciliation")
    },
    async complete(_job, status) {
      events.push(`complete_${status}`)
      return status
    },
    async retry() {
      events.push("retry")
      return "queued"
    },
    ...overrides,
  }
}

test.describe("domain provisioning worker", () => {
  test("records reconciliation, heartbeats, applies, and verifies before success", async () => {
    const events: string[] = []
    const initial: ProviderReconciliation = {
      outcome: "not_found",
      desiredStateVerified: false,
      evidence: { provider_status: "not_found", verified: false },
    }
    const final: ProviderReconciliation = {
      outcome: "matches_intent",
      desiredStateVerified: true,
      evidence: { provider_status: "ready", verified: true },
    }
    let reconciliationCount = 0
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        reconciliationCount += 1
        return reconciliationCount === 1 ? initial : final
      },
      async apply() {
        events.push("provider_apply")
        return { provider_status: "create_accepted", verified: false }
      },
    }

    const result = await processDomainProvisioningJob({
      repository: fakeRepository(events),
      adapterFactory: () => adapter,
      config: { batchSize: 3, leaseSeconds: 300 },
      job,
    })

    expect(result.status).toBe("succeeded")
    expect(events).toEqual([
      "load_context",
      "provider_reconcile",
      "record_reconciliation",
      "renew_lease",
      "provider_apply",
      "renew_lease",
      "provider_reconcile",
      "complete_succeeded",
    ])
  })

  test("retries a provider conflict without mutation", async () => {
    const events: string[] = []
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        return {
          outcome: "conflict",
          desiredStateVerified: false,
          evidence: { provider_status: "conflict", verified: false },
        }
      },
      async apply(): Promise<SafeProviderEvidence> {
        events.push("provider_apply")
        return {}
      },
    }

    const result = await processDomainProvisioningJob({
      repository: fakeRepository(events),
      adapterFactory: () => adapter,
      config: { batchSize: 3, leaseSeconds: 300 },
      job,
    })

    expect(result).toMatchObject({
      status: "retried",
      code: "provider_state_conflict",
    })
    expect(events).toEqual([
      "load_context",
      "provider_reconcile",
      "record_reconciliation",
      "retry",
    ])
  })

  test("rejects work that became ineligible after enqueue", async () => {
    const events: string[] = []
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        throw new Error("Provider must not be called")
      },
      async apply() {
        events.push("provider_apply")
        return {}
      },
    }
    const repository = fakeRepository(events, {
      async loadContext() {
        events.push("load_context")
        return {
          ...context,
          advocatePublicationStatus: "suspended",
        }
      },
    })

    const result = await processDomainProvisioningJob({
      repository,
      adapterFactory: () => adapter,
      config: { batchSize: 3, leaseSeconds: 300 },
      job,
    })

    expect(result).toMatchObject({
      status: "failed",
      code: "worker_job_no_longer_eligible",
    })
    expect(events).toEqual(["load_context", "complete_failed"])
  })
})

test("worker route bearer comparison is exact", () => {
  const secret = "a_secure_worker_secret_with_32_chars"
  expect(isAuthorizedDomainWorkerRequest(`Bearer ${secret}`, secret)).toBe(true)
  expect(isAuthorizedDomainWorkerRequest(`Bearer ${secret}x`, secret)).toBe(false)
  expect(isAuthorizedDomainWorkerRequest(secret, secret)).toBe(false)
  expect(isAuthorizedDomainWorkerRequest(null, secret)).toBe(false)
})

test.describe("domain provisioning configuration", () => {
  test("accepts only bounded worker and exact provider configuration", () => {
    const env = {
      ADVOCATE_CLOUDFLARE_API_TOKEN: cloudflareConfig.apiToken,
      ADVOCATE_CLOUDFLARE_ZONE_ID: cloudflareConfig.zoneId,
      ADVOCATE_CLOUDFLARE_CNAME_TARGET: cloudflareConfig.cnameTarget,
      ADVOCATE_CLOUDFLARE_TTL_SECONDS: "300",
      ADVOCATE_VERCEL_API_TOKEN: vercelConfig.apiToken,
      ADVOCATE_VERCEL_PROJECT_ID: vercelConfig.projectId,
      ADVOCATE_VERCEL_TEAM_ID: vercelConfig.teamId,
      ADVOCATE_PROVISIONING_BATCH_SIZE: "4",
      ADVOCATE_PROVISIONING_LEASE_SECONDS: "240",
    }

    expect(loadCloudflareProvisioningConfig(env)).toMatchObject({
      zoneId: cloudflareConfig.zoneId,
      cnameTarget: cloudflareConfig.cnameTarget,
      ttl: 300,
    })
    expect(loadVercelProvisioningConfig(env)).toMatchObject({
      projectId: vercelConfig.projectId,
      teamId: vercelConfig.teamId,
    })
    expect(loadDomainWorkerConfig(env)).toEqual({
      batchSize: 4,
      leaseSeconds: 240,
    })
  })

  test("fails closed on malformed identifiers and unsafe bounds", () => {
    expect(() =>
      loadCloudflareProvisioningConfig({
        ADVOCATE_CLOUDFLARE_API_TOKEN: cloudflareConfig.apiToken,
        ADVOCATE_CLOUDFLARE_ZONE_ID: "not-a-zone-id",
        ADVOCATE_CLOUDFLARE_CNAME_TARGET: cloudflareConfig.cnameTarget,
      }),
    ).toThrow("worker_configuration_invalid")

    expect(() =>
      loadVercelProvisioningConfig({
        ADVOCATE_VERCEL_API_TOKEN: vercelConfig.apiToken,
        ADVOCATE_VERCEL_PROJECT_ID: "another-project-name",
      }),
    ).toThrow("worker_configuration_invalid")

    expect(() =>
      loadDomainWorkerConfig({ ADVOCATE_PROVISIONING_BATCH_SIZE: "100" }),
    ).toThrow("worker_configuration_invalid")
  })
})
