import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  loadPublicationPaymentCanaryConfig,
  loadStripePaymentPathConfig,
  type PayPalPublicationPaymentCanaryConfig,
  type StripePublicationPaymentCanaryConfig,
} from "../../src/lib/advocates/provisioning/config"
import {
  paypalCheckoutReturnUrls,
  stripeCheckoutReturnUrls,
} from "../../src/lib/sponsorships/checkout/providerReturnUrls"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown
type PaymentCanaryModule =
  typeof import("../../src/lib/advocates/provisioning/paymentCanaries")

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
  resolve(process.cwd(), "tests/advocates/payment-canaries.spec.ts"),
)
const { runPayPalPublicationPaymentCanary, runStripePublicationPaymentCanary } =
  testRequire(
    "../../src/lib/advocates/provisioning/paymentCanaries",
  ) as PaymentCanaryModule
nodeModule._load = originalModuleLoad

const CANARY_ATTEMPT_ID = "11111111-1111-4111-8111-111111111111"
const ADVOCATE_HOSTNAME = "alice.creatorshare.com"
const VERIFIED_AT = new Date("2026-07-18T19:00:00.000Z")
const PROVIDER_CREATED_AT = "2026-07-18T18:59:00.000Z"
const STRIPE_PROVIDER_CREATED = Date.parse(PROVIDER_CREATED_AT) / 1000
const STRIPE_SESSION_ID = `cs_live_${"s".repeat(24)}`
const PAYPAL_SUBSCRIPTION_ID = "I-BW452GLLEP1G"
const PAYPAL_PLAN_ID = "P-5ML4271244454362WXNWU5NQ"

const stripeConfig: StripePublicationPaymentCanaryConfig = {
  provider: "stripe_us",
  secretKey: `sk_live_${"a".repeat(32)}`,
  recurringPriceId: `price_${"b".repeat(24)}`,
  requestTimeoutMs: 5_000,
}

const paypalConfig: PayPalPublicationPaymentCanaryConfig = {
  provider: "paypal",
  clientId: `paypal_client_${"c".repeat(32)}`,
  clientSecret: `paypal_secret_${"d".repeat(32)}`,
  recurringPlanId: PAYPAL_PLAN_ID,
  requestTimeoutMs: 5_000,
}

interface FetchCall {
  url: string
  init?: RequestInit
}

type FetchStep =
  Response | ((url: string, init?: RequestInit) => Response | Promise<Response>)

function jsonResponse(
  body: unknown,
  status: number,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

function queuedFetch(steps: FetchStep[], calls: FetchCall[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const step = steps.shift()
    if (!step) throw new Error("Unexpected provider request")
    return typeof step === "function" ? step(url, init) : step
  }) as typeof fetch
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function expectedReturnUrlDigest(provider: "stripe" | "paypal"): string {
  const returnUrls =
    provider === "stripe"
      ? {
          cancel_url: "https://alice.creatorshare.com/payments/failed",
          success_url: "https://alice.creatorshare.com/payments/success",
        }
      : {
          cancel_url:
            "https://alice.creatorshare.com/payments/failed?provider=paypal",
          success_url:
            "https://alice.creatorshare.com/payments/success?provider=paypal",
        }
  return sha256(JSON.stringify(returnUrls))
}

function stripeSession(
  status: "open" | "expired",
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: STRIPE_SESSION_ID,
    object: "checkout.session",
    livemode: true,
    mode: "subscription",
    status,
    payment_status: "unpaid",
    subscription: null,
    created: STRIPE_PROVIDER_CREATED,
    url:
      status === "open"
        ? "https://checkout.stripe.com/c/pay/session_secret_must_not_escape"
        : null,
    ...overrides,
  }
}

function paypalTokenResponse(
  accessToken = `access_token_${"t".repeat(32)}`,
): Response {
  return jsonResponse(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 31_668,
    },
    200,
    { "PayPal-Debug-Id": "oauth_request_123" },
  )
}

function paypalSubscription(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: PAYPAL_SUBSCRIPTION_ID,
    status: "APPROVAL_PENDING",
    plan_id: PAYPAL_PLAN_ID,
    custom_id: CANARY_ATTEMPT_ID,
    plan_overridden: false,
    create_time: PROVIDER_CREATED_AT,
    links: [
      {
        href:
          "https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-2M539689T3856352J",
        rel: "approve",
        method: "GET",
      },
      {
        href: `https://api-m.paypal.com/v1/billing/subscriptions/${PAYPAL_SUBSCRIPTION_ID}`,
        rel: "self",
        method: "GET",
      },
    ],
    ...overrides,
  }
}

test.describe("publication payment canaries", () => {
  test("creates and immediately expires an unexposed live Stripe subscription Session", async () => {
    const calls: FetchCall[] = []
    const evidence = await runStripePublicationPaymentCanary(
      stripeConfig,
      {
        advocateHostname: ADVOCATE_HOSTNAME,
        canaryAttemptId: CANARY_ATTEMPT_ID,
      },
      {
        fetchImplementation: queuedFetch(
          [
            jsonResponse(stripeSession("open"), 200, {
              "Request-Id": "req_create_123",
            }),
            jsonResponse(stripeSession("expired"), 200, {
              "Request-Id": "req_expire_123",
            }),
          ],
          calls,
        ),
        now: () => VERIFIED_AT,
      },
    )

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe("https://api.stripe.com/v1/checkout/sessions")
    expect(calls[1].url).toBe(
      `https://api.stripe.com/v1/checkout/sessions/${STRIPE_SESSION_ID}/expire`,
    )
    expect(calls.map((call) => call.init?.method)).toEqual(["POST", "POST"])

    const createHeaders = new Headers(calls[0].init?.headers)
    const cleanupHeaders = new Headers(calls[1].init?.headers)
    expect(createHeaders.get("Authorization")).toBe(
      `Bearer ${stripeConfig.secretKey}`,
    )
    expect(createHeaders.get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    )
    expect(createHeaders.get("Stripe-Version")).toBe("2025-02-24.acacia")
    expect(cleanupHeaders.get("Stripe-Version")).toBe("2025-02-24.acacia")
    expect(createHeaders.get("Idempotency-Key")).not.toBe(
      cleanupHeaders.get("Idempotency-Key"),
    )

    const createBody = new URLSearchParams(String(calls[0].init?.body))
    expect([...createBody.keys()].sort()).toEqual([
      "cancel_url",
      "line_items[0][price]",
      "line_items[0][quantity]",
      "mode",
      "success_url",
    ])
    expect(Object.fromEntries(createBody)).toEqual({
      mode: "subscription",
      "line_items[0][price]": stripeConfig.recurringPriceId,
      "line_items[0][quantity]": "1",
      success_url: "https://alice.creatorshare.com/payments/success",
      cancel_url: "https://alice.creatorshare.com/payments/failed",
    })

    expect(evidence).toMatchObject({
      schema_version: 1,
      provider: "stripe_us",
      provider_resource_id: STRIPE_SESSION_ID,
      provider_status: "checkout_session_expired_unpaid",
      create_provider_status: "open",
      provider_created_at: PROVIDER_CREATED_AT,
      provider_return_urls_sha256: expectedReturnUrlDigest("stripe"),
      create_http_status: 200,
      cleanup_http_status: 200,
      cleanup_performed: true,
      financial_charge_attempted: false,
      provider_capture_attempted: false,
      sponsorship_state_created: false,
      webhook_delivery_verified: false,
      provider_create_request_id: "req_create_123",
      provider_cleanup_request_id: "req_expire_123",
      verified: true,
      verified_at: VERIFIED_AT.toISOString(),
    })
    expect(evidence.outbound_request_id_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(evidence.cleanup_request_id_sha256).toMatch(/^[0-9a-f]{64}$/)

    const serialized = JSON.stringify(evidence)
    expect(serialized).not.toContain("checkout.stripe.com")
    expect(serialized).not.toContain("session_secret_must_not_escape")
    expect(serialized).not.toContain(stripeConfig.secretKey)
    expect(serialized).not.toContain(stripeConfig.recurringPriceId)
    expect(serialized).not.toContain("payments/success")
  })

  test("uses deterministic phase-specific Stripe keys after an unknown expire result", async () => {
    const calls: FetchCall[] = []
    const fetchImplementation = queuedFetch(
      [
        jsonResponse(stripeSession("open"), 200),
        () => {
          throw new Error("socket closed after Stripe accepted expiration")
        },
        jsonResponse(stripeSession("expired"), 200),
      ],
      calls,
    )
    const input = {
      advocateHostname: ADVOCATE_HOSTNAME,
      canaryAttemptId: CANARY_ATTEMPT_ID,
    }

    await expect(
      runStripePublicationPaymentCanary(stripeConfig, input, {
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "stripe_us_publication_canary_network_error",
      retryable: true,
      evidence: {},
    })
    const replayEvidence = await runStripePublicationPaymentCanary(
      stripeConfig,
      input,
      { fetchImplementation },
    )
    expect(replayEvidence).toMatchObject({
      provider_status: "checkout_session_expired_unpaid",
      create_provider_status: "expired",
      cleanup_http_status: null,
      cleanup_performed: false,
    })

    const requestKeys = calls.map((call) =>
      new Headers(call.init?.headers).get("Idempotency-Key"),
    )
    expect(calls).toHaveLength(3)
    expect(requestKeys[0]).toBe(requestKeys[2])
    expect(requestKeys[0]).not.toBe(requestKeys[1])
    expect(replayEvidence.cleanup_request_id_sha256).toBe(
      sha256(String(requestKeys[1])),
    )
  })

  test("retries a lost Stripe create response with the same idempotency key", async () => {
    const calls: FetchCall[] = []
    const fetchImplementation = queuedFetch(
      [
        () => {
          throw new Error("secret provider transport details")
        },
        jsonResponse(stripeSession("open"), 200),
        jsonResponse(stripeSession("expired"), 200),
      ],
      calls,
    )
    const input = {
      advocateHostname: ADVOCATE_HOSTNAME,
      canaryAttemptId: CANARY_ATTEMPT_ID,
    }

    let thrown: unknown
    try {
      await runStripePublicationPaymentCanary(stripeConfig, input, {
        fetchImplementation,
      })
    } catch (error) {
      thrown = error
    }
    await runStripePublicationPaymentCanary(stripeConfig, input, {
      fetchImplementation,
    })

    expect(new Headers(calls[0].init?.headers).get("Idempotency-Key")).toBe(
      new Headers(calls[1].init?.headers).get("Idempotency-Key"),
    )
    expect(String(thrown)).not.toContain("provider transport")
    expect(JSON.stringify(thrown)).not.toContain(stripeConfig.secretKey)
  })

  test("rejects a Stripe Session that is not live, open, unpaid, and subscription-free", async () => {
    for (const invalid of [
      stripeSession("open", { livemode: false }),
      stripeSession("open", { payment_status: "paid" }),
      stripeSession("open", { subscription: "sub_completed" }),
      stripeSession("open", { status: "complete" }),
    ]) {
      await expect(
        runStripePublicationPaymentCanary(
          stripeConfig,
          {
            advocateHostname: ADVOCATE_HOSTNAME,
            canaryAttemptId: CANARY_ATTEMPT_ID,
          },
          {
            fetchImplementation: queuedFetch([jsonResponse(invalid, 200)], []),
          },
        ),
      ).rejects.toMatchObject({
        code: "stripe_us_publication_canary_invalid_response",
      })
    }
  })

  test("bounds Stripe response bytes and never propagates a rejected body", async () => {
    const responseSecret = "raw_provider_body_must_not_escape"
    let thrown: unknown
    try {
      await runStripePublicationPaymentCanary(
        stripeConfig,
        {
          advocateHostname: ADVOCATE_HOSTNAME,
          canaryAttemptId: CANARY_ATTEMPT_ID,
        },
        {
          fetchImplementation: queuedFetch(
            [
              jsonResponse({ error: { message: responseSecret } }, 401, {
                "Content-Length": "64001",
              }),
            ],
            [],
          ),
        },
      )
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      code: "stripe_us_publication_canary_rejected",
      retryable: false,
      evidence: { http_status: 401 },
    })
    expect(String(thrown)).not.toContain(responseSecret)
    expect(JSON.stringify(thrown)).not.toContain(responseSecret)
  })

  test("rejects malformed and oversized successful provider responses", async () => {
    const malformed = new Response("{", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
    const oversized = jsonResponse(stripeSession("open"), 200, {
      "Content-Length": "64001",
    })

    for (const response of [malformed, oversized]) {
      await expect(
        runStripePublicationPaymentCanary(
          stripeConfig,
          {
            advocateHostname: ADVOCATE_HOSTNAME,
            canaryAttemptId: CANARY_ATTEMPT_ID,
          },
          { fetchImplementation: queuedFetch([response], []) },
        ),
      ).rejects.toMatchObject({
        code: "stripe_us_publication_canary_invalid_response",
        retryable: true,
        evidence: { http_status: 200 },
      })
    }
  })

  test("applies a hard timeout to every provider request", async () => {
    const timeoutConfig = { ...stripeConfig, requestTimeoutMs: 5 }
    const fetchImplementation = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          {
            once: true,
          },
        )
      })
      throw new Error("unreachable")
    }) as typeof fetch

    await expect(
      runStripePublicationPaymentCanary(
        timeoutConfig,
        {
          advocateHostname: ADVOCATE_HOSTNAME,
          canaryAttemptId: CANARY_ATTEMPT_ID,
        },
        { fetchImplementation },
      ),
    ).rejects.toMatchObject({
      code: "stripe_us_publication_canary_network_error",
      retryable: true,
    })
  })

  test("creates one unapproved PayPal Subscription with the branded return URLs", async () => {
    const calls: FetchCall[] = []
    const accessToken = `access_token_${"z".repeat(32)}`
    const evidence = await runPayPalPublicationPaymentCanary(
      paypalConfig,
      {
        advocateHostname: ADVOCATE_HOSTNAME,
        canaryAttemptId: CANARY_ATTEMPT_ID,
      },
      {
        fetchImplementation: queuedFetch(
          [
            paypalTokenResponse(accessToken),
            jsonResponse(paypalSubscription(), 201, {
              "PayPal-Debug-Id": "subscription_request_123",
            }),
          ],
          calls,
        ),
        now: () => VERIFIED_AT,
      },
    )

    expect(calls).toHaveLength(2)
    expect(calls[0].url).toBe("https://api-m.paypal.com/v1/oauth2/token")
    expect(calls[1].url).toBe(
      "https://api-m.paypal.com/v1/billing/subscriptions",
    )
    expect(calls[0].init?.body).toBe("grant_type=client_credentials")
    expect(new Headers(calls[1].init?.headers).get("Authorization")).toBe(
      `Bearer ${accessToken}`,
    )
    expect(new Headers(calls[1].init?.headers).get("PayPal-Request-Id")).toBe(
      CANARY_ATTEMPT_ID,
    )
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      plan_id: PAYPAL_PLAN_ID,
      custom_id: CANARY_ATTEMPT_ID,
      application_context: {
        brand_name: "Creator Share",
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        return_url:
          "https://alice.creatorshare.com/payments/success?provider=paypal",
        cancel_url:
          "https://alice.creatorshare.com/payments/failed?provider=paypal",
      },
    })

    expect(evidence).toMatchObject({
      schema_version: 1,
      provider: "paypal",
      provider_resource_id: PAYPAL_SUBSCRIPTION_ID,
      provider_status: "subscription_approval_pending",
      provider_created_at: PROVIDER_CREATED_AT,
      provider_return_urls_sha256: expectedReturnUrlDigest("paypal"),
      create_http_status: 201,
      financial_charge_attempted: false,
      provider_capture_attempted: false,
      sponsorship_state_created: false,
      webhook_delivery_verified: false,
      provider_credential_request_id: "oauth_request_123",
      provider_create_request_id: "subscription_request_123",
      verified: true,
      verified_at: VERIFIED_AT.toISOString(),
    })
    const serialized = JSON.stringify(evidence)
    expect(serialized).not.toContain("paypal.com/webapps/billing")
    expect(serialized).not.toContain("BA-2M539689T3856352J")
    expect(serialized).not.toContain(accessToken)
    expect(serialized).not.toContain(paypalConfig.clientSecret)
    expect(serialized).not.toContain(paypalConfig.clientId)
  })

  test("replays a lost PayPal Subscription response with the same request ID", async () => {
    const calls: FetchCall[] = []
    const fetchImplementation = queuedFetch(
      [
        paypalTokenResponse(),
        () => {
          throw new Error("subscription response was lost")
        },
        paypalTokenResponse(),
        jsonResponse(paypalSubscription(), 200),
      ],
      calls,
    )
    const input = {
      advocateHostname: ADVOCATE_HOSTNAME,
      canaryAttemptId: CANARY_ATTEMPT_ID,
    }

    await expect(
      runPayPalPublicationPaymentCanary(paypalConfig, input, {
        fetchImplementation,
      }),
    ).rejects.toMatchObject({
      code: "paypal_publication_canary_network_error",
      retryable: true,
    })
    await expect(
      runPayPalPublicationPaymentCanary(paypalConfig, input, {
        fetchImplementation,
      }),
    ).resolves.toMatchObject({
      provider_resource_id: PAYPAL_SUBSCRIPTION_ID,
      create_http_status: 200,
    })

    expect(new Headers(calls[1].init?.headers).get("PayPal-Request-Id")).toBe(
      new Headers(calls[3].init?.headers).get("PayPal-Request-Id"),
    )
  })

  test("rejects PayPal Subscriptions without a safe approval-pending state", async () => {
    for (const invalid of [
      paypalSubscription({ links: [] }),
      paypalSubscription({ status: "ACTIVE" }),
      paypalSubscription({ subscriber: { email_address: "somebody@example.com" } }),
      paypalSubscription({ billing_info: { next_billing_time: "2026-08-18" } }),
      paypalSubscription({ custom_id: "another-attempt" }),
    ]) {
      await expect(
        runPayPalPublicationPaymentCanary(
          paypalConfig,
          {
            advocateHostname: ADVOCATE_HOSTNAME,
            canaryAttemptId: CANARY_ATTEMPT_ID,
          },
          {
            fetchImplementation: queuedFetch(
              [paypalTokenResponse(), jsonResponse(invalid, 201)],
              [],
            ),
          },
        ),
      ).rejects.toMatchObject({
        code: "paypal_publication_canary_invalid_response",
      })
    }
  })

  test("rejects primary, reserved, mixed-case, and local hostnames", async () => {
    for (const advocateHostname of [
      "creatorshare.com",
      "api.creatorshare.com",
      "Alice.creatorshare.com",
      "alice.localhost",
    ]) {
      await expect(
        runStripePublicationPaymentCanary(
          stripeConfig,
          { advocateHostname, canaryAttemptId: CANARY_ATTEMPT_ID },
          {
            fetchImplementation: (() => {
              throw new Error("Provider must not be called")
            }) as typeof fetch,
          },
        ),
      ).rejects.toMatchObject({
        code: "stripe_us_publication_canary_invalid_input",
        retryable: false,
      })
    }
  })
})

test.describe("publication payment canary configuration", () => {
  const stripeEnvironment = {
    STRIPE_SECRET_KEY_US: `sk_live_${"a".repeat(32)}`,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: `pk_live_${"b".repeat(32)}`,
    STRIPE_WEBHOOK_SECRET_US: `whsec_${"c".repeat(32)}`,
  }

  test("does not require a canary Price for routine payment readiness", () => {
    expect(
      loadStripePaymentPathConfig("stripe_us", stripeEnvironment),
    ).toMatchObject({
      provider: "stripe_us",
      secretKey: stripeEnvironment.STRIPE_SECRET_KEY_US,
    })
    expect(() =>
      loadPublicationPaymentCanaryConfig("stripe_us", stripeEnvironment),
    ).toThrow("worker_configuration_invalid")
  })

  test("loads an existing recurring Price only for publication", () => {
    const recurringPriceId = `price_${"p".repeat(24)}`
    expect(
      loadPublicationPaymentCanaryConfig("stripe_us", {
        ...stripeEnvironment,
        ADVOCATE_STRIPE_CANARY_RECURRING_PRICE_ID_US: recurringPriceId,
      }),
    ).toEqual({
      provider: "stripe_us",
      secretKey: stripeEnvironment.STRIPE_SECRET_KEY_US,
      recurringPriceId,
      requestTimeoutMs: 15_000,
    })
  })

  test("requires an existing recurring PayPal Plan only for publication", () => {
    const paypalEnvironment = {
      NEXT_PUBLIC_PAYPAL_CLIENT_ID: `paypal_client_${"c".repeat(32)}`,
      PAYPAL_CLIENT_ID: `paypal_client_${"c".repeat(32)}`,
      PAYPAL_CLIENT_SECRET: `paypal_secret_${"d".repeat(32)}`,
      PAYPAL_WEBHOOK_ID: `paypal_webhook_${"e".repeat(16)}`,
    }
    expect(() =>
      loadPublicationPaymentCanaryConfig("paypal", paypalEnvironment),
    ).toThrow("worker_configuration_invalid")
    expect(
      loadPublicationPaymentCanaryConfig("paypal", {
        ...paypalEnvironment,
        ADVOCATE_PAYPAL_CANARY_RECURRING_PLAN_ID: PAYPAL_PLAN_ID,
      }),
    ).toEqual({
      provider: "paypal",
      clientId: paypalEnvironment.NEXT_PUBLIC_PAYPAL_CLIENT_ID,
      clientSecret: paypalEnvironment.PAYPAL_CLIENT_SECRET,
      recurringPlanId: PAYPAL_PLAN_ID,
      requestTimeoutMs: 15_000,
    })
  })

  test("shares exact ordinary provider return URL construction", () => {
    expect(stripeCheckoutReturnUrls("https://alice.creatorshare.com")).toEqual({
      successUrl: "https://alice.creatorshare.com/payments/success",
      cancelUrl: "https://alice.creatorshare.com/payments/failed",
    })
    expect(paypalCheckoutReturnUrls("https://alice.creatorshare.com")).toEqual({
      successUrl:
        "https://alice.creatorshare.com/payments/success?provider=paypal",
      cancelUrl:
        "https://alice.creatorshare.com/payments/failed?provider=paypal",
    })
  })
})
