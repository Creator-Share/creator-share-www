import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type ProvisionerModule =
  typeof import("../../src/lib/paypal/billingCatalogProvisioner")
type Repository =
  import("../../src/lib/paypal/billingCatalogProvisioner").PayPalBillingCatalogRepository
type ClaimedEntry =
  import("../../src/lib/paypal/billingCatalogProvisioner").ClaimedPayPalBillingCatalogEntry
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
    "tests/sponsorships/paypal-billing-catalog-provisioner.spec.ts",
  ),
)
const provisionerModule = testRequire(
  "../../src/lib/paypal/billingCatalogProvisioner",
) as ProvisionerModule
nodeModule._load = originalModuleLoad

const { ensurePayPalBillingPlan, PayPalBillingCatalogProvisioningError } =
  provisionerModule

const ENTRY_ID = "11111111-1111-4111-8111-111111111111"
const LEASE_ID = "22222222-2222-4222-8222-222222222222"
const PRODUCT_REQUEST_ID = "33333333-3333-4333-8333-333333333333"
const PLAN_REQUEST_ID = "44444444-4444-4444-8444-444444444444"
const MARKED_PRODUCT_REQUEST_ID = "77777777-7777-4777-8777-777777777777"
const MARKED_PLAN_REQUEST_ID = "88888888-8888-4888-8888-888888888888"
const PRODUCT_ID = "PROD-ABCDEFGHIJKLMNOPQ"
const PLAN_ID = "P-ABCDEFGHIJKLMNOPQRSTUVWX"

const context = {
  requestId: "55555555-5555-4555-8555-555555555555",
  traceId: "test-trace",
}

function terms() {
  return {
    subjectKind: "standard" as const,
    beneficiaryId: "66666666-6666-4666-8666-666666666666",
    productName: "Monthly Sponsorship for Amina",
    recurrenceInterval: "month" as const,
    baseAmountUsdCents: 3333,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP" as const,
    conversionRate: 0.74,
    currencyRateSource: "test-rate-source",
  }
}

function claimedEntry(overrides: Partial<ClaimedEntry> = {}): ClaimedEntry {
  return {
    catalogEntryId: ENTRY_ID,
    catalogStatus: "provisioning",
    provisioningLeaseToken: LEASE_ID,
    productRequestId: PRODUCT_REQUEST_ID,
    planRequestId: PLAN_REQUEST_ID,
    providerProductId: null,
    providerPlanId: null,
    provisioningRequired: true,
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

function planRepresentation(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  }
}

interface RepositoryOverrides {
  claim?: () => Promise<ClaimedEntry>
  mark?: Repository["markProviderRequestStarted"]
  record?: Repository["recordProduct"]
  activate?: Repository["activateEntry"]
  fail?: Repository["failKnownRejection"]
  quarantine?: Repository["quarantineEntry"]
}

function fakeRepository(overrides: RepositoryOverrides = {}) {
  const events: string[] = []
  const repository: Repository = {
    async claimEntry() {
      events.push("claim")
      return overrides.claim ? overrides.claim() : claimedEntry()
    },
    async markProviderRequestStarted(options) {
      events.push(`mark:${options.phase}`)
      if (overrides.mark) return overrides.mark(options)
      return {
        providerRequestId:
          options.phase === "product"
            ? MARKED_PRODUCT_REQUEST_ID
            : MARKED_PLAN_REQUEST_ID,
      }
    },
    async recordProduct(options) {
      events.push(`record:${options.providerProductId}`)
      await overrides.record?.(options)
    },
    async activateEntry(options) {
      events.push(`activate:${options.providerPlanId}`)
      await overrides.activate?.(options)
    },
    async failKnownRejection(options) {
      events.push(`fail:${options.phase}`)
      await overrides.fail?.(options)
    },
    async quarantineEntry(options) {
      events.push(`quarantine:${options.manualReviewCode}`)
      await overrides.quarantine?.(options)
    },
  }
  return { repository, events }
}

test.describe("PayPal billing catalog provisioner", () => {
  test("provisions and activates exact product and plan records", async () => {
    const { repository, events } = fakeRepository()
    const providerCalls: Array<{
      path: string
      providerRequestId: string | null
    }> = []
    const result = await ensurePayPalBillingPlan({
      dependencies: {
        repository,
        async fetch(path, init) {
          providerCalls.push({
            path,
            providerRequestId: new Headers(init?.headers).get(
              "PayPal-Request-Id",
            ),
          })
          if (path === "/v1/catalogs/products") {
            return Response.json(productRepresentation())
          }
          return Response.json(planRepresentation())
        },
      },
      terms: terms(),
      context,
    })

    expect(result).toEqual({ planId: PLAN_ID })
    expect(providerCalls).toEqual([
      {
        path: "/v1/catalogs/products",
        providerRequestId: MARKED_PRODUCT_REQUEST_ID,
      },
      {
        path: "/v1/billing/plans",
        providerRequestId: MARKED_PLAN_REQUEST_ID,
      },
    ])
    expect(events).toEqual([
      "claim",
      "mark:product",
      `record:${PRODUCT_ID}`,
      "mark:plan",
      `activate:${PLAN_ID}`,
    ])
  })

  test("verifies an active plan before allowing checkout", async () => {
    const { repository, events } = fakeRepository({
      claim: async () =>
        claimedEntry({
          catalogStatus: "active",
          provisioningLeaseToken: null,
          providerProductId: PRODUCT_ID,
          providerPlanId: PLAN_ID,
          provisioningRequired: false,
        }),
    })
    const paths: string[] = []
    await expect(
      ensurePayPalBillingPlan({
        dependencies: {
          repository,
          async fetch(path) {
            paths.push(path)
            return Response.json(planRepresentation())
          },
        },
        terms: terms(),
        context,
      }),
    ).resolves.toEqual({ planId: PLAN_ID })
    expect(paths).toEqual([`/v1/billing/plans/${PLAN_ID}`])
    expect(events).toEqual(["claim"])
  })

  test("fails closed when the durable catalog requires manual review", async () => {
    const { repository, events } = fakeRepository({
      claim: async () =>
        claimedEntry({
          catalogStatus: "manual_review",
          provisioningLeaseToken: null,
          provisioningRequired: false,
        }),
    })
    await expect(
      ensurePayPalBillingPlan({
        dependencies: { repository },
        terms: terms(),
        context,
      }),
    ).rejects.toMatchObject({ code: "catalog-unavailable" })
    expect(events).toEqual(["claim"])
  })

  test("records a known provider rejection without quarantine", async () => {
    const { repository, events } = fakeRepository()
    await expect(
      ensurePayPalBillingPlan({
        dependencies: {
          repository,
          async fetch() {
            return Response.json({ name: "INVALID_REQUEST" }, { status: 422 })
          },
        },
        terms: terms(),
        context,
      }),
    ).rejects.toMatchObject({ code: "provider-rejected" })
    expect(events).toEqual(["claim", "mark:product", "fail:product"])
  })

  test("quarantines ambiguous provider settlement", async () => {
    const { repository, events } = fakeRepository()
    await expect(
      ensurePayPalBillingPlan({
        dependencies: {
          repository,
          async fetch() {
            throw new Error("connection reset after request upload")
          },
        },
        terms: terms(),
        context,
      }),
    ).rejects.toMatchObject({ code: "settlement-unknown" })
    expect(events).toEqual([
      "claim",
      "mark:product",
      "quarantine:product_request_ambiguous",
    ])
  })

  test("quarantines a valid product that cannot be recorded", async () => {
    const { repository, events } = fakeRepository({
      record: async () => {
        throw new Error("database unavailable")
      },
    })
    await expect(
      ensurePayPalBillingPlan({
        dependencies: {
          repository,
          async fetch() {
            return Response.json(productRepresentation())
          },
        },
        terms: terms(),
        context,
      }),
    ).rejects.toBeInstanceOf(PayPalBillingCatalogProvisioningError)
    expect(events).toEqual([
      "claim",
      "mark:product",
      `record:${PRODUCT_ID}`,
      "quarantine:product_response_recording_failed",
    ])
  })

  test("quarantines detected active plan drift", async () => {
    const { repository, events } = fakeRepository({
      claim: async () =>
        claimedEntry({
          catalogStatus: "active",
          provisioningLeaseToken: null,
          providerProductId: PRODUCT_ID,
          providerPlanId: PLAN_ID,
          provisioningRequired: false,
        }),
    })
    await expect(
      ensurePayPalBillingPlan({
        dependencies: {
          repository,
          async fetch() {
            return Response.json(planRepresentation({ status: "INACTIVE" }))
          },
        },
        terms: terms(),
        context,
      }),
    ).rejects.toMatchObject({ code: "settlement-unknown" })
    expect(events).toEqual(["claim", "quarantine:active_plan_drift"])
  })

  test("does not quarantine a transient active plan verification outage", async () => {
    const { repository, events } = fakeRepository({
      claim: async () =>
        claimedEntry({
          catalogStatus: "active",
          provisioningLeaseToken: null,
          providerProductId: PRODUCT_ID,
          providerPlanId: PLAN_ID,
          provisioningRequired: false,
        }),
    })
    await expect(
      ensurePayPalBillingPlan({
        dependencies: {
          repository,
          async fetch() {
            return new Response("upstream unavailable", { status: 503 })
          },
        },
        terms: terms(),
        context,
      }),
    ).rejects.toMatchObject({ code: "dependency-failed" })
    expect(events).toEqual(["claim"])
  })
})
