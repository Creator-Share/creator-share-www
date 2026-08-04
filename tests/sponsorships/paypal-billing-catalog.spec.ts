import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type BillingCatalogModule = typeof import("../../src/lib/paypal/billingCatalog")
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
  resolve(process.cwd(), "tests/sponsorships/paypal-billing-catalog.spec.ts"),
)
const billingCatalogModule = testRequire(
  "../../src/lib/paypal/billingCatalog",
) as BillingCatalogModule
nodeModule._load = originalModuleLoad

const {
  PayPalBillingCatalogError,
  buildPayPalBillingPlanRequest,
  buildPayPalBillingProductRequest,
  createPayPalBillingPlan,
  createPayPalBillingProduct,
  verifyPayPalBillingPlan,
} = billingCatalogModule

const PRODUCT_REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const PLAN_REQUEST_ID = "22222222-2222-4222-8222-222222222222"
const PRODUCT_ID = "PROD-ABCDEFGHIJKLMNOPQ"
const PLAN_ID = "P-ABCDEFGHIJKLMNOPQRSTUVWX"

function terms(overrides: Record<string, unknown> = {}) {
  return {
    productName: "Monthly Sponsorship for Amina",
    recurrenceInterval: "month" as const,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP" as const,
    ...overrides,
  }
}

function productRepresentation() {
  return {
    id: PRODUCT_ID,
    name: "Monthly Sponsorship for Amina",
    description: "Monthly Sponsorship for Amina",
    type: "SERVICE",
    category: "CHARITY",
  }
}

function planRepresentation() {
  return {
    id: PLAN_ID,
    product_id: PRODUCT_ID,
    name: "Monthly Sponsorship for Amina",
    description: "Monthly Sponsorship for Amina",
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: { value: "24.66", currency_code: "GBP" },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      payment_failure_threshold: 3,
    },
  }
}

test.describe("PayPal billing catalog provider boundary", () => {
  test("builds exact product and recurring plan terms", () => {
    expect(buildPayPalBillingProductRequest(terms())).toEqual({
      name: "Monthly Sponsorship for Amina",
      description: "Monthly Sponsorship for Amina",
      type: "SERVICE",
      category: "CHARITY",
    })
    expect(buildPayPalBillingPlanRequest(PRODUCT_ID, terms())).toEqual({
      product_id: PRODUCT_ID,
      name: "Monthly Sponsorship for Amina",
      description: "Monthly Sponsorship for Amina",
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: "24.66", currency_code: "GBP" },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
    })
  })

  test("creates a product with the durable UUID idempotency key", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const product = await createPayPalBillingProduct(
      PRODUCT_REQUEST_ID,
      terms(),
      async (path, init) => {
        calls.push({ path, init })
        return Response.json(productRepresentation())
      },
    )

    expect(product).toEqual({ productId: PRODUCT_ID })
    expect(calls).toHaveLength(1)
    expect(calls[0].path).toBe("/v1/catalogs/products")
    expect(new Headers(calls[0].init?.headers).get("PayPal-Request-Id")).toBe(
      PRODUCT_REQUEST_ID,
    )
    expect(new Headers(calls[0].init?.headers).get("Prefer")).toBe(
      "return=representation",
    )
  })

  test("creates and verifies only the exact active billing plan", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = []
    const fetcher = async (path: string, init?: RequestInit) => {
      calls.push({ path, init })
      return Response.json(planRepresentation())
    }
    await expect(
      createPayPalBillingPlan(PLAN_REQUEST_ID, PRODUCT_ID, terms(), fetcher),
    ).resolves.toEqual({ productId: PRODUCT_ID, planId: PLAN_ID })
    await expect(
      verifyPayPalBillingPlan(PLAN_ID, PRODUCT_ID, terms(), fetcher),
    ).resolves.toEqual({ productId: PRODUCT_ID, planId: PLAN_ID })

    expect(calls[0].path).toBe("/v1/billing/plans")
    expect(new Headers(calls[0].init?.headers).get("PayPal-Request-Id")).toBe(
      PLAN_REQUEST_ID,
    )
    expect(calls[1].path).toBe(`/v1/billing/plans/${PLAN_ID}`)
  })

  test("fails closed on invalid input, plan drift, and provider rejection", async () => {
    expect(() =>
      buildPayPalBillingPlanRequest(
        PRODUCT_ID,
        terms({ chargedCurrency: "CAD" }),
      ),
    ).toThrow(PayPalBillingCatalogError)
    expect(() =>
      buildPayPalBillingPlanRequest(
        PRODUCT_ID,
        terms({ chargedAmountMinor: 24.66 }),
      ),
    ).toThrow(PayPalBillingCatalogError)

    const drifted = planRepresentation()
    drifted.billing_cycles[0].pricing_scheme.fixed_price.value = "24.67"
    await expect(
      verifyPayPalBillingPlan(PLAN_ID, PRODUCT_ID, terms(), async () =>
        Response.json(drifted),
      ),
    ).rejects.toMatchObject({ code: "invalid-provider-response" })

    await expect(
      createPayPalBillingProduct(PRODUCT_REQUEST_ID, terms(), async () =>
        Response.json(
          { message: "sponsor@example.com was rejected" },
          { status: 422 },
        ),
      ),
    ).rejects.toMatchObject({
      code: "provider-rejected",
      message: "PayPal billing catalog operation failed",
    })
  })

  test("rejects oversized and malformed provider responses", async () => {
    await expect(
      createPayPalBillingProduct(
        PRODUCT_REQUEST_ID,
        terms(),
        async () => new Response("x".repeat(256 * 1024 + 1)),
      ),
    ).rejects.toMatchObject({ code: "invalid-provider-response" })
    await expect(
      createPayPalBillingProduct(
        PRODUCT_REQUEST_ID,
        terms(),
        async () => new Response("not json"),
      ),
    ).rejects.toMatchObject({ code: "invalid-provider-response" })
    await expect(
      createPayPalBillingProduct(
        PRODUCT_REQUEST_ID,
        terms(),
        async () => new Response("gateway timeout", { status: 503 }),
      ),
    ).rejects.toMatchObject({ code: "provider-settlement-unknown" })
  })
})
