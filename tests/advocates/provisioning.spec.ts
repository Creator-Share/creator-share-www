import { expect, test } from "@playwright/test"

import { isAuthorizedDomainWorkerRequest } from "../../src/lib/advocates/provisioning/auth"
import { createDomainProviderAdapterFactory } from "../../src/lib/advocates/provisioning/adapters"
import { CloudflareDomainAdapter } from "../../src/lib/advocates/provisioning/cloudflare"
import {
  loadCloudflareProvisioningConfig,
  loadDomainWorkerConfig,
  loadPayPalPaymentPathConfig,
  loadStripePaymentPathConfig,
  loadVercelProvisioningConfig,
  loadWorkerRouteSecret,
} from "../../src/lib/advocates/provisioning/config"
import { PaymentPathReadinessAdapter } from "../../src/lib/advocates/provisioning/paymentPaths"
import { VercelDomainAdapter } from "../../src/lib/advocates/provisioning/vercel"
import {
  processDomainProvisioningJob,
  runScheduledDomainProvisioningBatch,
} from "../../src/lib/advocates/provisioning/worker"
import {
  createSupabaseDomainProvisioningRepository,
  DomainProvisioningRepositoryError,
  type DomainProvisioningRepository,
} from "../../src/lib/advocates/provisioning/repository"
import { DomainProvisioningError } from "../../src/lib/advocates/provisioning/types"
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
  integrationIsRequired: true,
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

const stripeUsEnvironment = {
  STRIPE_SECRET_KEY_US: `sk_live_${"a".repeat(32)}`,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: `pk_live_${"b".repeat(32)}`,
  STRIPE_WEBHOOK_SECRET_US: `whsec_${"c".repeat(32)}`,
}

const stripeUkEnvironment = {
  STRIPE_SECRET_KEY_UK: `sk_live_${"d".repeat(32)}`,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK: `pk_live_${"e".repeat(32)}`,
  STRIPE_WEBHOOK_SECRET_UK: `whsec_${"f".repeat(32)}`,
}

const paypalEnvironment = {
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: `paypal_client_${"g".repeat(32)}`,
  PAYPAL_CLIENT_ID: `paypal_client_${"g".repeat(32)}`,
  PAYPAL_CLIENT_SECRET: `paypal_secret_${"h".repeat(32)}`,
  PAYPAL_WEBHOOK_ID: "8PT597110X687430L",
  PAYPAL_API_URL: "https://api-m.paypal.com",
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

test.describe("payment path readiness adapters", () => {
  for (const stripeCase of [
    {
      provider: "stripe_us" as const,
      environment: stripeUsEnvironment,
      secret: stripeUsEnvironment.STRIPE_SECRET_KEY_US,
    },
    {
      provider: "stripe_uk" as const,
      environment: stripeUkEnvironment,
      secret: stripeUkEnvironment.STRIPE_SECRET_KEY_UK,
    },
  ]) {
    test(`${stripeCase.provider} proves its exact live Stripe account without mutation`, async () => {
      const calls: Array<{ url: string; init?: RequestInit }> = []
      const adapter = new PaymentPathReadinessAdapter(
        stripeCase.provider,
        stripeCase.environment,
        queuedFetch(
          [jsonResponse({ object: "balance", livemode: true, available: [] })],
          calls,
        ),
      )
      const stripeJob = { ...job, provider: stripeCase.provider }
      const stripeContext = {
        ...context,
        integrationProvider: stripeCase.provider,
      }

      const reconciliation = await adapter.reconcile(stripeJob, stripeContext)

      expect(reconciliation).toEqual({
        outcome: "matches_intent",
        desiredStateVerified: true,
        evidence: {
          provider_status: "payment_path_ready",
          provider_resource_id: `${stripeCase.provider}:hosted_checkout`,
          http_status: 200,
          verified: true,
        },
      })
      expect(calls).toHaveLength(1)
      expect(calls[0].url).toBe("https://api.stripe.com/v1/balance")
      expect(calls[0].init?.method).toBe("GET")
      const headers = new Headers(calls[0].init?.headers)
      expect(headers.get("Authorization")).toBe(`Bearer ${stripeCase.secret}`)
      expect(JSON.stringify(reconciliation)).not.toContain(stripeCase.secret)
    })
  }

  test("proves the live PayPal app with OAuth client credentials and discards the token", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const accessToken = `live_access_token_${"z".repeat(32)}`
    const adapter = new PaymentPathReadinessAdapter(
      "paypal",
      paypalEnvironment,
      queuedFetch(
        [
          jsonResponse({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: 31_668,
          }),
        ],
        calls,
      ),
    )
    const paypalJob = { ...job, provider: "paypal" as const }
    const paypalContext = {
      ...context,
      integrationProvider: "paypal" as const,
    }

    const reconciliation = await adapter.reconcile(paypalJob, paypalContext)

    expect(reconciliation).toEqual({
      outcome: "matches_intent",
      desiredStateVerified: true,
      evidence: {
        provider_status: "payment_path_ready",
        provider_resource_id: "paypal:hosted_checkout",
        http_status: 200,
        verified: true,
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("https://api-m.paypal.com/v1/oauth2/token")
    expect(calls[0].init?.method).toBe("POST")
    expect(calls[0].init?.body).toBe("grant_type=client_credentials")
    const headers = new Headers(calls[0].init?.headers)
    expect(headers.get("Authorization")).toBe(
      `Basic ${Buffer.from(
        `${paypalEnvironment.NEXT_PUBLIC_PAYPAL_CLIENT_ID}:${paypalEnvironment.PAYPAL_CLIENT_SECRET}`,
      ).toString("base64")}`,
    )
    expect(headers.get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    )
    expect(JSON.stringify(reconciliation)).not.toContain(accessToken)
    expect(JSON.stringify(reconciliation)).not.toContain(
      paypalEnvironment.PAYPAL_CLIENT_SECRET,
    )
  })

  test("classifies provider authorization failures as terminal without leaking provider bodies", async () => {
    const responseSecret = "provider_body_must_never_escape"
    const adapter = new PaymentPathReadinessAdapter(
      "stripe_us",
      stripeUsEnvironment,
      queuedFetch(
        [
          jsonResponse({ error: { message: responseSecret } }, 401, {
            "request-id": "request_with_no_persistence_need",
          }),
        ],
        [],
      ),
    )

    let thrown: unknown
    try {
      await adapter.reconcile(
        { ...job, provider: "stripe_us" },
        { ...context, integrationProvider: "stripe_us" },
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      code: "stripe_us_configuration_or_authorization_failed",
      retryable: false,
      evidence: { http_status: 401 },
    })
    expect(String(thrown)).not.toContain(responseSecret)
    expect(JSON.stringify(thrown)).not.toContain(responseSecret)
    expect(JSON.stringify(thrown)).not.toContain(
      stripeUsEnvironment.STRIPE_SECRET_KEY_US,
    )
  })

  for (const retryCase of [
    {
      name: "Stripe rate limit",
      provider: "stripe_us" as const,
      environment: stripeUsEnvironment,
      response: jsonResponse({ error: "limited" }, 429, {
        "Retry-After": "17",
      }),
      expectedCode: "stripe_us_probe_transient_error",
      retryAfterSeconds: 17,
    },
    {
      name: "PayPal server error",
      provider: "paypal" as const,
      environment: paypalEnvironment,
      response: jsonResponse({ error: "unavailable" }, 503),
      expectedCode: "paypal_probe_transient_error",
      retryAfterSeconds: undefined,
    },
  ]) {
    test(`retries a ${retryCase.name}`, async () => {
      const adapter = new PaymentPathReadinessAdapter(
        retryCase.provider,
        retryCase.environment,
        queuedFetch([retryCase.response], []),
      )

      await expect(
        adapter.reconcile(
          { ...job, provider: retryCase.provider },
          { ...context, integrationProvider: retryCase.provider },
        ),
      ).rejects.toMatchObject({
        code: retryCase.expectedCode,
        retryable: true,
        retryAfterSeconds: retryCase.retryAfterSeconds,
      })
    })
  }

  test("retries a bounded regional Stripe network failure", async () => {
    const adapter = new PaymentPathReadinessAdapter(
      "stripe_uk",
      stripeUkEnvironment,
      (async () => {
        throw new Error("socket unavailable")
      }) as typeof fetch,
    )

    await expect(
      adapter.reconcile(
        { ...job, provider: "stripe_uk" },
        { ...context, integrationProvider: "stripe_uk" },
      ),
    ).rejects.toMatchObject({
      code: "stripe_uk_probe_network_error",
      retryable: true,
      evidence: {},
    })
  })

  for (const provider of ["stripe_us", "stripe_uk", "paypal"] as const) {
    test(`${provider} teardown is verified locally without credentials or provider calls`, async () => {
      let called = false
      const adapter = new PaymentPathReadinessAdapter(
        provider,
        {},
        (async () => {
          called = true
          throw new Error("Provider must not be called during teardown")
        }) as typeof fetch,
      )

      const reconciliation = await adapter.reconcile(
        { ...job, kind: "deprovision", provider },
        { ...context, integrationProvider: provider },
      )

      expect(reconciliation).toEqual({
        outcome: "matches_intent",
        desiredStateVerified: true,
        evidence: {
          provider_status: "absent",
          provider_resource_id: `${provider}:hosted_checkout`,
          verified: true,
          already_applied: true,
        },
      })
      expect(called).toBe(false)
      await expect(
        adapter.apply(
          { ...job, kind: "deprovision", provider },
          { ...context, integrationProvider: provider },
          reconciliation,
        ),
      ).resolves.toEqual(reconciliation.evidence)
      expect(called).toBe(false)
    })
  }

  test("apply only returns exact verified evidence and never probes or mutates", async () => {
    let called = false
    const adapter = new PaymentPathReadinessAdapter(
      "stripe_us",
      stripeUsEnvironment,
      (async () => {
        called = true
        throw new Error("Apply must not call a provider")
      }) as typeof fetch,
    )
    const reconciliation: ProviderReconciliation = {
      outcome: "matches_intent",
      desiredStateVerified: true,
      evidence: {
        provider_status: "payment_path_ready",
        provider_resource_id: "stripe_us:hosted_checkout",
        http_status: 200,
        verified: true,
      },
    }

    await expect(
      adapter.apply(
        { ...job, provider: "stripe_us" },
        { ...context, integrationProvider: "stripe_us" },
        reconciliation,
      ),
    ).resolves.toEqual(reconciliation.evidence)
    await expect(
      adapter.apply(
        { ...job, provider: "stripe_us" },
        { ...context, integrationProvider: "stripe_us" },
        {
          ...reconciliation,
          evidence: { ...reconciliation.evidence, verified: false },
        },
      ),
    ).rejects.toMatchObject({
      code: "payment_path_apply_not_verified",
      retryable: false,
    })
    expect(called).toBe(false)
  })

  test("factory supports all three payment paths without eagerly requiring credentials", () => {
    const factory = createDomainProviderAdapterFactory({ env: {} })
    for (const provider of ["stripe_us", "stripe_uk", "paypal"] as const) {
      expect(factory(provider)).toMatchObject({ provider })
    }
  })
})

test.describe("domain provisioning repository", () => {
  test("maps the bounded reconciliation scheduler RPC without leaking topology details", async () => {
    const rpcCalls: Array<{ name: string; args: unknown }> = []
    const repository = createSupabaseDomainProvisioningRepository({
      async rpc(name: string, args: unknown) {
        rpcCalls.push({ name, args })
        return {
          data: [
            {
              domain_id: job.domainId,
              enqueued_job_count: 5,
              quarantined: false,
            },
          ],
          error: null,
        }
      },
    } as never)

    await expect(
      repository.enqueueDueReconciliations({
        batchSize: 20,
        correlationId:
          "advocate-domain-reconciliation:66666666-6666-4666-8666-666666666666",
      }),
    ).resolves.toEqual([
      {
        domainId: job.domainId,
        enqueuedJobCount: 5,
        quarantined: false,
      },
    ])
    expect(rpcCalls).toEqual([
      {
        name: "enqueue_due_advocate_domain_reconciliations",
        args: {
          batch_size: 20,
          correlation_id:
            "advocate-domain-reconciliation:66666666-6666-4666-8666-666666666666",
        },
      },
    ])
  })

  test("rejects malformed reconciliation scheduler rows", async () => {
    const repository = createSupabaseDomainProvisioningRepository({
      async rpc() {
        return {
          data: [
            {
              domain_id: job.domainId,
              enqueued_job_count: 6,
              quarantined: false,
            },
          ],
          error: null,
        }
      },
    } as never)

    await expect(
      repository.enqueueDueReconciliations({
        batchSize: 20,
        correlationId: "invalid-shape-test",
      }),
    ).rejects.toMatchObject({
      stage: "enqueue_reconciliations_shape",
    })
  })

  test("maps quarantined topology without pretending provider work was enqueued", async () => {
    const repository = createSupabaseDomainProvisioningRepository({
      async rpc() {
        return {
          data: [
            {
              domain_id: job.domainId,
              enqueued_job_count: 0,
              quarantined: true,
            },
          ],
          error: null,
        }
      },
    } as never)

    await expect(
      repository.enqueueDueReconciliations({
        batchSize: 20,
        correlationId: "invalid-topology-test",
      }),
    ).resolves.toEqual([
      {
        domainId: job.domainId,
        enqueuedJobCount: 0,
        quarantined: true,
      },
    ])
  })

  test("rejects inconsistent scheduler quarantine shapes", async () => {
    const repository = createSupabaseDomainProvisioningRepository({
      async rpc() {
        return {
          data: [
            {
              domain_id: job.domainId,
              enqueued_job_count: 1,
              quarantined: true,
            },
          ],
          error: null,
        }
      },
    } as never)

    await expect(
      repository.enqueueDueReconciliations({
        batchSize: 20,
        correlationId: "invalid-quarantine-shape-test",
      }),
    ).rejects.toMatchObject({ stage: "enqueue_reconciliations_shape" })
  })

  test("rejects duplicate or overbroad scheduler result contracts", async () => {
    for (const data of [
      [
        {
          domain_id: job.domainId,
          enqueued_job_count: 1,
          quarantined: false,
        },
        {
          domain_id: job.domainId,
          enqueued_job_count: 1,
          quarantined: false,
        },
      ],
      [
        {
          domain_id: job.domainId,
          enqueued_job_count: 1,
          quarantined: false,
          hostname: "must-not-leak.creatorshare.com",
        },
      ],
    ]) {
      const repository = createSupabaseDomainProvisioningRepository({
        async rpc() {
          return { data, error: null }
        },
      } as never)

      await expect(
        repository.enqueueDueReconciliations({
          batchSize: 20,
          correlationId: "strict-result-contract-test",
        }),
      ).rejects.toMatchObject({ stage: "enqueue_reconciliations_shape" })
    }
  })
})

function fakeRepository(
  events: string[],
  overrides: Partial<DomainProvisioningRepository> = {},
): DomainProvisioningRepository {
  return {
    async enqueueDueReconciliations() {
      return []
    },
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
      return true
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
  test("settles a verified payment path without entering the mutation phase", async () => {
    const events: string[] = []
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const stripeJob = { ...job, provider: "stripe_us" as const }
    const stripeContext = {
      ...context,
      integrationProvider: "stripe_us" as const,
    }
    let completedEvidence: SafeProviderEvidence | undefined
    const repository = fakeRepository(events, {
      async loadContext() {
        events.push("load_context")
        return stripeContext
      },
      async complete(_job, status, _errorCode, evidence) {
        events.push(`complete_${status}`)
        completedEvidence = evidence
        return status
      },
    })

    const result = await processDomainProvisioningJob({
      repository,
      adapterFactory: createDomainProviderAdapterFactory({
        env: stripeUsEnvironment,
        fetchImplementation: queuedFetch(
          [jsonResponse({ object: "balance", livemode: true })],
          calls,
        ),
      }),
      config: {
        batchSize: 3,
        reconciliationBatchSize: 20,
        leaseSeconds: 300,
      },
      job: stripeJob,
    })

    expect(result.status).toBe("succeeded")
    expect(events).toEqual([
      "load_context",
      "record_reconciliation",
      "complete_succeeded",
    ])
    expect(completedEvidence).toEqual({
      provider_status: "payment_path_ready",
      provider_resource_id: "stripe_us:hosted_checkout",
      http_status: 200,
      verified: true,
    })
    expect(calls).toHaveLength(1)
  })

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
      config: {
        batchSize: 3,
        reconciliationBatchSize: 20,
        leaseSeconds: 300,
      },
      job,
    })

    expect(result.status).toBe("succeeded")
    expect(events).toEqual([
      "load_context",
      "provider_reconcile",
      "record_reconciliation",
      "renew_lease",
      "provider_apply",
      "provider_reconcile",
      "complete_succeeded",
    ])
  })

  test("fits every provider call inside one invocation budget with settlement reserve", async () => {
    const events: string[] = []
    const requestedTimeouts: number[] = []
    let now = 0
    let reconciliationCount = 0
    let currentRequestTimeout = 0
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        reconciliationCount += 1
        now += currentRequestTimeout
        return reconciliationCount === 1
          ? {
              outcome: "not_found",
              desiredStateVerified: false,
              evidence: { provider_status: "not_found", verified: false },
            }
          : {
              outcome: "matches_intent",
              desiredStateVerified: true,
              evidence: { provider_status: "ready", verified: true },
            }
      },
      async apply() {
        events.push("provider_apply")
        now += currentRequestTimeout
        return { provider_status: "create_accepted", verified: false }
      },
    }
    const repository = fakeRepository(events, {
      async recordReconciliation() {
        events.push("record_reconciliation")
        now += 2_000
        return true
      },
      async renewLease() {
        events.push("renew_lease")
        now += 2_000
      },
    })

    await expect(
      processDomainProvisioningJob({
        repository,
        adapterFactory(_provider, requestTimeoutMs) {
          currentRequestTimeout = requestTimeoutMs ?? -1
          requestedTimeouts.push(currentRequestTimeout)
          return adapter
        },
        config: {
          batchSize: 3,
          reconciliationBatchSize: 20,
          leaseSeconds: 300,
        },
        job,
        deadlineAtMilliseconds: 50_000,
        monotonicNow: () => now,
      }),
    ).resolves.toMatchObject({ status: "succeeded" })
    expect(requestedTimeouts).toEqual([10_000, 8_666, 10_000])
    expect(now).toBe(32_666)
  })

  test("refuses provider mutation when database work consumes its remaining budget", async () => {
    const events: string[] = []
    let now = 0
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        now += 10_000
        return {
          outcome: "not_found",
          desiredStateVerified: false,
          evidence: { provider_status: "not_found", verified: false },
        }
      },
      async apply() {
        events.push("provider_apply_must_not_run")
        return {}
      },
    }
    const repository = fakeRepository(events, {
      async recordReconciliation() {
        events.push("record_reconciliation")
        now += 20_000
        return true
      },
      async renewLease() {
        events.push("renew_lease")
        now += 9_000
      },
    })

    await expect(
      processDomainProvisioningJob({
        repository,
        adapterFactory: () => adapter,
        config: {
          batchSize: 3,
          reconciliationBatchSize: 20,
          leaseSeconds: 300,
        },
        job,
        deadlineAtMilliseconds: 50_000,
        monotonicNow: () => now,
      }),
    ).resolves.toEqual({
      jobId: job.jobId,
      status: "retried",
      code: "worker_invocation_budget_exhausted",
    })
    expect(events).toEqual([
      "load_context",
      "provider_reconcile",
      "record_reconciliation",
      "renew_lease",
      "retry",
    ])
  })

  test("durably retries after an accepted apply when final verification times out", async () => {
    const events: string[] = []
    let now = 0
    let reconciliationCount = 0
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        reconciliationCount += 1
        now += reconciliationCount === 1 ? 1_000 : 10_000
        if (reconciliationCount > 1) {
          throw new DomainProvisioningError({
            code: "cloudflare_network_error",
            retryable: true,
          })
        }
        return {
          outcome: "not_found",
          desiredStateVerified: false,
          evidence: { provider_status: "not_found", verified: false },
        }
      },
      async apply() {
        events.push("provider_apply_accepted")
        now += 10_000
        return { provider_status: "create_accepted", verified: false }
      },
    }

    await expect(
      processDomainProvisioningJob({
        repository: fakeRepository(events),
        adapterFactory: () => adapter,
        config: {
          batchSize: 3,
          reconciliationBatchSize: 20,
          leaseSeconds: 300,
        },
        job,
        deadlineAtMilliseconds: 50_000,
        monotonicNow: () => now,
      }),
    ).resolves.toEqual({
      jobId: job.jobId,
      status: "retried",
      code: "cloudflare_network_error",
    })
    expect(events).toEqual([
      "load_context",
      "provider_reconcile",
      "record_reconciliation",
      "renew_lease",
      "provider_apply_accepted",
      "provider_reconcile",
      "retry",
    ])
  })

  test("does not mutate a provider when the pre-apply lifecycle fence is withdrawn", async () => {
    const events: string[] = []
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        return {
          outcome: "not_found",
          desiredStateVerified: false,
          evidence: { provider_status: "not_found", verified: false },
        }
      },
      async apply() {
        events.push("provider_apply_must_not_run")
        return { provider_status: "create_accepted", verified: false }
      },
    }
    const repository = fakeRepository(events, {
      async renewLease() {
        events.push("renew_lease_rejected")
        throw new DomainProvisioningRepositoryError("renew", {
          code: "42501",
        })
      },
    })

    await expect(
      processDomainProvisioningJob({
        repository,
        adapterFactory: () => adapter,
        config: {
          batchSize: 3,
          reconciliationBatchSize: 20,
          leaseSeconds: 300,
        },
        job,
      }),
    ).resolves.toEqual({ jobId: job.jobId, status: "lease_lost" })
    expect(events).toEqual([
      "load_context",
      "provider_reconcile",
      "record_reconciliation",
      "renew_lease_rejected",
    ])
  })

  test("terminally settles an atomic active publication withdrawal before provider repair", async () => {
    const events: string[] = []
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        return {
          outcome: "needs_apply",
          desiredStateVerified: false,
          evidence: { provider_status: "drifted", verified: false },
        }
      },
      async apply() {
        events.push("provider_apply")
        return { provider_status: "repair_accepted", verified: false }
      },
    }
    const repository = fakeRepository(events, {
      async recordReconciliation() {
        events.push("record_reconciliation_withdrawn")
        return false
      },
    })

    const result = await processDomainProvisioningJob({
      repository,
      adapterFactory: () => adapter,
      config: {
        batchSize: 3,
        reconciliationBatchSize: 20,
        leaseSeconds: 300,
      },
      job: { ...job, kind: "reconcile" },
    })

    expect(result).toEqual({
      jobId: job.jobId,
      status: "failed",
      code: "provider_state_drift_detected",
      publicationWithdrawn: true,
    })
    expect(events).toEqual([
      "load_context",
      "provider_reconcile",
      "record_reconciliation_withdrawn",
      "complete_failed",
    ])
  })

  test("records an internally unverified match as nonready evidence", async () => {
    const events: string[] = []
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        return {
          outcome: "matches_intent",
          desiredStateVerified: false,
          evidence: { provider_status: "pending", verified: true },
        }
      },
      async apply() {
        throw new Error(
          "An unverified match must never enter provider mutation",
        )
      },
    }
    const repository = fakeRepository(events, {
      async recordReconciliation(_job, _outcome, evidence) {
        events.push("record_reconciliation_nonready")
        expect(evidence.verified).toBe(false)
        return false
      },
    })

    await expect(
      processDomainProvisioningJob({
        repository,
        adapterFactory: () => adapter,
        config: {
          batchSize: 3,
          reconciliationBatchSize: 20,
          leaseSeconds: 300,
        },
        job: { ...job, kind: "reconcile" },
      }),
    ).resolves.toEqual({
      jobId: job.jobId,
      status: "failed",
      code: "provider_state_drift_detected",
      publicationWithdrawn: true,
    })
    expect(events).toEqual([
      "load_context",
      "provider_reconcile",
      "record_reconciliation_nonready",
      "complete_failed",
    ])
  })

  test("never retries provider work after committed drift withdrawal when terminal settlement is uncertain", async () => {
    for (const scenario of [
      {
        error: new DomainProvisioningRepositoryError("complete", {
          code: "42501",
        }),
        expectedStatus: "lease_lost" as const,
      },
      {
        error: new Error("database response unavailable"),
        expectedStatus: "settlement_unknown" as const,
      },
    ]) {
      const events: string[] = []
      const repository = fakeRepository(events, {
        async recordReconciliation() {
          events.push("record_reconciliation_withdrawn")
          return false
        },
        async complete() {
          events.push("complete_failed_unknown")
          throw scenario.error
        },
        async retry() {
          events.push("retry_must_not_run")
          return "queued"
        },
      })
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
        async apply() {
          events.push("provider_apply_must_not_run")
          return {}
        },
      }

      await expect(
        processDomainProvisioningJob({
          repository,
          adapterFactory: () => adapter,
          config: {
            batchSize: 3,
            reconciliationBatchSize: 20,
            leaseSeconds: 300,
          },
          job: { ...job, kind: "reconcile" },
        }),
      ).resolves.toEqual({
        jobId: job.jobId,
        status: scenario.expectedStatus,
        code: "provider_state_drift_detected",
        publicationWithdrawn: true,
      })
      expect(events).toEqual([
        "load_context",
        "provider_reconcile",
        "record_reconciliation_withdrawn",
        "complete_failed_unknown",
      ])
    }
  })

  test("attempts terminal fail-closed settlement when recording confirmed active drift fails", async () => {
    const events: string[] = []
    const repository = fakeRepository(events, {
      async loadContext() {
        events.push("load_active_context")
        return {
          ...context,
          advocatePublicationStatus: "active",
          domainStatus: "active",
          integrationStatus: "ready",
        }
      },
      async recordReconciliation() {
        events.push("record_reconciliation_failed")
        throw new DomainProvisioningRepositoryError("reconcile", {
          code: "XX000",
        })
      },
      async complete(_job, status, code) {
        events.push(`complete_${status}_${code}`)
        return status
      },
      async retry() {
        events.push("retry_must_not_run")
        return "queued"
      },
    })
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        return {
          outcome: "not_found",
          desiredStateVerified: false,
          evidence: { provider_status: "not_found", verified: false },
        }
      },
      async apply() {
        events.push("provider_apply_must_not_run")
        return {}
      },
    }

    await expect(
      processDomainProvisioningJob({
        repository,
        adapterFactory: () => adapter,
        config: {
          batchSize: 3,
          reconciliationBatchSize: 20,
          leaseSeconds: 300,
        },
        job: { ...job, kind: "reconcile" },
      }),
    ).resolves.toEqual({
      jobId: job.jobId,
      status: "failed",
      code: "provider_state_drift_detected",
      publicationWithdrawn: true,
    })
    expect(events).toEqual([
      "load_active_context",
      "provider_reconcile",
      "record_reconciliation_failed",
      "complete_failed_provider_state_drift_detected",
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
      config: {
        batchSize: 3,
        reconciliationBatchSize: 20,
        leaseSeconds: 300,
      },
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

  test("terminally settles thrown unsafe provider evidence without crashing the batch", async () => {
    const events: string[] = []
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        throw new DomainProvisioningError({
          code: "provider_rejected",
          retryable: true,
          evidence: {
            authorization: "Bearer forbidden",
          } as unknown as SafeProviderEvidence,
        })
      },
      async apply() {
        throw new Error("Provider mutation must not run")
      },
    }

    await expect(
      processDomainProvisioningJob({
        repository: fakeRepository(events),
        adapterFactory: () => adapter,
        config: {
          batchSize: 3,
          reconciliationBatchSize: 20,
          leaseSeconds: 300,
        },
        job,
      }),
    ).resolves.toEqual({
      jobId: job.jobId,
      status: "failed",
      code: "worker_unsafe_provider_evidence",
    })
    expect(events).toEqual(["load_context", "complete_failed"])
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
      config: {
        batchSize: 3,
        reconciliationBatchSize: 20,
        leaseSeconds: 300,
      },
      job,
    })

    expect(result).toMatchObject({
      status: "failed",
      code: "worker_job_no_longer_eligible",
    })
    expect(events).toEqual(["load_context", "complete_failed"])
  })

  test("enqueues due reconciliation before claiming the bounded worker batch", async () => {
    const events: string[] = []
    const repository = fakeRepository(events, {
      async enqueueDueReconciliations(options) {
        events.push("enqueue_due_reconciliations")
        expect(options).toEqual({
          batchSize: 20,
          correlationId:
            "advocate-domain-reconciliation:66666666-6666-4666-8666-666666666666",
        })
        return [
          {
            domainId: job.domainId,
            enqueuedJobCount: 3,
            quarantined: false,
          },
          {
            domainId: "77777777-7777-4777-8777-777777777777",
            enqueuedJobCount: 2,
            quarantined: false,
          },
          {
            domainId: "88888888-8888-4888-8888-888888888888",
            enqueuedJobCount: 0,
            quarantined: true,
          },
        ]
      },
      async claimJobs() {
        events.push("claim_jobs")
        return []
      },
    })

    const result = await runScheduledDomainProvisioningBatch({
      repository,
      adapterFactory: () => {
        throw new Error("No claimed job may create an adapter")
      },
      config: {
        batchSize: 3,
        reconciliationBatchSize: 20,
        leaseSeconds: 300,
      },
      workerId: "advocate-domain-worker:66666666-6666-4666-8666-666666666666",
      correlationId:
        "advocate-domain-reconciliation:66666666-6666-4666-8666-666666666666",
    })

    expect(events).toEqual(["enqueue_due_reconciliations", "claim_jobs"])
    expect(result).toMatchObject({
      scheduledDomains: 2,
      enqueuedReconciliations: 5,
      quarantinedDomains: 1,
      schedulingFailed: false,
      claimed: 0,
      succeeded: 0,
      retried: 0,
      failed: 0,
      leaseLost: 0,
      settlementUnknown: 0,
      withdrawnPublications: 0,
      results: [],
    })
  })

  test("shares the route-entry deadline across every concurrent claimed job", async () => {
    const events: string[] = []
    const requestedTimeouts: number[] = []
    let now = 0
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        return {
          outcome: "matches_intent",
          desiredStateVerified: true,
          evidence: { provider_status: "ready", verified: true },
        }
      },
      async apply() {
        throw new Error("Verified jobs must not mutate the provider")
      },
    }
    const repository = fakeRepository(events, {
      async enqueueDueReconciliations() {
        now += 10_000
        return []
      },
      async claimJobs() {
        now += 10_000
        return [job, { ...job, jobId: "99999999-9999-4999-8999-999999999999" }]
      },
    })

    const result = await runScheduledDomainProvisioningBatch({
      repository,
      adapterFactory(_provider, requestTimeoutMs) {
        requestedTimeouts.push(requestTimeoutMs ?? -1)
        return adapter
      },
      config: {
        batchSize: 3,
        reconciliationBatchSize: 20,
        leaseSeconds: 300,
      },
      workerId: "advocate-domain-worker:66666666-6666-4666-8666-666666666666",
      correlationId:
        "advocate-domain-reconciliation:66666666-6666-4666-8666-666666666666",
      deadlineAtMilliseconds: 50_000,
      monotonicNow: () => now,
    })

    expect(result.succeeded).toBe(2)
    expect(requestedTimeouts).toEqual([5_000, 5_000])
  })

  test("claims durable work even when reconciliation scheduling fails", async () => {
    const events: string[] = []
    const repository = fakeRepository(events, {
      async enqueueDueReconciliations() {
        events.push("enqueue_due_reconciliations_failed")
        throw new DomainProvisioningRepositoryError("enqueue_reconciliations", {
          code: "XX000",
        })
      },
    })
    const adapter: DomainProviderAdapter = {
      provider: "cloudflare",
      async reconcile() {
        events.push("provider_reconcile")
        return {
          outcome: "matches_intent",
          desiredStateVerified: true,
          evidence: { provider_status: "ready", verified: true },
        }
      },
      async apply() {
        throw new Error("Verified durable work must not mutate the provider")
      },
    }

    const result = await runScheduledDomainProvisioningBatch({
      repository,
      adapterFactory: () => adapter,
      config: {
        batchSize: 3,
        reconciliationBatchSize: 20,
        leaseSeconds: 300,
      },
      workerId: "advocate-domain-worker:66666666-6666-4666-8666-666666666666",
      correlationId:
        "advocate-domain-reconciliation:66666666-6666-4666-8666-666666666666",
    })

    expect(events).toEqual([
      "enqueue_due_reconciliations_failed",
      "load_context",
      "provider_reconcile",
      "record_reconciliation",
      "complete_succeeded",
    ])
    expect(result).toMatchObject({
      scheduledDomains: 0,
      enqueuedReconciliations: 0,
      quarantinedDomains: 0,
      schedulingFailed: true,
      schedulingFailureCode: "repository_error",
      claimed: 1,
      succeeded: 1,
      withdrawnPublications: 0,
    })
  })
})

test("worker route bearer comparison is exact", () => {
  const secret = "a_secure_worker_secret_with_32_chars"
  expect(isAuthorizedDomainWorkerRequest(`Bearer ${secret}`, secret)).toBe(true)
  expect(isAuthorizedDomainWorkerRequest(`Bearer ${secret}x`, secret)).toBe(
    false,
  )
  expect(isAuthorizedDomainWorkerRequest(secret, secret)).toBe(false)
  expect(isAuthorizedDomainWorkerRequest(null, secret)).toBe(false)
})

test.describe("domain provisioning configuration", () => {
  test("uses Vercel cron authentication unless a dedicated secret is configured", () => {
    const cronSecret = "c".repeat(48)
    const dedicatedSecret = "d".repeat(48)

    expect(loadWorkerRouteSecret({ CRON_SECRET: cronSecret })).toBe(cronSecret)
    expect(
      loadWorkerRouteSecret({
        ADVOCATE_PROVISIONING_WORKER_SECRET: "",
        CRON_SECRET: cronSecret,
      }),
    ).toBe(cronSecret)
    expect(
      loadWorkerRouteSecret({
        ADVOCATE_PROVISIONING_WORKER_SECRET: dedicatedSecret,
        CRON_SECRET: cronSecret,
      }),
    ).toBe(dedicatedSecret)
    expect(() =>
      loadWorkerRouteSecret({
        ADVOCATE_PROVISIONING_WORKER_SECRET: " ".repeat(48),
        CRON_SECRET: cronSecret,
      }),
    ).toThrow()
  })

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
      ADVOCATE_RECONCILIATION_BATCH_SIZE: "25",
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
      reconciliationBatchSize: 25,
      leaseSeconds: 240,
    })
    expect(
      loadDomainWorkerConfig({
        ADVOCATE_PROVISIONING_LEASE_SECONDS: "900",
      }).leaseSeconds,
    ).toBe(900)
    expect(
      loadCloudflareProvisioningConfig({
        ...env,
        ADVOCATE_PROVISIONING_REQUEST_TIMEOUT_MS: "60000",
      }).requestTimeoutMs,
    ).toBe(60_000)
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
    expect(() =>
      loadDomainWorkerConfig({
        ADVOCATE_RECONCILIATION_BATCH_SIZE: "101",
      }),
    ).toThrow("worker_configuration_invalid")
    expect(() =>
      loadDomainWorkerConfig({
        ADVOCATE_PROVISIONING_LEASE_SECONDS: "59",
      }),
    ).toThrow("worker_configuration_invalid")
    expect(() =>
      loadDomainWorkerConfig({
        ADVOCATE_PROVISIONING_LEASE_SECONDS: "901",
      }),
    ).toThrow("worker_configuration_invalid")
    expect(() =>
      loadCloudflareProvisioningConfig({
        ADVOCATE_CLOUDFLARE_API_TOKEN: cloudflareConfig.apiToken,
        ADVOCATE_CLOUDFLARE_ZONE_ID: cloudflareConfig.zoneId,
        ADVOCATE_CLOUDFLARE_CNAME_TARGET: cloudflareConfig.cnameTarget,
        ADVOCATE_PROVISIONING_REQUEST_TIMEOUT_MS: "60001",
      }),
    ).toThrow("worker_configuration_invalid")
  })

  test("requires live payment checkout and webhook configuration", () => {
    expect(
      loadStripePaymentPathConfig("stripe_us", stripeUsEnvironment),
    ).toMatchObject({
      provider: "stripe_us",
      secretKey: stripeUsEnvironment.STRIPE_SECRET_KEY_US,
      publishableKey: stripeUsEnvironment.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US,
      webhookSecret: stripeUsEnvironment.STRIPE_WEBHOOK_SECRET_US,
    })
    expect(loadPayPalPaymentPathConfig(paypalEnvironment)).toMatchObject({
      provider: "paypal",
      clientId: paypalEnvironment.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
      webhookId: paypalEnvironment.PAYPAL_WEBHOOK_ID,
    })

    expect(() =>
      loadStripePaymentPathConfig("stripe_us", {
        ...stripeUsEnvironment,
        STRIPE_SECRET_KEY_US: `sk_test_${"a".repeat(32)}`,
      }),
    ).toThrow("worker_configuration_invalid")
    expect(() =>
      loadStripePaymentPathConfig("stripe_us", {
        ...stripeUsEnvironment,
        STRIPE_WEBHOOK_SECRET_US: undefined,
      }),
    ).toThrow("worker_configuration_invalid")
    expect(() =>
      loadPayPalPaymentPathConfig({
        ...paypalEnvironment,
        PAYPAL_API_URL: "https://api-m.sandbox.paypal.com",
      }),
    ).toThrow("worker_configuration_invalid")
    expect(() =>
      loadPayPalPaymentPathConfig({
        ...paypalEnvironment,
        PAYPAL_CLIENT_ID: "a_different_browser_client_id",
      }),
    ).toThrow("worker_configuration_invalid")
  })
})
