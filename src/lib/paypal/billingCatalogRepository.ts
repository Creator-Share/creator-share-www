import "server-only"

import { createHash } from "node:crypto"

import type {
  ClaimedPayPalBillingCatalogEntry,
  PayPalBillingCatalogManualReviewCode,
  PayPalBillingCatalogRepository,
} from "@/lib/paypal/billingCatalogProvisioner"
import { createServiceRoleClient } from "@/utils/supabase/server"

interface RpcErrorLike {
  code?: string
}

interface RpcResultLike {
  data: unknown
  error: RpcErrorLike | null
}

export interface PayPalBillingCatalogRpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<RpcResultLike>
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PRODUCT_ID_PATTERN = /^PROD-[A-Z0-9]{17}$/
const PLAN_ID_PATTERN = /^P-[A-Z0-9]{24}$/
const REVIEW_CODES = new Set<PayPalBillingCatalogManualReviewCode>([
  "product_request_ambiguous",
  "product_response_recording_failed",
  "plan_request_ambiguous",
  "plan_response_recording_failed",
  "active_plan_drift",
])

export class PayPalBillingCatalogRepositoryError extends Error {
  readonly databaseCode: string | null

  constructor(databaseCode: string | null = null) {
    super("PayPal billing catalog repository failed")
    this.name = "PayPalBillingCatalogRepositoryError"
    this.databaseCode = databaseCode
  }
}

function fail(error: RpcErrorLike | null = null): never {
  throw new PayPalBillingCatalogRepositoryError(error?.code ?? null)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function oneRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || !isRecord(data[0])) fail()
  return data[0]
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
  maximumLength = 255,
): string {
  const value = row[key]
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    fail()
  }
  return value
}

function nullableString(
  row: Record<string, unknown>,
  key: string,
  maximumLength = 255,
): string | null {
  if (row[key] === null || row[key] === undefined) return null
  return requiredString(row, key, maximumLength)
}

function requiredUuid(row: Record<string, unknown>, key: string): string {
  const value = requiredString(row, key, 36)
  if (!UUID_PATTERN.test(value)) fail()
  return value
}

function nullableUuid(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = nullableString(row, key, 36)
  if (value !== null && !UUID_PATTERN.test(value)) fail()
  return value
}

function requiredBoolean(row: Record<string, unknown>, key: string): boolean {
  if (typeof row[key] !== "boolean") fail()
  return row[key]
}

function nullableReviewCode(
  row: Record<string, unknown>,
  key: string,
): string | null {
  return nullableString(row, key, 80)
}

function assertProviderProductId(value: string | null): void {
  if (value !== null && !PRODUCT_ID_PATTERN.test(value)) fail()
}

function assertProviderPlanId(value: string | null): void {
  if (value !== null && !PLAN_ID_PATTERN.test(value)) fail()
}

async function rpc(
  client: PayPalBillingCatalogRpcClient,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await client.rpc(name, args)
  if (error) fail(error)
  return oneRow(data)
}

function canonicalEvidenceDigest(options: {
  catalogEntryId: string
  manualReviewCode: PayPalBillingCatalogManualReviewCode
  observedProviderProductId: string | null
  observedProviderPlanId: string | null
}): `\\x${string}` {
  const canonical = JSON.stringify({
    catalog_entry_id: options.catalogEntryId,
    manual_review_code: options.manualReviewCode,
    observed_provider_plan_id: options.observedProviderPlanId,
    observed_provider_product_id: options.observedProviderProductId,
  })
  return `\\x${createHash("sha256").update(canonical, "utf8").digest("hex")}`
}

export function createPayPalBillingCatalogRepository(
  client: PayPalBillingCatalogRpcClient = createServiceRoleClient() as unknown as PayPalBillingCatalogRpcClient,
): PayPalBillingCatalogRepository {
  return {
    async claimEntry({ terms, context }) {
      const row = await rpc(client, "claim_paypal_billing_catalog_entry", {
        target_subject_kind: terms.subjectKind,
        target_beneficiary_id: terms.beneficiaryId,
        target_product_name: terms.productName,
        target_recurrence_interval: terms.recurrenceInterval,
        target_base_amount_usd_cents: terms.baseAmountUsdCents,
        target_charged_amount_minor: terms.chargedAmountMinor,
        target_charged_currency: terms.chargedCurrency,
        target_conversion_rate: terms.conversionRate,
        target_currency_rate_source: terms.currencyRateSource,
        target_lease_valid_for: "90 seconds",
        context_request_id: context.requestId,
        context_trace_id: context.traceId,
      })
      const catalogStatus = requiredString(row, "catalog_status", 40)
      if (
        catalogStatus !== "provisioning" &&
        catalogStatus !== "active" &&
        catalogStatus !== "manual_review"
      ) {
        fail()
      }
      const providerProductId = nullableString(row, "provider_product_id", 22)
      const providerPlanId = nullableString(row, "provider_plan_id", 26)
      assertProviderProductId(providerProductId)
      assertProviderPlanId(providerPlanId)
      const manualReviewCode = nullableReviewCode(row, "manual_review_code")
      if (
        (catalogStatus === "manual_review") !== (manualReviewCode !== null) ||
        (manualReviewCode !== null &&
          ![
            ...REVIEW_CODES,
            "product_request_window_expired",
            "plan_request_window_expired",
            "provisioning_attempts_exhausted",
          ].includes(manualReviewCode))
      ) {
        fail()
      }

      const entry: ClaimedPayPalBillingCatalogEntry = {
        catalogEntryId: requiredUuid(row, "catalog_entry_id"),
        catalogStatus,
        provisioningLeaseToken: nullableUuid(row, "provisioning_lease_token"),
        productRequestId: requiredUuid(row, "product_request_id"),
        planRequestId: requiredUuid(row, "plan_request_id"),
        providerProductId,
        providerPlanId,
        provisioningRequired: requiredBoolean(row, "provisioning_required"),
      }
      if (
        (entry.catalogStatus === "provisioning") !==
          (entry.provisioningLeaseToken !== null) ||
        (entry.catalogStatus === "provisioning") !== entry.provisioningRequired
      ) {
        fail()
      }
      return entry
    },

    async markProviderRequestStarted({
      catalogEntryId,
      provisioningLeaseToken,
      phase,
      context,
    }) {
      const row = await rpc(
        client,
        "start_paypal_billing_catalog_provider_request",
        {
          target_catalog_entry_id: catalogEntryId,
          target_provisioning_lease_token: provisioningLeaseToken,
          target_request_phase: phase,
          context_request_id: context.requestId,
          context_trace_id: context.traceId,
        },
      )
      const providerRequestId = requiredUuid(row, "provider_request_id")
      if (
        requiredUuid(row, "catalog_entry_id") !== catalogEntryId ||
        requiredString(row, "catalog_status", 40) !== "provisioning" ||
        requiredString(row, "request_phase", 20) !== phase ||
        requiredBoolean(row, "provider_call_allowed") !== true ||
        nullableReviewCode(row, "manual_review_code") !== null
      ) {
        fail()
      }
      return { providerRequestId }
    },

    async recordProduct({
      catalogEntryId,
      provisioningLeaseToken,
      providerProductId,
      context,
    }) {
      const row = await rpc(client, "record_paypal_billing_catalog_product", {
        target_catalog_entry_id: catalogEntryId,
        target_provisioning_lease_token: provisioningLeaseToken,
        target_provider_product_id: providerProductId,
        target_lease_valid_for: "90 seconds",
        context_request_id: context.requestId,
        context_trace_id: context.traceId,
      })
      if (
        requiredUuid(row, "catalog_entry_id") !== catalogEntryId ||
        requiredString(row, "provider_product_id", 22) !== providerProductId
      ) {
        fail()
      }
    },

    async activateEntry({
      catalogEntryId,
      provisioningLeaseToken,
      providerProductId,
      providerPlanId,
      context,
    }) {
      const row = await rpc(client, "activate_paypal_billing_catalog_entry", {
        target_catalog_entry_id: catalogEntryId,
        target_provisioning_lease_token: provisioningLeaseToken,
        target_provider_product_id: providerProductId,
        target_provider_plan_id: providerPlanId,
        context_request_id: context.requestId,
        context_trace_id: context.traceId,
      })
      if (
        requiredUuid(row, "catalog_entry_id") !== catalogEntryId ||
        requiredString(row, "catalog_status", 40) !== "active" ||
        requiredString(row, "provider_product_id", 22) !== providerProductId ||
        requiredString(row, "provider_plan_id", 26) !== providerPlanId
      ) {
        fail()
      }
    },

    async failKnownRejection({
      catalogEntryId,
      provisioningLeaseToken,
      phase,
      context,
    }) {
      const row = await rpc(client, "fail_paypal_billing_catalog_entry", {
        target_catalog_entry_id: catalogEntryId,
        target_provisioning_lease_token: provisioningLeaseToken,
        target_request_phase: phase,
        context_request_id: context.requestId,
        context_trace_id: context.traceId,
      })
      if (
        requiredUuid(row, "catalog_entry_id") !== catalogEntryId ||
        requiredString(row, "catalog_status", 40) !== "failed" ||
        requiredString(row, "failed_request_phase", 20) !== phase ||
        requiredString(row, "last_error_code", 80) !== "provider_rejected"
      ) {
        fail()
      }
    },

    async quarantineEntry({
      catalogEntryId,
      provisioningLeaseToken,
      manualReviewCode,
      observedProviderProductId,
      observedProviderPlanId,
      context,
    }) {
      if (!REVIEW_CODES.has(manualReviewCode)) fail()
      const row = await rpc(client, "quarantine_paypal_billing_catalog_entry", {
        target_catalog_entry_id: catalogEntryId,
        target_provisioning_lease_token: provisioningLeaseToken,
        target_manual_review_code: manualReviewCode,
        target_evidence_sha256: canonicalEvidenceDigest({
          catalogEntryId,
          manualReviewCode,
          observedProviderProductId,
          observedProviderPlanId,
        }),
        target_observed_provider_product_id: observedProviderProductId,
        target_observed_provider_plan_id: observedProviderPlanId,
        context_request_id: context.requestId,
        context_trace_id: context.traceId,
      })
      if (
        requiredUuid(row, "catalog_entry_id") !== catalogEntryId ||
        requiredString(row, "catalog_status", 40) !== "manual_review" ||
        requiredString(row, "manual_review_code", 80) !== manualReviewCode
      ) {
        fail()
      }
    },
  }
}

export function createDefaultPayPalBillingCatalogRepository(): PayPalBillingCatalogRepository {
  return createPayPalBillingCatalogRepository()
}
