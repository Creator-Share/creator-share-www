import { createHmac } from "node:crypto"
import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

/**
 * The Stripe webhook authentication gate.
 *
 * Existing webhook coverage exercises the ingestion library directly, so it
 * starts from an already-verified event. Nothing asserted the route's own
 * authentication boundary: that an unsigned or wrongly signed request is
 * rejected before any effect. That is the property an attacker attacks, and it
 * lived in handler.ts with no test.
 *
 * These tests drive the real handler with the real Stripe SDK, so a genuine
 * signature computation decides the outcome rather than a stub. The service
 * role client is replaced with a proxy that fails the test if the handler
 * reaches for the database on a rejected request, which is what makes "before
 * any effect" an assertion instead of an assumption.
 */

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const US_SECRET = "whsec_us_signature_gate_secret_value"
const UK_SECRET = "whsec_uk_signature_gate_secret_value"

let databaseReachedFor = false

const previousEnvironment = new Map<string, string | undefined>()
function setEnvironment(name: string, value: string): void {
  if (!previousEnvironment.has(name)) {
    previousEnvironment.set(name, process.env[name])
  }
  process.env[name] = value
}

setEnvironment("STRIPE_SECRET_KEY_US", "sk_test_signature_gate_us")
setEnvironment("STRIPE_SECRET_KEY_UK", "sk_test_signature_gate_uk")
setEnvironment("STRIPE_WEBHOOK_SECRET_US", US_SECRET)
setEnvironment("STRIPE_WEBHOOK_SECRET_UK", UK_SECRET)
setEnvironment("STRIPE_DEFAULT_REGION", "us")
setEnvironment("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US", "pk_test_gate_us")
setEnvironment("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_UK", "pk_test_gate_uk")

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/utils/supabase/server") {
    return {
      createServiceRoleClient() {
        // Reaching the database on a rejected request is the failure this
        // suite exists to catch, so record it rather than returning a stub
        // that would let the request quietly continue.
        databaseReachedFor = true
        throw new Error("database_must_not_be_reached_before_verification")
      },
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}

const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/stripe-webhook-signature-gate.spec.ts",
  ),
)
const moduleCacheBeforeHandlerImport = new Set(Object.keys(testRequire.cache))
const { handleStripeWebhook } = testRequire(
  "../../src/app/api/webhooks/stripe/handler",
) as typeof import("../../src/app/api/webhooks/stripe/handler")
nodeModule._load = originalModuleLoad
for (const modulePath of Object.keys(testRequire.cache)) {
  if (
    !moduleCacheBeforeHandlerImport.has(modulePath) &&
    modulePath.startsWith(resolve(process.cwd(), "src"))
  ) {
    delete testRequire.cache[modulePath]
  }
}

const PAYLOAD = JSON.stringify({
  id: "evt_signature_gate",
  object: "event",
  type: "checkout.session.completed",
  data: { object: { id: "cs_test_signature_gate" } },
})

function signedHeader(payload: string, secret: string, timestamp: number) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex")
  return `t=${timestamp},v1=${signature}`
}

function webhookRequest(headers: Record<string, string>): Request {
  return new Request("https://creatorshare.com/api/webhooks/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: PAYLOAD,
  })
}

test.beforeEach(() => {
  databaseReachedFor = false
})

test.afterAll(() => {
  for (const [name, value] of previousEnvironment) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test.describe("Stripe webhook signature gate", () => {
  test("rejects a request with no signature header before any effect", async () => {
    const response = await handleStripeWebhook(webhookRequest({}))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Missing webhook signature",
    })
    expect(databaseReachedFor).toBe(false)
  })

  test("rejects a signature computed with the wrong secret before any effect", async () => {
    const response = await handleStripeWebhook(
      webhookRequest({
        "stripe-signature": signedHeader(
          PAYLOAD,
          "whsec_an_attacker_controlled_secret",
          Math.floor(Date.now() / 1000),
        ),
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Invalid webhook signature",
    })
    expect(databaseReachedFor).toBe(false)
  })

  test("rejects a correct signature over a different payload", async () => {
    // Signing something else with a real secret must not authenticate this
    // body. This is the tamper case: valid credentials, wrong content.
    const response = await handleStripeWebhook(
      webhookRequest({
        "stripe-signature": signedHeader(
          JSON.stringify({ id: "evt_other", object: "event" }),
          US_SECRET,
          Math.floor(Date.now() / 1000),
        ),
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Invalid webhook signature",
    })
    expect(databaseReachedFor).toBe(false)
  })

  test("rejects a replayed signature outside the tolerance window", async () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 60 * 60 * 24
    const response = await handleStripeWebhook(
      webhookRequest({
        "stripe-signature": signedHeader(PAYLOAD, US_SECRET, staleTimestamp),
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Invalid webhook signature",
    })
    expect(databaseReachedFor).toBe(false)
  })

  test("rejects an oversized signature header without parsing it", async () => {
    const response = await handleStripeWebhook(
      webhookRequest({
        "stripe-signature": "t=1,v1=".concat("a".repeat(4096)),
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Missing webhook signature",
    })
    expect(databaseReachedFor).toBe(false)
  })
})
