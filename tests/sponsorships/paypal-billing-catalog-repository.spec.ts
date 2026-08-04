import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type RepositoryModule =
  typeof import("../../src/lib/paypal/billingCatalogRepository")
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
  if (request === "@/utils/supabase/server") {
    return { createServiceRoleClient: () => ({}) }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(
    process.cwd(),
    "tests/sponsorships/paypal-billing-catalog-repository.spec.ts",
  ),
)
const repositoryModule = testRequire(
  "../../src/lib/paypal/billingCatalogRepository",
) as RepositoryModule
nodeModule._load = originalModuleLoad

const { createPayPalBillingCatalogRepository } = repositoryModule

const ENTRY_ID = "11111111-1111-4111-8111-111111111111"
const LEASE_ID = "22222222-2222-4222-8222-222222222222"
const PRODUCT_REQUEST_ID = "33333333-3333-4333-8333-333333333333"
const PLAN_REQUEST_ID = "44444444-4444-4444-8444-444444444444"
const PRODUCT_ID = "PROD-ABCDEFGHIJKLMNOPQ"
const PLAN_ID = "P-ABCDEFGHIJKLMNOPQRSTUVWX"

function terms() {
  return {
    subjectKind: "standard" as const,
    beneficiaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    productName: "Monthly Sponsorship for Amina",
    recurrenceInterval: "month" as const,
    baseAmountUsdCents: 3333,
    chargedAmountMinor: 2466,
    chargedCurrency: "GBP" as const,
    conversionRate: 0.74,
    currencyRateSource: "test-rate-source",
  }
}

const context = { requestId: "request-1", traceId: "trace-1" }

test.describe("PayPal billing catalog RPC repository", () => {
  test("maps exact catalog terms and requires the durable provider marker", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const client = {
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args })
        if (name === "claim_paypal_billing_catalog_entry") {
          return {
            data: [
              {
                catalog_entry_id: ENTRY_ID,
                catalog_status: "provisioning",
                provisioning_lease_token: LEASE_ID,
                product_request_id: PRODUCT_REQUEST_ID,
                plan_request_id: PLAN_REQUEST_ID,
                provider_product_id: null,
                provider_plan_id: null,
                provisioning_attempt_count: 1,
                provisioning_required: true,
                replayed: false,
                manual_review_code: null,
              },
            ],
            error: null,
          }
        }
        return {
          data: [
            {
              catalog_entry_id: ENTRY_ID,
              catalog_status: "provisioning",
              request_phase: "product",
              provider_request_id: PRODUCT_REQUEST_ID,
              request_started_at: "2026-07-18T00:00:00Z",
              request_last_started_at: "2026-07-18T00:00:00Z",
              request_reuse_expires_at: "2026-07-20T00:00:00Z",
              request_attempt_count: 1,
              provider_call_allowed: true,
              replayed: false,
              manual_review_code: null,
            },
          ],
          error: null,
        }
      },
    }
    const repository = createPayPalBillingCatalogRepository(client)
    await expect(
      repository.claimEntry({ terms: terms(), context }),
    ).resolves.toMatchObject({
      catalogEntryId: ENTRY_ID,
      provisioningLeaseToken: LEASE_ID,
      productRequestId: PRODUCT_REQUEST_ID,
    })
    await expect(
      repository.markProviderRequestStarted({
        catalogEntryId: ENTRY_ID,
        provisioningLeaseToken: LEASE_ID,
        phase: "product",
        context,
      }),
    ).resolves.toEqual({ providerRequestId: PRODUCT_REQUEST_ID })

    expect(calls[0]).toEqual({
      name: "claim_paypal_billing_catalog_entry",
      args: {
        target_subject_kind: "standard",
        target_beneficiary_id: terms().beneficiaryId,
        target_product_name: terms().productName,
        target_recurrence_interval: "month",
        target_base_amount_usd_cents: 3333,
        target_charged_amount_minor: 2466,
        target_charged_currency: "GBP",
        target_conversion_rate: 0.74,
        target_currency_rate_source: "test-rate-source",
        target_lease_valid_for: "90 seconds",
        context_request_id: "request-1",
        context_trace_id: "trace-1",
      },
    })
  })

  test("fails closed when the marker denies the external provider call", async () => {
    const repository = createPayPalBillingCatalogRepository({
      async rpc() {
        return {
          data: [
            {
              catalog_entry_id: ENTRY_ID,
              catalog_status: "manual_review",
              request_phase: "product",
              provider_request_id: null,
              provider_call_allowed: false,
              manual_review_code: "product_request_window_expired",
            },
          ],
          error: null,
        }
      },
    })
    await expect(
      repository.markProviderRequestStarted({
        catalogEntryId: ENTRY_ID,
        provisioningLeaseToken: LEASE_ID,
        phase: "product",
        context,
      }),
    ).rejects.toMatchObject({
      message: "PayPal billing catalog repository failed",
    })
  })

  test("quarantines with one deterministic noncontact evidence digest", async () => {
    const calls: Array<Record<string, unknown>> = []
    const repository = createPayPalBillingCatalogRepository({
      async rpc(_name, args) {
        calls.push(args)
        return {
          data: [
            {
              catalog_entry_id: ENTRY_ID,
              catalog_status: "manual_review",
              provider_product_id: PRODUCT_ID,
              provider_plan_id: PLAN_ID,
              manual_review_code: "active_plan_drift",
              manual_review_at: "2026-07-18T00:00:00Z",
              replayed: false,
            },
          ],
          error: null,
        }
      },
    })
    const options = {
      catalogEntryId: ENTRY_ID,
      provisioningLeaseToken: null,
      manualReviewCode: "active_plan_drift" as const,
      observedProviderProductId: PRODUCT_ID,
      observedProviderPlanId: PLAN_ID,
      context,
    }
    await repository.quarantineEntry(options)
    await repository.quarantineEntry(options)

    expect(calls[0].target_evidence_sha256).toMatch(/^\\x[0-9a-f]{64}$/)
    expect(calls[1].target_evidence_sha256).toBe(
      calls[0].target_evidence_sha256,
    )
    expect(JSON.stringify(calls)).not.toContain("example.com")
  })
})
