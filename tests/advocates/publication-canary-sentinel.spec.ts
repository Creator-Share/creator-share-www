import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type { DomainProviderAdapterFactory } from "../../src/lib/advocates/provisioning/adapters"
import { CloudflareDomainAdapter } from "../../src/lib/advocates/provisioning/cloudflare"
import {
  DomainProvisioningError,
  type ClaimedDomainProvisioningJob,
  type DomainProviderAdapter,
  type DomainProvisioningContext,
  type ProviderReconciliation,
  type SupportedDomainProvider,
} from "../../src/lib/advocates/provisioning/types"
import { VercelDomainAdapter } from "../../src/lib/advocates/provisioning/vercel"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type SentinelModule =
  typeof import("../../src/lib/advocates/publicationCanary/sentinel")

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
  resolve(process.cwd(), "tests/advocates/publication-canary-sentinel.spec.ts"),
)
const sentinel = testRequire(
  "../../src/lib/advocates/publicationCanary/sentinel",
) as SentinelModule
nodeModule._load = originalModuleLoad

const ready: ProviderReconciliation = Object.freeze({
  outcome: "matches_intent",
  desiredStateVerified: true,
  resourceId: "owned-sentinel-resource",
  ownedResource: true,
  evidence: Object.freeze({
    provider_resource_id: "must-not-escape",
    verified: true,
  }),
})

const missing: ProviderReconciliation = Object.freeze({
  outcome: "not_found",
  desiredStateVerified: false,
  evidence: Object.freeze({ verified: false }),
})

interface AdapterCapture {
  reconcile: Array<{
    job: ClaimedDomainProvisioningJob
    context: DomainProvisioningContext
  }>
  apply: Array<{
    job: ClaimedDomainProvisioningJob
    context: DomainProvisioningContext
    reconciliation: ProviderReconciliation
  }>
}

function fakeAdapter(
  provider: SupportedDomainProvider,
  reconciliations: readonly ProviderReconciliation[],
  options: { applyError?: Error } = {},
): { adapter: DomainProviderAdapter; capture: AdapterCapture } {
  const capture: AdapterCapture = { reconcile: [], apply: [] }
  let reconciliationIndex = 0
  return {
    capture,
    adapter: {
      provider,
      async reconcile(job, context) {
        capture.reconcile.push({ job, context })
        const result =
          reconciliations[
            Math.min(reconciliationIndex, reconciliations.length - 1)
          ]
        reconciliationIndex += 1
        if (!result) throw new Error("missing fake reconciliation")
        return result
      },
      async apply(job, context, reconciliation) {
        capture.apply.push({ job, context, reconciliation })
        if (options.applyError) throw options.applyError
        return { provider_resource_id: "must-not-escape", verified: false }
      },
    },
  }
}

function factory(
  cloudflare: DomainProviderAdapter,
  vercel: DomainProviderAdapter,
): DomainProviderAdapterFactory {
  return (provider) => {
    if (provider === "cloudflare") return cloudflare
    if (provider === "vercel") return vercel
    throw new Error("unexpected provider")
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function queuedFetch(
  responses: Response[],
  calls: Array<{ url: string; init?: RequestInit }>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const response = responses.shift()
    if (!response) throw new Error("unexpected provider request")
    return response
  }) as typeof fetch
}

test.describe("publication negative sentinel reconciler", () => {
  test("accepts exact preexisting provider state without mutation", async () => {
    const cloudflare = fakeAdapter("cloudflare", [ready])
    const vercel = fakeAdapter("vercel", [ready])

    await expect(
      sentinel.reconcilePublicationCanarySentinel(
        factory(cloudflare.adapter, vercel.adapter),
      ),
    ).resolves.toEqual({
      hostname: "publication-sentinel.creatorshare.com",
      cloudflareReady: true,
      vercelReady: true,
    })
    expect(cloudflare.capture.apply).toHaveLength(0)
    expect(vercel.capture.apply).toHaveLength(0)
  })

  test("repairs an exact pending Vercel sentinel attachment through authoritative verification", async () => {
    const cloudflare = fakeAdapter("cloudflare", [ready])
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const hostname = "publication-sentinel.creatorshare.com"
    const projectId = "prj_Abcdefgh12345678"
    const teamId = "team_Abcdefgh12345678"
    const pendingDomain = {
      name: hostname,
      projectId,
      verified: false,
    }
    const verifiedDomain = { ...pendingDomain, verified: true }
    const vercel = new VercelDomainAdapter(
      {
        apiToken: "vercel-token-value-1234567890",
        projectId,
        teamId,
        requestTimeoutMs: 5_000,
      },
      queuedFetch(
        [
          jsonResponse(pendingDomain),
          jsonResponse(verifiedDomain),
          jsonResponse(verifiedDomain),
          jsonResponse(verifiedDomain),
        ],
        calls,
      ),
    )

    await expect(
      sentinel.reconcilePublicationCanarySentinel(
        factory(cloudflare.adapter, vercel),
      ),
    ).resolves.toEqual({
      hostname,
      cloudflareReady: true,
      vercelReady: true,
    })

    expect(calls).toHaveLength(4)
    expect(calls[0].init?.method).toBe("GET")
    expect(calls[1].url).toBe(
      `https://api.vercel.com/v9/projects/${projectId}/domains/${hostname}/verify?teamId=${teamId}`,
    )
    expect(calls[1].init?.method).toBe("POST")
    expect(calls[2].init?.method).toBe("GET")
    expect(calls[3].init?.method).toBe("GET")
  })

  test("uses deterministic synthetic ownership and lookup before every persistent create", async () => {
    const cloudflare = fakeAdapter("cloudflare", [missing, ready])
    const vercel = fakeAdapter("vercel", [missing, ready])

    await sentinel.reconcilePublicationCanarySentinel(
      factory(cloudflare.adapter, vercel.adapter),
    )

    for (const current of [cloudflare, vercel]) {
      expect(current.capture.reconcile).toHaveLength(2)
      expect(current.capture.apply).toHaveLength(1)
      const { job, context } = current.capture.apply[0]
      expect(job.kind).toBe("provision")
      expect(job.requestPayload.reconciliation_policy).toBe(
        "lookup_before_mutation",
      )
      expect(job.integrationId).toBe(context.integrationId)
      expect(job.integrationId).toMatch(
        /^00000000-0000-4000-8000-0000000000[c-e]1$/,
      )
      expect(context.hostname).toBe("publication-sentinel.creatorshare.com")
    }
  })

  test("drives the exact Cloudflare DNS-only and Vercel project adapters", async () => {
    const cloudflareCalls: Array<{ url: string; init?: RequestInit }> = []
    const vercelCalls: Array<{ url: string; init?: RequestInit }> = []
    const recordId = "a".repeat(32)
    const cloudflareRecord = {
      id: recordId,
      type: "CNAME",
      name: "publication-sentinel.creatorshare.com",
      content: "d1d4fc829fe7bc7c.vercel-dns-017.com",
      proxied: false,
      comment:
        "creator-share:advocate-domain-integration:00000000-0000-4000-8000-0000000000c1",
    }
    const cloudflare = new CloudflareDomainAdapter(
      {
        apiToken: "cloudflare-token-value-1234567890",
        zoneId: "b".repeat(32),
        cnameTarget: "d1d4fc829fe7bc7c.vercel-dns-017.com",
        ttl: 300,
        requestTimeoutMs: 5_000,
      },
      queuedFetch(
        [
          jsonResponse({ success: true, result: [], errors: [] }),
          jsonResponse({ success: true, result: cloudflareRecord, errors: [] }),
          jsonResponse({
            success: true,
            result: [cloudflareRecord],
            errors: [],
          }),
        ],
        cloudflareCalls,
      ),
    )
    const vercelDomain = {
      name: "publication-sentinel.creatorshare.com",
      projectId: "prj_Abcdefgh12345678",
      verified: true,
    }
    const vercel = new VercelDomainAdapter(
      {
        apiToken: "vercel-token-value-1234567890",
        projectId: vercelDomain.projectId,
        teamId: "team_Abcdefgh12345678",
        requestTimeoutMs: 5_000,
      },
      queuedFetch(
        [
          jsonResponse({ error: { code: "not_found" } }, 404),
          jsonResponse(vercelDomain),
          jsonResponse(vercelDomain),
        ],
        vercelCalls,
      ),
    )

    await expect(
      sentinel.reconcilePublicationCanarySentinel(factory(cloudflare, vercel)),
    ).resolves.toEqual({
      hostname: "publication-sentinel.creatorshare.com",
      cloudflareReady: true,
      vercelReady: true,
    })

    expect(JSON.parse(String(cloudflareCalls[1].init?.body))).toEqual({
      type: "CNAME",
      name: "publication-sentinel.creatorshare.com",
      content: "d1d4fc829fe7bc7c.vercel-dns-017.com",
      ttl: 300,
      proxied: false,
      comment:
        "creator-share:advocate-domain-integration:00000000-0000-4000-8000-0000000000c1",
    })
    expect(vercelCalls[1].url).toContain(
      "/v10/projects/prj_Abcdefgh12345678/domains?teamId=team_Abcdefgh12345678",
    )
    expect(JSON.parse(String(vercelCalls[1].init?.body))).toEqual({
      name: "publication-sentinel.creatorshare.com",
    })
  })

  test("settles a concurrent Cloudflare sentinel create only after exact owned relookup", async () => {
    const recordId = "d".repeat(32)
    const cloudflareRecord = {
      id: recordId,
      type: "CNAME",
      name: "publication-sentinel.creatorshare.com",
      content: "d1d4fc829fe7bc7c.vercel-dns-017.com",
      proxied: false,
      comment:
        "creator-share:advocate-domain-integration:00000000-0000-4000-8000-0000000000c1",
    }
    const cloudflare = new CloudflareDomainAdapter(
      {
        apiToken: "cloudflare-token-value-1234567890",
        zoneId: "b".repeat(32),
        cnameTarget: "d1d4fc829fe7bc7c.vercel-dns-017.com",
        ttl: 300,
        requestTimeoutMs: 5_000,
      },
      queuedFetch(
        [
          jsonResponse({ success: true, result: [], errors: [] }),
          jsonResponse(
            {
              success: false,
              result: null,
              errors: [{ code: 81053, message: "duplicate" }],
            },
            400,
          ),
          jsonResponse({
            success: true,
            result: [cloudflareRecord],
            errors: [],
          }),
          jsonResponse({
            success: true,
            result: [cloudflareRecord],
            errors: [],
          }),
        ],
        [],
      ),
    )
    const vercel = fakeAdapter("vercel", [ready])

    await expect(
      sentinel.reconcilePublicationCanarySentinel(
        factory(cloudflare, vercel.adapter),
      ),
    ).resolves.toEqual({
      hostname: "publication-sentinel.creatorshare.com",
      cloudflareReady: true,
      vercelReady: true,
    })
  })

  test("reconciles provider create races and returns no provider identifiers", async () => {
    const cloudflare = fakeAdapter("cloudflare", [missing, ready], {
      applyError: new DomainProvisioningError({
        code: "cloudflare_request_retryable",
        retryable: true,
      }),
    })
    const vercel = fakeAdapter("vercel", [missing, ready], {
      applyError: new DomainProvisioningError({
        code: "vercel_transient_error",
        retryable: true,
      }),
    })

    const result = await sentinel.reconcilePublicationCanarySentinel(
      factory(cloudflare.adapter, vercel.adapter),
    )
    expect(result).toEqual({
      hostname: "publication-sentinel.creatorshare.com",
      cloudflareReady: true,
      vercelReady: true,
    })
    expect(JSON.stringify(result)).not.toContain("must-not-escape")
    expect(Object.keys(result).sort()).toEqual([
      "cloudflareReady",
      "hostname",
      "vercelReady",
    ])
  })

  test("keeps retryable apply failures converging but makes rejected apply terminal", async () => {
    for (const [retryable, expectedOutcome] of [
      [true, "converging"],
      [false, "failed"],
    ] as const) {
      const cloudflare = fakeAdapter("cloudflare", [missing, missing], {
        applyError: new DomainProvisioningError({
          code: retryable
            ? "cloudflare_request_retryable"
            : "cloudflare_request_rejected",
          retryable,
        }),
      })
      const result = await sentinel.reconcilePublicationCanarySentinelProviders(
        factory(cloudflare.adapter, fakeAdapter("vercel", [ready]).adapter),
      )

      expect(result.outcome).toBe(expectedOutcome)
      expect(result.readiness).toEqual({
        hostname: "publication-sentinel.creatorshare.com",
        cloudflareReady: false,
        vercelReady: false,
      })
      expect(result.events).toEqual([
        {
          sequence: 0,
          stage: "cloudflare_lookup",
          outcome_code: "not_found",
        },
        {
          sequence: 1,
          stage: "cloudflare_apply",
          outcome_code: "provider_unavailable",
        },
        {
          sequence: 2,
          stage: "cloudflare_verify",
          outcome_code: "not_ready",
        },
        {
          sequence: 3,
          stage: "vercel_lookup",
          outcome_code: "blocked",
        },
      ])
    }
  })

  test("makes retryable malformed or ambiguous provider responses terminal", async () => {
    for (const code of [
      "cloudflare_invalid_response",
      "provider_response_too_large",
      "vercel_invalid_response",
      "vercel_verification_identity_mismatch",
    ]) {
      const cloudflare = fakeAdapter("cloudflare", [missing, missing], {
        applyError: new DomainProvisioningError({
          code,
          retryable: true,
        }),
      })
      const result = await sentinel.reconcilePublicationCanarySentinelProviders(
        factory(cloudflare.adapter, fakeAdapter("vercel", [ready]).adapter),
      )

      expect(result.outcome).toBe("failed")
      expect(result.readiness).toEqual({
        hostname: "publication-sentinel.creatorshare.com",
        cloudflareReady: false,
        vercelReady: false,
      })
    }
  })

  test("does not let a ready relookup erase a terminal apply failure", async () => {
    const cloudflare = fakeAdapter("cloudflare", [missing, ready], {
      applyError: new DomainProvisioningError({
        code: "provider_response_too_large",
        retryable: true,
      }),
    })
    const vercel = fakeAdapter("vercel", [ready])

    const result = await sentinel.reconcilePublicationCanarySentinelProviders(
      factory(cloudflare.adapter, vercel.adapter),
    )

    expect(result.outcome).toBe("failed")
    expect(result.readiness).toEqual({
      hostname: "publication-sentinel.creatorshare.com",
      cloudflareReady: false,
      vercelReady: false,
    })
    expect(result.events).toEqual([
      {
        sequence: 0,
        stage: "cloudflare_lookup",
        outcome_code: "not_found",
      },
      {
        sequence: 1,
        stage: "cloudflare_apply",
        outcome_code: "provider_unavailable",
      },
      {
        sequence: 2,
        stage: "cloudflare_verify",
        outcome_code: "failed",
      },
      {
        sequence: 3,
        stage: "vercel_lookup",
        outcome_code: "blocked",
      },
    ])
    expect(vercel.capture.reconcile).toHaveLength(0)
  })

  test("fails closed on conflict, pending verification, or adapter faults", async () => {
    const conflict = fakeAdapter("cloudflare", [
      {
        outcome: "conflict",
        desiredStateVerified: false,
        evidence: { provider_resource_id: "conflict-id", verified: false },
      },
    ])
    const pending = fakeAdapter("vercel", [
      {
        outcome: "matches_intent",
        desiredStateVerified: false,
        evidence: { provider_resource_id: "pending-id", verified: false },
      },
    ])

    await expect(
      sentinel.reconcilePublicationCanarySentinel(
        factory(conflict.adapter, pending.adapter),
      ),
    ).resolves.toEqual({
      hostname: "publication-sentinel.creatorshare.com",
      cloudflareReady: false,
      vercelReady: false,
    })
    expect(conflict.capture.apply).toHaveLength(0)
    expect(pending.capture.apply).toHaveLength(0)

    await expect(
      sentinel.reconcilePublicationCanarySentinel(() => {
        throw new Error("credential detail must not escape")
      }),
    ).resolves.toEqual({
      hostname: "publication-sentinel.creatorshare.com",
      cloudflareReady: false,
      vercelReady: false,
    })
  })

  test("rejects exact but unowned or unidentified provider resources without mutation", async () => {
    for (const cloudflareReconciliation of [
      {
        outcome: "matches_intent",
        desiredStateVerified: true,
        resourceId: "unowned-record",
        ownedResource: false,
        evidence: { verified: true },
      },
      {
        outcome: "matches_intent",
        desiredStateVerified: true,
        ownedResource: true,
        evidence: { verified: true },
      },
      {
        outcome: "matches_intent",
        desiredStateVerified: true,
        resourceId: "",
        ownedResource: true,
        evidence: { verified: true },
      },
      {
        outcome: "needs_apply",
        desiredStateVerified: false,
        resourceId: "unowned-drifted-record",
        ownedResource: false,
        evidence: { verified: false },
      },
      {
        outcome: "not_found",
        desiredStateVerified: false,
        resourceId: "unexpected-existing-record",
        ownedResource: false,
        evidence: { verified: false },
      },
    ] satisfies ProviderReconciliation[]) {
      const cloudflare = fakeAdapter("cloudflare", [cloudflareReconciliation])
      const vercel = fakeAdapter("vercel", [ready])

      await expect(
        sentinel.reconcilePublicationCanarySentinel(
          factory(cloudflare.adapter, vercel.adapter),
        ),
      ).resolves.toEqual({
        hostname: "publication-sentinel.creatorshare.com",
        cloudflareReady: false,
        vercelReady: false,
      })
      expect(cloudflare.capture.apply).toHaveLength(0)
      expect(vercel.capture.reconcile).toHaveLength(0)
      expect(vercel.capture.apply).toHaveLength(0)
    }
  })

  test("emits only fixed operational codes while provider state converges", async () => {
    const cloudflare = fakeAdapter("cloudflare", [missing, missing])
    const vercel = fakeAdapter("vercel", [ready])

    const result = await sentinel.reconcilePublicationCanarySentinelProviders(
      factory(cloudflare.adapter, vercel.adapter),
    )

    expect(result).toEqual({
      readiness: {
        hostname: "publication-sentinel.creatorshare.com",
        cloudflareReady: false,
        vercelReady: false,
      },
      outcome: "converging",
      events: [
        {
          sequence: 0,
          stage: "cloudflare_lookup",
          outcome_code: "not_found",
        },
        {
          sequence: 1,
          stage: "cloudflare_apply",
          outcome_code: "apply_accepted",
        },
        {
          sequence: 2,
          stage: "cloudflare_verify",
          outcome_code: "not_ready",
        },
        {
          sequence: 3,
          stage: "vercel_lookup",
          outcome_code: "blocked",
        },
      ],
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("must-not-escape")
    expect(serialized).not.toContain("provider_resource_id")
  })

  test("keeps terminal provider inspection strictly read only", async () => {
    const cloudflare = fakeAdapter("cloudflare", [missing])
    const vercel = fakeAdapter("vercel", [ready])

    await expect(
      sentinel.inspectPublicationCanarySentinel(
        factory(cloudflare.adapter, vercel.adapter),
      ),
    ).resolves.toEqual({
      hostname: "publication-sentinel.creatorshare.com",
      cloudflareReady: false,
      vercelReady: true,
    })
    expect(cloudflare.capture.reconcile).toHaveLength(1)
    expect(vercel.capture.reconcile).toHaveLength(1)
    expect(cloudflare.capture.apply).toHaveLength(0)
    expect(vercel.capture.apply).toHaveLength(0)
  })
})
