import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import type {
  ClaimedSubscriptionCancellation,
  StripeSubscriptionCancellationClient,
  SubscriptionCancellationProviderDependencies,
} from "@/lib/sponsorships/cancellation/subscriptionCancellation"

/**
 * What the cancellation worker actually asks the provider to do.
 *
 * The worker spec stubs `cancelProvider` wholesale, so the real provider
 * branch was never exercised and two mutations to it passed the whole suite.
 *
 * The first drops the check that the claimed provider object really is a
 * subscription, which would hand an invoice or payment intent identifier
 * straight to `stripe.subscriptions.cancel`. The second reports
 * `provider_cancelled` for any returned status other than "incomplete",
 * including "active" and "past_due", so a cancel call that did not actually
 * terminate the subscription is durably recorded as cancelled and the sponsor
 * keeps being billed while the record says otherwise.
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
  resolve(
    process.cwd(),
    "tests/sponsorships/subscription-cancellation-provider.spec.ts",
  ),
)
const moduleCache = testRequire.cache as Record<string, unknown>
const specifier =
  "../../src/lib/sponsorships/cancellation/subscriptionCancellation"
const cachedBeforeLoad = new Set(Object.keys(moduleCache))
const { cancelClaimedSubscriptionWithProvider } = testRequire(
  specifier,
) as typeof import("../../src/lib/sponsorships/cancellation/subscriptionCancellation")
nodeModule._load = originalModuleLoad
// Other specs load this module with their own stubs, and the require cache is
// shared inside one worker process. Purge what this load added.
for (const key of Object.keys(moduleCache)) {
  if (!cachedBeforeLoad.has(key)) delete moduleCache[key]
}

const SUBSCRIPTION_ID = "sub_1ABCDEfghIJKLmno"

function claim(
  overrides: Partial<ClaimedSubscriptionCancellation> = {},
): ClaimedSubscriptionCancellation {
  return {
    operationId: "11111111-1111-4111-8111-111111111111",
    status: "processing",
    leaseToken: "22222222-2222-4222-8222-222222222222",
    leaseExpiresAt: "2026-07-26T00:10:00.000Z",
    provider: "STRIPE",
    providerAccountScope: "stripe_us",
    providerObjectType: "subscription",
    providerObjectId: SUBSCRIPTION_ID,
    claimAttemptCount: 1,
    ...overrides,
  }
}

interface Harness {
  dependencies: SubscriptionCancellationProviderDependencies
  cancelCalls: string[]
}

function harness(returnedStatus: unknown): Harness {
  const cancelCalls: string[] = []
  const stripe: StripeSubscriptionCancellationClient = {
    subscriptions: {
      async cancel(providerObjectId) {
        cancelCalls.push(providerObjectId)
        return { status: returnedStatus }
      },
    },
  }
  return {
    cancelCalls,
    dependencies: {
      stripeClientForScope: () => stripe,
      paypal: {
        async request() {
          throw new Error("paypal_must_not_be_reached")
        },
      },
      timeoutMilliseconds: 15_000,
    },
  }
}

test.describe("subscription cancellation provider branch", () => {
  test("refuses a claim whose provider object is not a subscription", async () => {
    // The decisive case. Without this check the identifier is handed to
    // stripe.subscriptions.cancel regardless of what it actually refers to.
    for (const providerObjectType of [
      "invoice",
      "payment_intent",
      "charge",
      "",
    ]) {
      const { dependencies, cancelCalls } = harness("canceled")

      const outcome = await cancelClaimedSubscriptionWithProvider(
        claim({ providerObjectType }),
        dependencies,
      )

      expect(
        outcome.result,
        `${JSON.stringify(providerObjectType)} must not reach the provider`,
      ).toBe("provider_terminal_error")
      expect(cancelCalls).toEqual([])
    }
  })

  test("refuses a provider account scope outside the Stripe pair", async () => {
    for (const providerAccountScope of ["paypal", "stripe_eu", ""]) {
      const { dependencies, cancelCalls } = harness("canceled")

      const outcome = await cancelClaimedSubscriptionWithProvider(
        claim({ providerAccountScope }),
        dependencies,
      )

      expect(outcome.result).toBe("provider_terminal_error")
      expect(cancelCalls).toEqual([])
    }
  })

  test("treats an incomplete claim as unavailable rather than a provider result", async () => {
    // A null on any of these is a claim the worker should never have handed
    // over, and it is refused by an earlier precondition that throws instead
    // of producing a provider outcome. Asserting it here keeps the two
    // refusals distinct rather than conflating them.
    for (const incomplete of [
      { leaseToken: null },
      { provider: null },
      { providerAccountScope: null },
      { providerObjectType: null },
      { providerObjectId: null },
    ] as const) {
      const { dependencies, cancelCalls } = harness("canceled")

      await expect(
        cancelClaimedSubscriptionWithProvider(claim(incomplete), dependencies),
        `${JSON.stringify(incomplete)} must not reach the provider`,
      ).rejects.toMatchObject({ code: "unavailable" })
      expect(cancelCalls).toEqual([])
    }
  })

  test("reports cancellation only for a genuinely canceled subscription", async () => {
    const { dependencies, cancelCalls } = harness("canceled")

    const outcome = await cancelClaimedSubscriptionWithProvider(
      claim(),
      dependencies,
    )

    expect(outcome.result).toBe("provider_cancelled")
    expect(cancelCalls).toEqual([SUBSCRIPTION_ID])
  })

  test("never reports cancellation for a subscription still in force", async () => {
    // A cancel call that returns any live state has not terminated billing.
    // Recording it as cancelled would tell the sponsor and the ledger that it
    // had, while the provider keeps charging.
    for (const status of [
      "active",
      "past_due",
      "trialing",
      "unpaid",
      "paused",
      "incomplete",
      undefined,
      null,
      42,
    ]) {
      const { dependencies } = harness(status)

      const outcome = await cancelClaimedSubscriptionWithProvider(
        claim(),
        dependencies,
      )

      expect(
        outcome.result,
        `status ${JSON.stringify(status)} must not be reported as cancelled`,
      ).not.toBe("provider_cancelled")
    }
  })
})
