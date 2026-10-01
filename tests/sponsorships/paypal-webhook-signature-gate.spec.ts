import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * The PayPal webhook authentication gate.
 *
 * The Stripe route gained this coverage first. PayPal never did: a
 * reachability probe that appended a throwing statement to
 * src/app/api/paypal/webhook/route.ts and ran the complete offline lane
 * confirmed no test loads that file. Existing PayPal coverage exercises the
 * ingestion library, which starts from an already-verified event, so the
 * route's own boundary was untested on the provider that shares the money path
 * with Stripe.
 *
 * These tests drive the real exported POST handler and keep the real webhook
 * library, so genuine header parsing and the genuine verification verdict
 * decide the outcome. Only the runtime dependency factory is replaced, and
 * every effectful dependency records that it was reached and then throws. That
 * is what makes "before any effect" an assertion rather than an assumption.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const API_URL = "https://api-m.sandbox.paypal.com"
const WEBHOOK_ID = "WH8SANDBOXWEBHOOKID0001"
const originalPayPalWebhookId = process.env.PAYPAL_WEBHOOK_ID
const originalCryptoSecret = process.env.SPONSORSHIP_CRYPTO_SECRET_V1

let effectReached = false
let verificationCalled = false
let payPalEnabled = true
/** The verification response the stubbed PayPal API returns. */
let verificationResponse = {
  ok: true,
  status: 200,
  body: JSON.stringify({ verification_status: "SUCCESS" }),
}

process.env.PAYPAL_WEBHOOK_ID = WEBHOOK_ID
process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = Buffer.alloc(32, 47).toString(
  "base64",
)

/** Any effectful dependency reaching the database is the failure under test. */
function effectful(name: string) {
  return async () => {
    effectReached = true
    throw new Error(`${name}_must_not_run_before_verification`)
  }
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
  if (request === "@/lib/paypal/client") {
    return { isPayPalEnabled: () => payPalEnabled }
  }
  if (request === "@/lib/sponsorships/gateways/paypalWebhookRuntime") {
    return {
      getConfiguredPayPalApiUrl: () => API_URL,
      createPayPalWebhookDependencies: () => ({
        // The real cryptography, so ingestion genuinely runs rather than
        // failing on a stub before it can reach a recorded dependency.
        crypto: sponsorshipCrypto(),
        async verifyWebhookSignature() {
          verificationCalled = true
          return verificationResponse
        },
        retrieveOrder: effectful("retrieveOrder"),
        retrieveSubscription: effectful("retrieveSubscription"),
        loadPaymentBoundary: effectful("loadPaymentBoundary"),
        loadOriginalMovement: effectful("loadOriginalMovement"),
        ingestVerifiedEvent: effectful("ingestVerifiedEvent"),
        quarantineVerifiedEvent: effectful("quarantineVerifiedEvent"),
        ingestVerifiedAdjustment: effectful("ingestVerifiedAdjustment"),
        ingestVerifiedNoEffect: effectful("ingestVerifiedNoEffect"),
        now: () => new Date(),
      }),
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/paypal-webhook-signature-gate.spec.ts",
  ),
)
const moduleCacheBeforeRouteImport = new Set(Object.keys(testRequire.cache))
const route = testRequire(
  "../../src/app/api/paypal/webhook/route",
) as typeof import("../../src/app/api/paypal/webhook/route")
nodeModule._load = originalModuleLoad
for (const modulePath of Object.keys(testRequire.cache)) {
  if (
    !moduleCacheBeforeRouteImport.has(modulePath) &&
    modulePath.startsWith(resolve(process.cwd(), "src"))
  ) {
    delete testRequire.cache[modulePath]
  }
}

let cachedCrypto: unknown = null
function sponsorshipCrypto() {
  if (cachedCrypto === null) {
    const cryptoModule = testRequire(
      "../../src/lib/sponsorships/crypto",
    ) as typeof import("../../src/lib/sponsorships/crypto")
    cachedCrypto = cryptoModule.createSponsorshipCryptoFromEnvironment()
  }
  return cachedCrypto as ReturnType<
    typeof import("../../src/lib/sponsorships/crypto").createSponsorshipCryptoFromEnvironment
  >
}

const PAYLOAD = JSON.stringify({
  id: "WH-1AB23456CD789012E-3FG45678HI901234J",
  event_type: "PAYMENT.CAPTURE.COMPLETED",
  create_time: "2026-07-25T00:00:00Z",
  resource_type: "capture",
  resource: { id: "9XY12345AB678901C" },
})

function signedHeaders(overrides: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "paypal-transmission-id": "1a2b3c4d-5e6f-7081-92a3-b4c5d6e7f809",
    "paypal-transmission-time": "2026-07-25T00:00:00Z",
    "paypal-transmission-sig": "c2lnbmF0dXJlLXZhbHVl",
    "paypal-cert-url": `${API_URL}/v1/notifications/certs/CERT-360caa42`,
    "paypal-auth-algo": "SHA256withRSA",
    ...overrides,
  }
}

function webhookRequest(headers: Record<string, string>): Request {
  return new Request("https://creatorshare.com/api/paypal/webhook", {
    method: "POST",
    headers,
    body: PAYLOAD,
  })
}

test.beforeEach(() => {
  effectReached = false
  verificationCalled = false
  payPalEnabled = true
  verificationResponse = {
    ok: true,
    status: 200,
    body: JSON.stringify({ verification_status: "SUCCESS" }),
  }
})

test.afterAll(() => {
  if (originalPayPalWebhookId === undefined) {
    delete process.env.PAYPAL_WEBHOOK_ID
  } else {
    process.env.PAYPAL_WEBHOOK_ID = originalPayPalWebhookId
  }
  if (originalCryptoSecret === undefined) {
    delete process.env.SPONSORSHIP_CRYPTO_SECRET_V1
  } else {
    process.env.SPONSORSHIP_CRYPTO_SECRET_V1 = originalCryptoSecret
  }
})

test.describe("PayPal webhook signature gate", () => {
  test("rejects a request carrying no PayPal headers before any effect", async () => {
    const response = await route.POST(
      webhookRequest({ "content-type": "application/json" }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid webhook request" })
    // Not even the provider is contacted: a request without headers cannot be
    // turned into a verification call.
    expect(verificationCalled).toBe(false)
    expect(effectReached).toBe(false)
  })

  test("rejects a certificate URL outside PayPal before any effect", async () => {
    // The certificate URL is attacker-supplied. Accepting an arbitrary host
    // would let a forged notification nominate the key used to validate it.
    const response = await route.POST(
      webhookRequest(
        signedHeaders({
          "paypal-cert-url": "https://attacker.example/certs/CERT-360caa42",
        }),
      ),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid webhook request" })
    expect(verificationCalled).toBe(false)
    expect(effectReached).toBe(false)
  })

  test("rejects a verdict that is not a successful verification before any effect", async () => {
    verificationResponse = {
      ok: true,
      status: 200,
      body: JSON.stringify({ verification_status: "FAILURE" }),
    }

    const response = await route.POST(webhookRequest(signedHeaders()))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Invalid webhook signature",
    })
    expect(verificationCalled).toBe(true)
    expect(effectReached).toBe(false)
  })

  test("fails closed when the provider cannot answer the verification", async () => {
    // The body deliberately says SUCCESS. Only the failed HTTP status stands
    // between this response and ingestion, so the test isolates that guard
    // rather than passing because the payload was malformed anyway.
    verificationResponse = {
      ok: false,
      status: 500,
      body: JSON.stringify({ verification_status: "SUCCESS" }),
    }

    const response = await route.POST(webhookRequest(signedHeaders()))

    // An unanswerable verification must never be treated as a pass.
    expect(response.status).toBe(503)
    expect(effectReached).toBe(false)
  })

  test("rejects a malformed event body before contacting the provider", async () => {
    const response = await route.POST(
      new Request("https://creatorshare.com/api/paypal/webhook", {
        method: "POST",
        headers: signedHeaders(),
        body: "{not json",
      }),
    )

    expect(response.status).toBe(400)
    expect(verificationCalled).toBe(false)
    expect(effectReached).toBe(false)
  })

  test("refuses every request when PayPal is not enabled", async () => {
    payPalEnabled = false

    const response = await route.POST(webhookRequest(signedHeaders()))

    expect(response.status).toBe(501)
    expect(verificationCalled).toBe(false)
    expect(effectReached).toBe(false)
  })

  test("a genuinely verified event does reach ingestion", async () => {
    // Establishes that the refusals above are refusals, not an unrelated early
    // exit that would make every negative test pass for the wrong reason.
    const response = await route.POST(webhookRequest(signedHeaders()))

    expect(verificationCalled).toBe(true)
    expect(effectReached).toBe(true)
    expect(response.status).toBe(503)
  })
})
