import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"
import { NextRequest } from "next/server"

import { PAYPAL_MANAGE_URL } from "../../src/lib/payments/portals"
import {
  isRecentVerificationRequiredResponse,
  requestFreshSponsorAuthentication,
  sponsorReauthenticationMessage,
  SPONSOR_REAUTHENTICATION_PATH,
} from "../../src/lib/sponsorships/management/sponsorReauthenticationClient"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type PaymentMethodModule =
  typeof import("../../src/lib/sponsorships/management/paymentMethod")
type PaymentMethodRouteModule =
  typeof import("../../src/app/api/sponsorships/subscriptions/payment-method/route")

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111"
const SUBSCRIPTION_ID = "22222222-2222-4222-8222-222222222222"
const STRIPE_SUBSCRIPTION_ID = "sub_123456789ABCDEFG"
const STRIPE_CUSTOMER_ID = "cus_123456789ABCDEFG"
const STRIPE_PORTAL_URL =
  "https://billing.stripe.com/p/session/test_secure_session_value"
const US_CONFIGURATION_ID = "bpc_123456789ABCDEFG"
const UK_CONFIGURATION_ID = "bpc_987654321ABCDEFG"
const ORIGIN = "https://creatorshare.com"

interface RpcResponse {
  data: unknown
  error: { code?: string; message?: string } | null
}

let authenticatedUser: { id: string } | null = { id: ACCOUNT_ID }
let authenticationError: { message: string } | null = null
let authenticationThrownError: Error | null = null
let authorizationResponse: RpcResponse
let resolutionResponse: RpcResponse
let createClientCalls = 0
let createServiceClientCalls = 0
let stripeRegionCalls: string[] = []
let stripeRetrieveCalls: unknown[][] = []
let stripePortalCalls: unknown[][] = []
let liveStripeSubscription: {
  id: string
  customer: string | { id: string }
  status: string
  collection_method: string
  default_payment_method: string | null
  default_source: string | null
}
let stripePortalUrl: string | null = STRIPE_PORTAL_URL
let stripeRetrieveError: Error | null = null
let stripePortalError: Error | null = null
const rpcCalls: Array<{
  client: "authenticated" | "service"
  name: string
  args: Record<string, unknown>
}> = []

function authorizationSuccess(): RpcResponse {
  return { data: [{ authorized: true }], error: null }
}

function stripeResolution(
  overrides: Record<string, unknown> = {},
): RpcResponse {
  return {
    data: [
      {
        payment_provider: "STRIPE",
        provider_account_scope: "stripe_us",
        provider_customer_id: STRIPE_CUSTOMER_ID,
        provider_subscription_id: STRIPE_SUBSCRIPTION_ID,
        ...overrides,
      },
    ],
    error: null,
  }
}

function paypalResolution(
  overrides: Record<string, unknown> = {},
): RpcResponse {
  return {
    data: [
      {
        payment_provider: "PAYPAL",
        provider_account_scope: "paypal",
        provider_customer_id: null,
        provider_subscription_id: "I-123456789ABCDEFG",
        ...overrides,
      },
    ],
    error: null,
  }
}

const authenticatedClient = {
  auth: {
    async getUser() {
      if (authenticationThrownError) throw authenticationThrownError
      return {
        data: { user: authenticatedUser },
        error: authenticationError,
      }
    },
  },
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ client: "authenticated", name, args })
    return authorizationResponse
  },
}

const serviceClient = {
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push({ client: "service", name, args })
    return resolutionResponse
  },
}

const stripeClient = {
  subscriptions: {
    async retrieve(...args: unknown[]) {
      stripeRetrieveCalls.push(args)
      if (stripeRetrieveError) throw stripeRetrieveError
      return liveStripeSubscription
    },
  },
  billingPortal: {
    sessions: {
      async create(...args: unknown[]) {
        stripePortalCalls.push(args)
        if (stripePortalError) throw stripePortalError
        return { url: stripePortalUrl }
      },
    },
  },
}

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/lib/stripe/config") {
    return {
      getStripeClient(region: string) {
        stripeRegionCalls.push(region)
        return stripeClient
      },
    }
  }
  if (request === "@/utils/supabase/server") {
    return {
      async createClient() {
        createClientCalls += 1
        return authenticatedClient
      },
      createServiceRoleClient() {
        createServiceClientCalls += 1
        return serviceClient
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/payment-method-management.spec.ts",
  ),
)
const paymentMethodPath = testRequire.resolve(
  "../../src/lib/sponsorships/management/paymentMethod",
)
const paymentMethodRoutePath = testRequire.resolve(
  "../../src/app/api/sponsorships/subscriptions/payment-method/route",
)
delete testRequire.cache[paymentMethodPath]
delete testRequire.cache[paymentMethodRoutePath]
const paymentMethod = testRequire(paymentMethodPath) as PaymentMethodModule
const { POST } = testRequire(paymentMethodRoutePath) as PaymentMethodRouteModule
nodeModule._load = originalModuleLoad

const {
  createSponsorPaymentMethodDestination,
  getSponsorPaymentManagementReturnUrl,
  getStripeBillingPortalConfigurationId,
  MAXIMUM_PAYMENT_METHOD_MANAGEMENT_BODY_BYTES,
  parsePaymentMethodManagementBody,
  PAYPAL_PAYMENT_METHOD_MANAGEMENT_LABEL,
  PaymentMethodManagementError,
  requireStripeBillingPortalUrl,
} = paymentMethod

const ORIGINAL_ENVIRONMENT = {
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID_US:
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID_US,
  STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK:
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK,
}

function routeRequest(
  body: string,
  headerOverrides: Record<string, string | null> = {},
): NextRequest {
  const headers = new Headers({
    host: "creatorshare.com",
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json; charset=utf-8",
  })
  for (const [name, value] of Object.entries(headerOverrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  return new NextRequest(
    `${ORIGIN}/api/sponsorships/subscriptions/payment-method`,
    { method: "POST", headers, body },
  )
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

function dependencies(
  overrides: {
    authorization?: RpcResponse
    resolution?: RpcResponse
    liveSubscription?: {
      id: string
      customer: string | { id: string } | null
      status: string
      collectionMethod: string
      hasDefaultPaymentMethodOverride: boolean
      hasDefaultSourceOverride: boolean
    }
    portalUrl?: string | null
  } = {},
) {
  const calls: Array<{ name: string; args?: unknown }> = []
  return {
    calls,
    value: {
      authenticatedClient: {
        async rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args })
          return overrides.authorization ?? authorizationSuccess()
        },
      },
      serviceClient: {
        async rpc(name: string, args: Record<string, unknown>) {
          calls.push({ name, args })
          return overrides.resolution ?? stripeResolution()
        },
      },
      stripeForRegion(region: "us" | "uk") {
        calls.push({ name: "stripeForRegion", args: region })
        return {
          async retrieveSubscription(providerSubscriptionId: string) {
            calls.push({
              name: "retrieveSubscription",
              args: providerSubscriptionId,
            })
            return (
              overrides.liveSubscription ?? {
                id: STRIPE_SUBSCRIPTION_ID,
                customer: STRIPE_CUSTOMER_ID,
                status: "active",
                collectionMethod: "charge_automatically",
                hasDefaultPaymentMethodOverride: false,
                hasDefaultSourceOverride: false,
              }
            )
          },
          async createPaymentMethodPortalSession(input: unknown) {
            calls.push({
              name: "createPaymentMethodPortalSession",
              args: input,
            })
            return { url: overrides.portalUrl ?? STRIPE_PORTAL_URL }
          },
        }
      },
      portalConfigurationId(region: "us" | "uk") {
        calls.push({ name: "portalConfigurationId", args: region })
        return region === "us" ? US_CONFIGURATION_ID : UK_CONFIGURATION_ID
      },
      returnUrl: `${ORIGIN}/app`,
    },
  }
}

test.beforeEach(() => {
  authenticatedUser = { id: ACCOUNT_ID }
  authenticationError = null
  authenticationThrownError = null
  authorizationResponse = authorizationSuccess()
  resolutionResponse = stripeResolution()
  createClientCalls = 0
  createServiceClientCalls = 0
  stripeRegionCalls = []
  stripeRetrieveCalls = []
  stripePortalCalls = []
  liveStripeSubscription = {
    id: STRIPE_SUBSCRIPTION_ID,
    customer: STRIPE_CUSTOMER_ID,
    status: "active",
    collection_method: "charge_automatically",
    default_payment_method: null,
    default_source: null,
  }
  stripePortalUrl = STRIPE_PORTAL_URL
  stripeRetrieveError = null
  stripePortalError = null
  rpcCalls.length = 0
  process.env.NEXT_PUBLIC_BASE_URL = ORIGIN
  process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID_US = US_CONFIGURATION_ID
  process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK = UK_CONFIGURATION_ID
})

test.afterAll(() => {
  for (const [name, value] of Object.entries(ORIGINAL_ENVIRONMENT)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test.describe("payment method browser payload", () => {
  test("accepts only one internal subscription UUID", () => {
    expect(
      parsePaymentMethodManagementBody(
        JSON.stringify({ subscriptionId: SUBSCRIPTION_ID.toUpperCase() }),
      ),
    ).toEqual({ subscriptionId: SUBSCRIPTION_ID })

    for (const body of [
      "not-json",
      "[]",
      "{}",
      JSON.stringify({ subscriptionId: "sub_provider_reference" }),
      JSON.stringify({ subscriptionId: SUBSCRIPTION_ID, provider: "STRIPE" }),
      JSON.stringify({ subscriptionId: SUBSCRIPTION_ID, customerId: "cus_x" }),
      JSON.stringify({
        subscriptionId: SUBSCRIPTION_ID,
        email: "x@example.test",
      }),
      JSON.stringify({ subscriptionId: SUBSCRIPTION_ID, returnUrl: ORIGIN }),
      "x".repeat(MAXIMUM_PAYMENT_METHOD_MANAGEMENT_BODY_BYTES + 1),
    ]) {
      expect(parsePaymentMethodManagementBody(body)).toBeNull()
    }
  })
})

test.describe("ownership scoped provider resolution", () => {
  test("authorizes under the sponsor JWT before service role resolution", async () => {
    const setup = dependencies()
    await createSponsorPaymentMethodDestination(
      ACCOUNT_ID,
      SUBSCRIPTION_ID,
      setup.value,
    )

    expect(setup.calls.slice(0, 2)).toEqual([
      {
        name: "authorize_sponsor_subscription_payment_management",
        args: { target_subscription_id: SUBSCRIPTION_ID },
      },
      {
        name: "resolve_owned_subscription_payment_management",
        args: {
          target_account_id: ACCOUNT_ID,
          target_subscription_id: SUBSCRIPTION_ID,
        },
      },
    ])
  })

  test("surfaces recent verification and never invokes service role afterward", async () => {
    const setup = dependencies({
      authorization: {
        data: null,
        error: {
          code: "42501",
          message: "recent-verification-required: magiclink or otp required",
        },
      },
    })

    await expect(
      createSponsorPaymentMethodDestination(
        ACCOUNT_ID,
        SUBSCRIPTION_ID,
        setup.value,
      ),
    ).rejects.toMatchObject({
      code: "recent-verification-required",
      httpStatus: 428,
    })
    expect(setup.calls).toHaveLength(1)
  })

  test("fails closed on cross-owner denial and malformed resolver rows", async () => {
    const denied = dependencies({
      authorization: {
        data: null,
        error: { code: "42501", message: "subscription not owned" },
      },
    })
    await expect(
      createSponsorPaymentMethodDestination(
        ACCOUNT_ID,
        SUBSCRIPTION_ID,
        denied.value,
      ),
    ).rejects.toMatchObject({ code: "forbidden", httpStatus: 403 })
    expect(denied.calls).toHaveLength(1)

    const injected = dependencies({
      resolution: stripeResolution({ sponsor_email: "secret@example.test" }),
    })
    await expect(
      createSponsorPaymentMethodDestination(
        ACCOUNT_ID,
        SUBSCRIPTION_ID,
        injected.value,
      ),
    ).rejects.toBeInstanceOf(PaymentMethodManagementError)
  })

  test("fails closed when the provider customer is not exclusive to the sponsor", async () => {
    const setup = dependencies({
      resolution: {
        data: null,
        error: {
          code: "23514",
          message:
            "Subscription payment management provider customer ownership is ambiguous",
        },
      },
    })

    await expect(
      createSponsorPaymentMethodDestination(
        ACCOUNT_ID,
        SUBSCRIPTION_ID,
        setup.value,
      ),
    ).rejects.toMatchObject({ code: "unavailable", httpStatus: 503 })
    expect(setup.calls.some((call) => call.name === "stripeForRegion")).toBe(
      false,
    )
  })
})

test.describe("Stripe payment method management", () => {
  test("uses the exact US account, customer, configuration, flow, and return URL", async () => {
    const setup = dependencies()
    await expect(
      createSponsorPaymentMethodDestination(
        ACCOUNT_ID,
        SUBSCRIPTION_ID,
        setup.value,
      ),
    ).resolves.toEqual({
      url: STRIPE_PORTAL_URL,
      label: "Update default payment method in Stripe.",
    })

    expect(setup.calls).toContainEqual({
      name: "stripeForRegion",
      args: "us",
    })
    expect(setup.calls).toContainEqual({
      name: "createPaymentMethodPortalSession",
      args: {
        customerId: STRIPE_CUSTOMER_ID,
        configurationId: US_CONFIGURATION_ID,
        returnUrl: `${ORIGIN}/app`,
      },
    })
  })

  test("routes UK scope only to the UK account and accepts expanded customer identity", async () => {
    const setup = dependencies({
      resolution: stripeResolution({ provider_account_scope: "stripe_uk" }),
      liveSubscription: {
        id: STRIPE_SUBSCRIPTION_ID,
        customer: { id: STRIPE_CUSTOMER_ID },
        status: "active",
        collectionMethod: "charge_automatically",
        hasDefaultPaymentMethodOverride: false,
        hasDefaultSourceOverride: false,
      },
    })
    await createSponsorPaymentMethodDestination(
      ACCOUNT_ID,
      SUBSCRIPTION_ID,
      setup.value,
    )

    expect(setup.calls).toContainEqual({
      name: "stripeForRegion",
      args: "uk",
    })
    expect(setup.calls).toContainEqual({
      name: "portalConfigurationId",
      args: "uk",
    })
  })

  test("rejects live subscription and customer mismatches before portal creation", async () => {
    for (const liveSubscription of [
      {
        id: "sub_DIFFERENT123456",
        customer: STRIPE_CUSTOMER_ID,
        status: "active",
        collectionMethod: "charge_automatically",
        hasDefaultPaymentMethodOverride: false,
        hasDefaultSourceOverride: false,
      },
      {
        id: STRIPE_SUBSCRIPTION_ID,
        customer: "cus_DIFFERENT123456",
        status: "active",
        collectionMethod: "charge_automatically",
        hasDefaultPaymentMethodOverride: false,
        hasDefaultSourceOverride: false,
      },
      {
        id: STRIPE_SUBSCRIPTION_ID,
        customer: null,
        status: "active",
        collectionMethod: "charge_automatically",
        hasDefaultPaymentMethodOverride: false,
        hasDefaultSourceOverride: false,
      },
    ]) {
      const setup = dependencies({ liveSubscription })
      await expect(
        createSponsorPaymentMethodDestination(
          ACCOUNT_ID,
          SUBSCRIPTION_ID,
          setup.value,
        ),
      ).rejects.toMatchObject({ code: "unavailable", httpStatus: 503 })
      expect(
        setup.calls.some(
          (call) => call.name === "createPaymentMethodPortalSession",
        ),
      ).toBe(false)
    }
  })

  test("rejects subscription-level payment method overrides before portal creation", async () => {
    for (const override of [
      { hasDefaultPaymentMethodOverride: true },
      { hasDefaultSourceOverride: true },
    ]) {
      const setup = dependencies({
        liveSubscription: {
          id: STRIPE_SUBSCRIPTION_ID,
          customer: STRIPE_CUSTOMER_ID,
          status: "active",
          collectionMethod: "charge_automatically",
          hasDefaultPaymentMethodOverride: false,
          hasDefaultSourceOverride: false,
          ...override,
        },
      })

      await expect(
        createSponsorPaymentMethodDestination(
          ACCOUNT_ID,
          SUBSCRIPTION_ID,
          setup.value,
        ),
      ).rejects.toMatchObject({ code: "unavailable", httpStatus: 503 })
      expect(
        setup.calls.some(
          (call) => call.name === "createPaymentMethodPortalSession",
        ),
      ).toBe(false)
    }
  })

  test("rejects unsupported collection methods and lifecycle states", async () => {
    for (const unsupported of [
      { collectionMethod: "send_invoice", status: "active" },
      { collectionMethod: "charge_automatically", status: "incomplete" },
      { collectionMethod: "charge_automatically", status: "unpaid" },
      { collectionMethod: "charge_automatically", status: "paused" },
      { collectionMethod: "charge_automatically", status: "canceled" },
    ]) {
      const setup = dependencies({
        liveSubscription: {
          id: STRIPE_SUBSCRIPTION_ID,
          customer: STRIPE_CUSTOMER_ID,
          hasDefaultPaymentMethodOverride: false,
          hasDefaultSourceOverride: false,
          ...unsupported,
        },
      })

      await expect(
        createSponsorPaymentMethodDestination(
          ACCOUNT_ID,
          SUBSCRIPTION_ID,
          setup.value,
        ),
      ).rejects.toMatchObject({ code: "unavailable", httpStatus: 503 })
      expect(
        setup.calls.some(
          (call) => call.name === "createPaymentMethodPortalSession",
        ),
      ).toBe(false)
    }
  })

  test("accepts every supported automatically charged lifecycle state", async () => {
    for (const status of ["active", "past_due", "trialing"]) {
      const setup = dependencies({
        liveSubscription: {
          id: STRIPE_SUBSCRIPTION_ID,
          customer: STRIPE_CUSTOMER_ID,
          status,
          collectionMethod: "charge_automatically",
          hasDefaultPaymentMethodOverride: false,
          hasDefaultSourceOverride: false,
        },
      })

      await expect(
        createSponsorPaymentMethodDestination(
          ACCOUNT_ID,
          SUBSCRIPTION_ID,
          setup.value,
        ),
      ).resolves.toMatchObject({ url: STRIPE_PORTAL_URL })
    }
  })

  test("accepts only the exact Stripe billing portal HTTPS origin", () => {
    expect(requireStripeBillingPortalUrl(STRIPE_PORTAL_URL)).toBe(
      STRIPE_PORTAL_URL,
    )
    for (const hostile of [
      "http://billing.stripe.com/p/session/token",
      "https://billing.stripe.com.evil.test/p/session/token",
      "https://billing.stripe.com@evil.test/p/session/token",
      "https://evil.test/?next=https://billing.stripe.com",
      "https://billing.stripe.com:444/p/session/token",
      "https://user:password@billing.stripe.com/p/session/token",
      "https://billing.stripe.com/p/session/token#secret",
      " https://billing.stripe.com/p/session/token",
      "javascript:alert(1)",
      null,
    ]) {
      expect(() => requireStripeBillingPortalUrl(hostile)).toThrow(
        PaymentMethodManagementError,
      )
    }
  })

  test("requires an account-specific configuration ID for each region", () => {
    const environment = {
      STRIPE_BILLING_PORTAL_CONFIGURATION_ID_US: US_CONFIGURATION_ID,
      STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK: UK_CONFIGURATION_ID,
    }
    expect(getStripeBillingPortalConfigurationId("us", environment)).toBe(
      US_CONFIGURATION_ID,
    )
    expect(getStripeBillingPortalConfigurationId("uk", environment)).toBe(
      UK_CONFIGURATION_ID,
    )
    expect(() =>
      getStripeBillingPortalConfigurationId("us", {
        STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK: UK_CONFIGURATION_ID,
      }),
    ).toThrow(PaymentMethodManagementError)
    expect(() =>
      getStripeBillingPortalConfigurationId("uk", {
        STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK: "https://evil.test",
      }),
    ).toThrow(PaymentMethodManagementError)
  })

  test("constructs only the canonical account return path", () => {
    expect(
      getSponsorPaymentManagementReturnUrl({
        NODE_ENV: "production",
        NEXT_PUBLIC_BASE_URL: "https://evil.test/ignored",
      }),
    ).toBe(`${ORIGIN}/app`)
    expect(() =>
      getSponsorPaymentManagementReturnUrl({
        NODE_ENV: "development",
        NEXT_PUBLIC_BASE_URL: "https://user:secret@creatorshare.com",
      }),
    ).toThrow(PaymentMethodManagementError)
  })
})

test.describe("PayPal payment method management", () => {
  test("returns only the fixed Automatic Payments destination and accurate copy", async () => {
    const setup = dependencies({ resolution: paypalResolution() })
    const result = await createSponsorPaymentMethodDestination(
      ACCOUNT_ID,
      SUBSCRIPTION_ID,
      setup.value,
    )

    expect(result).toEqual({
      url: PAYPAL_MANAGE_URL,
      label: PAYPAL_PAYMENT_METHOD_MANAGEMENT_LABEL,
    })
    expect(JSON.stringify(result)).not.toContain("I-123456789ABCDEFG")
    expect(setup.calls.some((call) => call.name === "stripeForRegion")).toBe(
      false,
    )
  })
})

test.describe("payment method route", () => {
  test("rejects non-primary, cross-origin, non-JSON, and oversized requests before auth", async () => {
    const requests = [
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID }), {
        origin: "https://attacker.example",
      }),
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID }), {
        host: "hope.creatorshare.com",
        origin: "https://hope.creatorshare.com",
      }),
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID }), {
        "content-type": "text/plain",
      }),
      routeRequest(
        "x".repeat(MAXIMUM_PAYMENT_METHOD_MANAGEMENT_BODY_BYTES + 1),
      ),
    ]

    for (const request of requests) {
      const response = await POST(request)
      expect(response.status).toBe(400)
      expect(await responseBody(response)).toEqual({
        error: "invalid-request",
      })
    }
    expect(createClientCalls).toBe(0)
    expect(createServiceClientCalls).toBe(0)
  })

  test("requires authentication and surfaces the exact recent verification outcome", async () => {
    authenticatedUser = null
    const unauthorized = await POST(
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID })),
    )
    expect(unauthorized.status).toBe(401)
    expect(await responseBody(unauthorized)).toEqual({ error: "unauthorized" })
    expect(createServiceClientCalls).toBe(0)

    authenticatedUser = { id: ACCOUNT_ID }
    authorizationResponse = {
      data: null,
      error: {
        code: "42501",
        message: "recent-verification-required: stale session",
      },
    }
    const stale = await POST(
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID })),
    )
    expect(stale.status).toBe(428)
    expect(await responseBody(stale)).toEqual({
      error: "recent-verification-required",
    })
    expect(rpcCalls.filter((call) => call.client === "service")).toEqual([])
  })

  test("maps a thrown authentication transport failure to a static unavailable response", async () => {
    authenticationThrownError = new Error(
      `authentication transport failed ${STRIPE_PORTAL_URL}`,
    )

    const response = await POST(
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID })),
    )

    expect(response.status).toBe(503)
    expect(await responseBody(response)).toEqual({ error: "unavailable" })
    expect(createServiceClientCalls).toBe(0)
    expect(rpcCalls).toEqual([])
  })

  test("uses the regional Stripe SDK with bounded calls and an exact deep-link flow", async () => {
    const response = await POST(
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID })),
    )
    expect(response.status).toBe(200)
    expect(await responseBody(response)).toEqual({
      url: STRIPE_PORTAL_URL,
      label: "Update default payment method in Stripe.",
    })
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    )
    expect(stripeRegionCalls).toEqual(["us"])
    expect(stripeRetrieveCalls).toEqual([
      [STRIPE_SUBSCRIPTION_ID, { maxNetworkRetries: 0, timeout: 15_000 }],
    ])
    expect(stripePortalCalls).toEqual([
      [
        {
          customer: STRIPE_CUSTOMER_ID,
          configuration: US_CONFIGURATION_ID,
          return_url: `${ORIGIN}/app`,
          flow_data: {
            type: "payment_method_update",
            after_completion: {
              type: "redirect",
              redirect: { return_url: `${ORIGIN}/app` },
            },
          },
        },
        { maxNetworkRetries: 0, timeout: 15_000 },
      ],
    ])
  })

  test("maps live Stripe state and blocks overrides before creating a session", async () => {
    for (const unsupported of [
      { default_payment_method: "pm_subscription_override" },
      { default_source: "card_subscription_override" },
      { collection_method: "send_invoice" },
      { status: "unpaid" },
    ]) {
      liveStripeSubscription = {
        id: STRIPE_SUBSCRIPTION_ID,
        customer: STRIPE_CUSTOMER_ID,
        status: "active",
        collection_method: "charge_automatically",
        default_payment_method: null,
        default_source: null,
        ...unsupported,
      }
      stripePortalCalls = []

      const response = await POST(
        routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID })),
      )

      expect(response.status).toBe(503)
      expect(await responseBody(response)).toEqual({ error: "unavailable" })
      expect(stripePortalCalls).toEqual([])
    }
  })

  test("never calls Stripe or returns provider material for PayPal", async () => {
    resolutionResponse = paypalResolution()
    const response = await POST(
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID })),
    )
    expect(response.status).toBe(200)
    const body = await responseBody(response)
    expect(body).toEqual({
      url: PAYPAL_MANAGE_URL,
      label: PAYPAL_PAYMENT_METHOD_MANAGEMENT_LABEL,
    })
    expect(stripeRegionCalls).toEqual([])
    expect(JSON.stringify(body)).not.toContain("I-123456789ABCDEFG")
  })

  test("redacts provider identifiers and bearer material from failures", async () => {
    stripePortalError = new Error(
      `provider failure ${STRIPE_CUSTOMER_ID} ${STRIPE_SUBSCRIPTION_ID} ${STRIPE_PORTAL_URL}`,
    )
    const response = await POST(
      routeRequest(JSON.stringify({ subscriptionId: SUBSCRIPTION_ID })),
    )
    const serialized = JSON.stringify(await responseBody(response))

    expect(response.status).toBe(503)
    expect(serialized).toBe('{"error":"unavailable"}')
    expect(serialized).not.toContain(STRIPE_CUSTOMER_ID)
    expect(serialized).not.toContain(STRIPE_SUBSCRIPTION_ID)
    expect(serialized).not.toContain("test_secure_session_value")
    expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  })
})

test.describe("shared sponsor reauthentication client", () => {
  test("recognizes only the exact HTTP 428 contract", () => {
    expect(
      isRecentVerificationRequiredResponse(428, {
        error: "recent-verification-required",
      }),
    ).toBe(true)

    for (const candidate of [
      [403, { error: "recent-verification-required" }],
      [428, { error: "forbidden" }],
      [428, { error: "recent-verification-required", detail: "secret" }],
      [428, null],
    ] as const) {
      expect(
        isRecentVerificationRequiredResponse(candidate[0], candidate[1]),
      ).toBe(false)
    }
  })

  test("posts one empty same-origin request and accepts only the fixed response", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const accepted = await requestFreshSponsorAuthentication(
      async (input, init) => {
        calls.push({ input, init })
        return Response.json({ status: "check-email" }, { status: 202 })
      },
    )

    expect(accepted).toBe(true)
    expect(calls).toEqual([
      {
        input: SPONSOR_REAUTHENTICATION_PATH,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          cache: "no-store",
          credentials: "same-origin",
          redirect: "error",
        },
      },
    ])

    await expect(
      requestFreshSponsorAuthentication(async () =>
        Response.json(
          { status: "check-email", provider: "accepted" },
          { status: 202 },
        ),
      ),
    ).resolves.toBe(false)
    await expect(
      requestFreshSponsorAuthentication(async () => {
        throw new Error("network unavailable")
      }),
    ).resolves.toBe(false)
  })

  test("gives action-specific instructions without implying cancellation", () => {
    expect(sponsorReauthenticationMessage("cancel-sponsorship", true)).toBe(
      "Check your email for a secure sign-in link. After the link returns you to Creator Share, open this sponsorship and confirm cancellation again. No cancellation has been submitted yet.",
    )
    expect(
      sponsorReauthenticationMessage("update-payment-method", true),
    ).toContain("select Payment Method again")
    expect(
      sponsorReauthenticationMessage("cancel-sponsorship", false),
    ).not.toContain("check your email")
  })
})

test("the sponsor dashboard sends only an internal UUID and never logs a bearer URL", async () => {
  const source = await readFile(
    resolve(
      process.cwd(),
      "src/app/(app)/app/components/ManagePaymentMethodButton.tsx",
    ),
    "utf8",
  )
  const routeSource = await readFile(
    resolve(
      process.cwd(),
      "src/app/api/sponsorships/subscriptions/payment-method/route.ts",
    ),
    "utf8",
  )
  const reauthenticationSource = await readFile(
    resolve(
      process.cwd(),
      "src/lib/sponsorships/management/sponsorReauthenticationClient.ts",
    ),
    "utf8",
  )

  expect(source).toContain("JSON.stringify({ subscriptionId })")
  expect(source).not.toContain("providerSubscriptionId")
  expect(source).not.toContain("providerCustomerId")
  expect(source).not.toContain("console.")
  expect(source).toContain("requestFreshSponsorAuthentication")
  expect(source).toContain("Manage automatic payments in PayPal.")
  expect(source).toContain("Update default payment method in Stripe.")
  expect(source).toContain("does not have a separately selected payment method")
  expect(source).toContain("window.confirm")
  expect(reauthenticationSource).toContain("recent-verification-required")
  expect(reauthenticationSource).toContain("/api/sponsor-account/reauth/start")
  expect(routeSource).not.toContain("console.")
  expect(routeSource).not.toContain('.from("subscriptions")')
})
