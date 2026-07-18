import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type CancellationModule =
  typeof import("../../src/lib/sponsorships/cancellation/subscriptionCancellation")

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
  resolve(
    process.cwd(),
    "tests/sponsorships/subscription-cancellation.spec.ts",
  ),
)
const cancellation = testRequire(
  "../../src/lib/sponsorships/cancellation/subscriptionCancellation",
) as CancellationModule
nodeModule._load = originalModuleLoad

const {
  cancelClaimedSubscriptionWithProvider,
  cancelPayPalSubscription,
  cancelStripeSubscription,
  digestSubscriptionCancellationProviderEvidence,
  executeSubscriptionCancellation,
  parseBegunSubscriptionCancellation,
  parseClaimedSubscriptionCancellation,
  parseSettledSubscriptionCancellation,
  parseSubscriptionCancellationBody,
} = cancellation

const SUBSCRIPTION_ID = "11111111-1111-4111-8111-111111111111"
const OPERATION_ID = "22222222-2222-4222-8222-222222222222"
const LEASE_TOKEN = "33333333-3333-4333-8333-333333333333"
const context = {
  requestId: "44444444-4444-4444-8444-444444444444",
  traceId: "trace-safe",
  clientIp: null,
  userAgent: null,
}

function claimed(
  overrides: Partial<
    ReturnType<typeof parseClaimedSubscriptionCancellation>
  > = {},
) {
  return {
    operationId: OPERATION_ID,
    status: "processing" as const,
    leaseToken: LEASE_TOKEN,
    leaseExpiresAt: "2026-07-18T12:05:00.000Z",
    provider: "STRIPE" as const,
    providerAccountScope: "stripe_us",
    providerObjectType: "subscription",
    providerObjectId: "sub_sensitive_provider_reference",
    claimAttemptCount: 1,
    ...overrides,
  }
}

function successfulOutcome() {
  return {
    result: "provider_cancelled" as const,
    effectMayHaveOccurred: true,
    evidence: {
      provider: "STRIPE" as const,
      result: "provider_cancelled" as const,
      httpStatus: 200,
      providerCode: null,
      requestSemantics: "stripe-delete" as const,
    },
  }
}

test.describe("subscription cancellation browser boundary", () => {
  test("accepts a subscription UUID and an optional bounded plain text reason", () => {
    expect(
      parseSubscriptionCancellationBody(
        JSON.stringify({ subscriptionId: SUBSCRIPTION_ID.toUpperCase() }),
      ),
    ).toEqual({ subscriptionId: SUBSCRIPTION_ID, reason: null })

    expect(
      parseSubscriptionCancellationBody(
        JSON.stringify({
          subscriptionId: SUBSCRIPTION_ID,
          reason: "  Duplicate\n recurring   sponsorship  ",
        }),
      ),
    ).toEqual({
      subscriptionId: SUBSCRIPTION_ID,
      reason: "Duplicate recurring sponsorship",
    })

    for (const body of [
      "not json",
      JSON.stringify({}),
      JSON.stringify({ subscriptionId: "sub_provider_id" }),
      JSON.stringify({ subscriptionId: SUBSCRIPTION_ID, provider: "STRIPE" }),
      JSON.stringify({
        subscriptionId: SUBSCRIPTION_ID,
        email: "x@example.test",
      }),
      JSON.stringify({ subscriptionId: SUBSCRIPTION_ID, reason: "" }),
      JSON.stringify({
        subscriptionId: SUBSCRIPTION_ID,
        reason: "x".repeat(501),
      }),
      JSON.stringify({ subscriptionId: SUBSCRIPTION_ID, reason: 42 }),
      "x".repeat(1025),
    ]) {
      expect(parseSubscriptionCancellationBody(body)).toBeNull()
    }
  })

  test("parses only safe begin and settlement fields", () => {
    expect(
      parseBegunSubscriptionCancellation([
        {
          cancellation_operation_id: OPERATION_ID,
          cancellation_status: "pending",
          is_terminal: false,
          replayed: false,
        },
      ]),
    ).toEqual({
      operationId: OPERATION_ID,
      status: "pending",
      terminal: false,
      replayed: false,
    })
    expect(
      parseSettledSubscriptionCancellation([
        {
          cancellation_operation_id: OPERATION_ID,
          cancellation_status: "cancelled",
          is_terminal: true,
          provider_effect_recorded: true,
          replayed: false,
        },
      ]),
    ).toEqual({
      operationId: OPERATION_ID,
      status: "cancelled",
      terminal: true,
      providerEffectRecorded: true,
      replayed: false,
    })
  })

  test("rejects a provider claim without an exact lease and provenance bundle", () => {
    expect(() =>
      parseClaimedSubscriptionCancellation([
        {
          cancellation_operation_id: OPERATION_ID,
          cancellation_status: "processing",
          processing_lease_token: LEASE_TOKEN,
          processing_lease_expires_at: null,
          provider: "STRIPE",
          provider_account_scope: "stripe_us",
          provider_object_type: "subscription",
          provider_object_id: "sub_sensitive",
          claim_attempt_count: 1,
        },
      ]),
    ).toThrow()
  })
})

test.describe("Stripe cancellation adapter", () => {
  test("uses the provider subscription only and accepts cancelled state", async () => {
    const calls: unknown[][] = []
    const result = await cancelStripeSubscription(
      "sub_sensitive_provider_reference",
      15_000,
      {
        subscriptions: {
          async cancel(...args: unknown[]) {
            calls.push(args)
            return { status: "canceled" }
          },
        },
      },
    )

    expect(calls).toEqual([
      [
        "sub_sensitive_provider_reference",
        {
          maxNetworkRetries: 0,
          timeout: 15_000,
        },
      ],
    ])
    expect(result).toEqual(successfulOutcome())
  })

  test("treats exact missing resources as authoritative absence", async () => {
    const result = await cancelStripeSubscription("sub_missing", 15_000, {
      subscriptions: {
        async cancel() {
          throw {
            type: "StripeInvalidRequestError",
            code: "resource_missing",
            statusCode: 404,
          }
        },
      },
    })

    expect(result.result).toBe("provider_not_found")
    expect(result.effectMayHaveOccurred).toBe(true)
    expect(result.evidence.providerCode).toBe("resource_missing")
  })

  test("keeps ambiguous transport failures retryable", async () => {
    const result = await cancelStripeSubscription("sub_ambiguous", 15_000, {
      subscriptions: {
        async cancel() {
          throw { type: "StripeConnectionError" }
        },
      },
    })

    expect(result.result).toBe("provider_retryable_error")
    expect(result.effectMayHaveOccurred).toBe(true)
    expect(JSON.stringify(result)).not.toContain("sub_ambiguous")
  })
})

test.describe("PayPal cancellation adapter", () => {
  test("uses a bounded terminal state transition request", async () => {
    let receivedPath = ""
    let receivedInit: RequestInit | undefined
    const result = await cancelPayPalSubscription(
      "I-SENSITIVE-REFERENCE",
      15_000,
      {
        async request(path, init) {
          receivedPath = path
          receivedInit = init
          return new Response(null, { status: 204 })
        },
      },
    )

    expect(receivedPath).toBe(
      "/v1/billing/subscriptions/I-SENSITIVE-REFERENCE/cancel",
    )
    expect(new Headers(receivedInit?.headers).has("PayPal-Request-Id")).toBe(
      false,
    )
    expect(receivedInit?.signal).toBeInstanceOf(AbortSignal)
    expect(result.result).toBe("provider_cancelled")
  })

  test("rejects an invalid provider timeout before dispatch", async () => {
    let requestCount = 0
    const result = await cancelPayPalSubscription(
      "I-SENSITIVE-REFERENCE",
      999,
      {
        async request() {
          requestCount += 1
          return new Response(null, { status: 204 })
        },
      },
    )

    expect(result.result).toBe("provider_terminal_error")
    expect(result.evidence.providerCode).toBe("INVALID_PROVIDER_TIMEOUT")
    expect(requestCount).toBe(0)
  })

  test("distinguishes absent, cancelled, and suspended subscriptions", async () => {
    const missing = await cancelPayPalSubscription("I-MISSING", 15_000, {
      async request() {
        return Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 })
      },
    })
    const cancelled = await cancelPayPalSubscription("I-CANCELLED", 15_000, {
      async request() {
        return Response.json(
          {
            name: "UNPROCESSABLE_ENTITY",
            details: [
              {
                issue: "SUBSCRIPTION_STATUS_INVALID",
                description: "Subscription is already CANCELLED",
              },
            ],
          },
          { status: 422 },
        )
      },
    })
    const suspended = await cancelPayPalSubscription("I-SUSPENDED", 15_000, {
      async request() {
        return Response.json(
          {
            name: "UNPROCESSABLE_ENTITY",
            details: [
              {
                issue: "SUBSCRIPTION_STATUS_INVALID",
                description: "Subscription is SUSPENDED",
              },
            ],
          },
          { status: 422 },
        )
      },
    })
    const unrelatedText = await cancelPayPalSubscription(
      "I-UNRELATED",
      15_000,
      {
        async request() {
          return Response.json(
            {
              name: "UNPROCESSABLE_ENTITY",
              message: "A cancelled promotion cannot be applied",
              details: [
                {
                  issue: "SOME_OTHER_ISSUE",
                  description: "The request referenced an expired offer",
                },
              ],
            },
            { status: 422 },
          )
        },
      },
    )

    expect(missing.result).toBe("provider_not_found")
    expect(cancelled.result).toBe("provider_already_cancelled")
    expect(suspended.result).toBe("provider_terminal_error")
    expect(unrelatedText.result).toBe("provider_terminal_error")
  })

  test("keeps network uncertainty retryable without logging identifiers", async () => {
    const originalError = console.error
    const originalWarn = console.warn
    const calls: unknown[][] = []
    console.error = (...args: unknown[]) => calls.push(args)
    console.warn = (...args: unknown[]) => calls.push(args)
    try {
      const result = await cancelPayPalSubscription(
        "I-SENSITIVE-NETWORK",
        15_000,
        {
          async request() {
            throw new Error("network detail")
          },
        },
      )
      expect(result.result).toBe("provider_retryable_error")
      expect(result.effectMayHaveOccurred).toBe(true)
      expect(calls).toEqual([])
    } finally {
      console.error = originalError
      console.warn = originalWarn
    }
  })
})

test.describe("durable cancellation orchestration", () => {
  test("does not call a provider for an already cancelled operation", async () => {
    let claimCount = 0
    let providerCount = 0
    const result = await executeSubscriptionCancellation(
      SUBSCRIPTION_ID,
      null,
      context,
      {
        async begin(subscriptionId, reason) {
          expect(subscriptionId).toBe(SUBSCRIPTION_ID)
          expect(reason).toBeNull()
          return {
            operationId: OPERATION_ID,
            status: "cancelled",
            terminal: true,
            replayed: true,
          }
        },
        async claim() {
          claimCount += 1
          return claimed()
        },
        async cancelProvider() {
          providerCount += 1
          return successfulOutcome()
        },
        async settle() {
          throw new Error("unreachable")
        },
      },
    )

    expect(result).toEqual({
      operationId: OPERATION_ID,
      status: "cancelled",
      terminal: true,
      httpStatus: 200,
    })
    expect(claimCount).toBe(0)
    expect(providerCount).toBe(0)
  })

  test("returns processing when provider success cannot be settled locally", async () => {
    const result = await executeSubscriptionCancellation(
      SUBSCRIPTION_ID,
      null,
      context,
      {
        async begin(subscriptionId, reason) {
          expect(subscriptionId).toBe(SUBSCRIPTION_ID)
          expect(reason).toBeNull()
          return {
            operationId: OPERATION_ID,
            status: "pending",
            terminal: false,
            replayed: false,
          }
        },
        async claim() {
          return claimed()
        },
        async cancelProvider() {
          return successfulOutcome()
        },
        async settle() {
          throw new Error("database outcome unknown")
        },
      },
    )

    expect(result).toEqual({
      operationId: OPERATION_ID,
      status: "processing",
      terminal: false,
      httpStatus: 202,
    })
    expect(Object.keys(result).sort()).toEqual(
      ["httpStatus", "operationId", "status", "terminal"].sort(),
    )
  })

  test("returns only safe fields after atomic settlement", async () => {
    const result = await executeSubscriptionCancellation(
      SUBSCRIPTION_ID,
      "Duplicate recurring sponsorship",
      context,
      {
        async begin(subscriptionId, reason) {
          expect(subscriptionId).toBe(SUBSCRIPTION_ID)
          expect(reason).toBe("Duplicate recurring sponsorship")
          return {
            operationId: OPERATION_ID,
            status: "pending",
            terminal: false,
            replayed: false,
          }
        },
        async claim() {
          return claimed()
        },
        async cancelProvider() {
          return successfulOutcome()
        },
        async settle(operationId, leaseToken, outcome, digest) {
          expect(operationId).toBe(OPERATION_ID)
          expect(leaseToken).toBe(LEASE_TOKEN)
          expect(outcome.result).toBe("provider_cancelled")
          expect(digest).toMatch(/^\\x[0-9a-f]{64}$/)
          return {
            operationId: OPERATION_ID,
            status: "cancelled",
            terminal: true,
            providerEffectRecorded: true,
            replayed: false,
          }
        },
      },
    )

    expect(JSON.stringify(result)).not.toContain("sub_sensitive")
    expect(result).toEqual({
      operationId: OPERATION_ID,
      status: "cancelled",
      terminal: true,
      httpStatus: 200,
    })
  })

  test("uses one canonical safe evidence digest", () => {
    const outcome = successfulOutcome()
    const first = digestSubscriptionCancellationProviderEvidence(
      OPERATION_ID,
      outcome.evidence,
    )
    const second = digestSubscriptionCancellationProviderEvidence(
      OPERATION_ID.toUpperCase(),
      outcome.evidence,
    )
    expect(first).toBe(second)
    expect(first).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(first).not.toContain("sub_")
  })

  test("fails closed before provider dispatch on scope mismatch", async () => {
    let stripeCount = 0
    let paypalCount = 0
    const result = await cancelClaimedSubscriptionWithProvider(
      claimed({ providerAccountScope: "paypal" }),
      {
        stripeClientForScope() {
          stripeCount += 1
          return {
            subscriptions: {
              async cancel() {
                return { status: "canceled" }
              },
            },
          }
        },
        paypal: {
          async request() {
            paypalCount += 1
            return new Response(null, { status: 204 })
          },
        },
        timeoutMilliseconds: 15_000,
      },
    )

    expect(result.result).toBe("provider_terminal_error")
    expect(stripeCount).toBe(0)
    expect(paypalCount).toBe(0)
  })
})

test("the route has no direct subscription write, bespoke beneficiary mutation, email, or provider logging path", async () => {
  const source = await readFile(
    resolve(
      process.cwd(),
      "src/app/api/sponsorships/subscriptions/cancel/route.ts",
    ),
    "utf8",
  )

  expect(source).not.toContain('.from("subscriptions")')
  expect(source).not.toContain("beneficiar")
  expect(source).not.toContain("sendSponsorshipCancellationNotificationEmail")
  expect(source).not.toContain("console.")
  expect(source).not.toContain("providerObjectId")
  expect(source).toContain("parseSubscriptionCancellationBody")
  expect(source).toContain("cancelSponsorSubscription")
  expect(source).toContain("request.body.getReader()")
  expect(source).toContain("resolveTrustedPrimaryRequestOrigin")
  expect(source).not.toContain("resolveTrustedCheckoutRequestOrigin")
})

test("the sponsor UI sends only the internal subscription UUID", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/app/(app)/app/columns.tsx"),
    "utf8",
  )

  expect(source).toContain("const subscriptionId = subscription.id")
  expect(source).not.toContain("subscription.sponsorship_id || subscription.id")
})

test("the administrator UI collects a bounded internal override reason", async () => {
  const source = await readFile(
    resolve(process.cwd(), "src/app/(admin)/admin/subscriptions/page.tsx"),
    "utf8",
  )

  expect(source).toContain("const enteredReason = window.prompt")
  expect(source).toContain("reason.length < 10 || reason.length > 500")
  expect(source).toContain("JSON.stringify({ subscriptionId, reason })")
  expect(source).toContain("Do not include email addresses")
})
