import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type CompatibilityModule =
  typeof import("../../src/lib/payments/legacyProviderCompatibility")
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
    "tests/sponsorships/legacy-provider-compatibility.spec.ts",
  ),
)
const compatibility = testRequire(
  "../../src/lib/payments/legacyProviderCompatibility",
) as CompatibilityModule
nodeModule._load = originalModuleLoad

const {
  createLegacyPayPalSessionHandler,
  createLegacyPayPalVerifyHandler,
  createLegacyStripeSessionHandler,
  createLegacyStripeSuccessHandler,
  genericLegacyPayPalSessionResponse,
  genericLegacyPayPalVerifyResponse,
  genericLegacyStripeSessionResponse,
  genericLegacyStripeSuccessResponse,
} = compatibility

const STRIPE_SESSION_ID = `cs_test_${"A".repeat(32)}`
const PAYPAL_SUBSCRIPTION_ID = "I-BW452GLLEP1G"
const USER_ID = "11111111-1111-4111-8111-111111111111"
const USER = {
  id: USER_ID,
  email: "Sponsor@Example.test",
  emailConfirmedAt: "2026-07-18T10:00:00.000Z",
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function serialized(value: unknown): string {
  return JSON.stringify(value)
}

test("generic responses preserve legacy caller shapes without contact or provider data", async () => {
  const stripeSession = genericLegacyStripeSessionResponse()
  expect(stripeSession.status || stripeSession.session.status).toBe(
    "processing",
  )
  expect(stripeSession.session.metadata.childName).toBeTruthy()

  const stripeSuccess = genericLegacyStripeSuccessResponse()
  expect(stripeSuccess.status).toBe("processing")
  expect(stripeSuccess.payment_status).toBe("processing")

  const paypalVerify = genericLegacyPayPalVerifyResponse()
  expect(paypalVerify.subscription.status).toBe("processing")
  expect(paypalVerify.paypal_order).toBeNull()

  const paypalSession = genericLegacyPayPalSessionResponse()
  expect(paypalSession.session.status).toBe("processing")
  expect(paypalSession.session.metadata.childName).toBeTruthy()

  const allGenericResponses = serialized({
    stripeSession,
    stripeSuccess,
    paypalVerify,
    paypalSession,
  })
  for (const forbidden of [
    "email",
    "customer",
    "payment_intent",
    "subscription_id",
    "provider_object",
    "payer",
    "shipping",
  ]) {
    expect(allGenericResponses).not.toContain(forbidden)
  }
})

test("anonymous Stripe compatibility calls do not contact Stripe", async () => {
  let retrievals = 0
  const handler = createLegacyStripeSessionHandler({
    async getAuthenticatedUser() {
      return null
    },
    async retrieveSession() {
      retrievals += 1
      throw new Error("must not run")
    },
  })

  const response = await handler(
    new Request(
      `https://creatorshare.com/api/stripe/session?id=${STRIPE_SESSION_ID}`,
    ),
  )
  expect(response.status).toBe(200)
  expect(await responseJson(response)).toEqual(
    genericLegacyStripeSessionResponse(),
  )
  expect(retrievals).toBe(0)
  expect(response.headers.get("cache-control")).toContain("no-store")
  expect(response.headers.get("vary")).toBe("Cookie")
})

test("Stripe lookup does not disclose existence to a mismatched owner", async () => {
  const session = {
    id: STRIPE_SESSION_ID,
    status: "complete",
    payment_status: "paid",
    amount_total: 6000,
    currency: "usd",
    customer_details: { email: "somebody-else@example.test" },
    customer: { id: "cus_secret", email: "somebody-else@example.test" },
    payment_intent: { id: "pi_secret" },
    url: "https://checkout.stripe.test/secret",
    metadata: { childName: "A Child", internalId: "secret" },
  }
  const mismatch = createLegacyStripeSuccessHandler({
    async getAuthenticatedUser() {
      return USER
    },
    async retrieveSession() {
      return session
    },
  })
  const missing = createLegacyStripeSuccessHandler({
    async getAuthenticatedUser() {
      return USER
    },
    async retrieveSession() {
      throw new Error("provider says not found")
    },
  })
  const request = new Request(
    `https://creatorshare.com/api/stripe/success?session_id=${STRIPE_SESSION_ID}`,
  )

  expect(await responseJson(await mismatch(request))).toEqual(
    genericLegacyStripeSuccessResponse(),
  )
  expect(await responseJson(await missing(request))).toEqual(
    genericLegacyStripeSuccessResponse(),
  )
})

test("confirmed Stripe owner receives only an allowlisted presentation", async () => {
  const handler = createLegacyStripeSuccessHandler({
    async getAuthenticatedUser() {
      return USER
    },
    async retrieveSession() {
      return {
        id: STRIPE_SESSION_ID,
        status: "complete",
        payment_status: "paid",
        amount_total: 6000,
        currency: "usd",
        customer_details: { email: "sponsor@example.test" },
        customer: { id: "cus_secret", email: "sponsor@example.test" },
        payment_intent: { id: "pi_secret" },
        subscription: { id: "sub_secret" },
        url: "https://checkout.stripe.test/secret",
        metadata: {
          childName: "A Child",
          childLocation: "Arusha",
          sponsorEmail: "sponsor@example.test",
          internalId: "secret",
        },
      }
    },
  })

  const body = await responseJson(
    await handler(
      new Request(
        `https://creatorshare.com/api/stripe/success?session_id=${STRIPE_SESSION_ID}`,
      ),
    ),
  )
  expect(body).toEqual({
    amount_total: 6000,
    currency: "USD",
    payment_status: "paid",
    status: "complete",
    metadata: { childName: "A Child", childLocation: "Arusha" },
    personalized: true,
  })
  const output = serialized(body)
  for (const forbidden of [
    "sponsor@example.test",
    "cus_secret",
    "pi_secret",
    "sub_secret",
    "internalId",
    "url",
  ]) {
    expect(output).not.toContain(forbidden)
  }
})

test("PayPal token and anonymous subscription paths never load provider data", async () => {
  let localLoads = 0
  const handler = createLegacyPayPalVerifyHandler({
    async getAuthenticatedUser() {
      return null
    },
    async loadOwnedSubscription() {
      localLoads += 1
      throw new Error("must not run")
    },
  })

  for (const query of [
    "token=5O190127TN364715T",
    `sponsorship_id=${PAYPAL_SUBSCRIPTION_ID}`,
    "sponsorship_id=invalid",
  ]) {
    expect(
      await responseJson(
        await handler(
          new Request(`https://creatorshare.com/api/paypal/verify?${query}`),
        ),
      ),
    ).toEqual(genericLegacyPayPalVerifyResponse())
  }
  expect(localLoads).toBe(0)
})

test("PayPal subscription presentation requires the owner safe local projection", async () => {
  const foreign = createLegacyPayPalVerifyHandler({
    async getAuthenticatedUser() {
      return USER
    },
    async loadOwnedSubscription() {
      return null
    },
  })
  const owned = createLegacyPayPalVerifyHandler({
    async getAuthenticatedUser() {
      return USER
    },
    async loadOwnedSubscription() {
      return {
        status: "complete",
        amount: 6000,
        interval: "month",
        charged_amount: 6000,
        charged_currency: "usd",
        customer_id: "payer-secret",
        email: "sponsor@example.test",
        beneficiaries: { name: "A Child", location_str: "Arusha" },
      }
    },
  })
  const request = new Request(
    `https://creatorshare.com/api/paypal/verify?sponsorship_id=${PAYPAL_SUBSCRIPTION_ID}`,
  )

  expect(await responseJson(await foreign(request))).toEqual(
    genericLegacyPayPalVerifyResponse(),
  )
  const body = await responseJson(await owned(request))
  expect(body).toEqual({
    subscription: {
      status: "complete",
      amount: 6000,
      interval: "month",
      charged_amount: 6000,
      charged_currency: "USD",
      beneficiaries: { name: "A Child", location_str: "Arusha" },
    },
    paypal_order: null,
    personalized: true,
  })
  expect(serialized(body)).not.toContain("sponsor@example.test")
  expect(serialized(body)).not.toContain("payer-secret")
})

test("legacy route adapters contain no raw provider fallback or unsafe logging", async () => {
  const root = process.cwd()
  const sources = await Promise.all(
    [
      "src/app/api/paypal/verify/route.ts",
      "src/app/api/paypal/session/route.ts",
      "src/app/api/stripe/session/route.ts",
      "src/app/api/stripe/success/route.ts",
    ].map((path) => readFile(resolve(root, path), "utf8")),
  )
  const combined = sources.join("\n")
  expect(sources[0]).toContain(
    'rpc("get_my_legacy_paypal_subscription_presentation"',
  )
  expect(sources[0]).not.toContain('.from("subscriptions")')

  for (const forbidden of [
    "paypalFetch",
    "getPayPalOrder",
    ".insert(",
    "transaction_ledger",
    "console.error",
    "customer_email:",
    'expand: ["payment_intent"',
  ]) {
    expect(combined).not.toContain(forbidden)
  }

  const paypalSessionHandler = createLegacyPayPalSessionHandler()
  expect(
    await responseJson(
      await paypalSessionHandler(
        new Request("https://creatorshare.com/api/paypal/session?id=secret"),
      ),
    ),
  ).toEqual(genericLegacyPayPalSessionResponse())
})
