import "server-only"

import { paypalFetch } from "@/lib/paypal/client"
import { isSupportedCurrency, type SupportedCurrency } from "@/utils/currency"

const PAYPAL_PRODUCT_ID_PATTERN = /^PROD-[A-Z0-9]{17}$/
const PAYPAL_PLAN_ID_PATTERN = /^P-[A-Z0-9]{24}$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MAXIMUM_PROVIDER_RESPONSE_BYTES = 256 * 1024

export interface PayPalBillingCatalogTerms {
  productName: string
  recurrenceInterval: "month" | "year"
  chargedAmountMinor: number
  chargedCurrency: SupportedCurrency
}

export interface PayPalBillingProductRequest {
  name: string
  description: string
  type: "SERVICE"
  category: "CHARITY"
}

export interface PayPalBillingPlanRequest {
  product_id: string
  name: string
  description: string
  status: "ACTIVE"
  billing_cycles: [
    {
      frequency: {
        interval_unit: "MONTH" | "YEAR"
        interval_count: 1
      }
      tenure_type: "REGULAR"
      sequence: 1
      total_cycles: 0
      pricing_scheme: {
        fixed_price: {
          value: string
          currency_code: SupportedCurrency
        }
      }
    },
  ]
  payment_preferences: {
    auto_bill_outstanding: true
    payment_failure_threshold: 3
  }
}

export interface ProvisionedPayPalProduct {
  productId: string
}

export interface ProvisionedPayPalPlan {
  productId: string
  planId: string
}

export type PayPalBillingCatalogFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>

export class PayPalBillingCatalogError extends Error {
  readonly code:
    | "invalid-terms"
    | "invalid-provider-response"
    | "provider-not-found"
    | "provider-rejected"
    | "provider-settlement-unknown"

  constructor(code: PayPalBillingCatalogError["code"]) {
    super("PayPal billing catalog operation failed")
    this.name = "PayPalBillingCatalogError"
    this.code = code
  }
}

function fail(code: PayPalBillingCatalogError["code"]): never {
  throw new PayPalBillingCatalogError(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function requiredProductName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 127 ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    fail("invalid-terms")
  }
  return value
}

function amountValue(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    fail("invalid-terms")
  }
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`
}

function requiredCurrency(value: unknown): SupportedCurrency {
  if (typeof value !== "string" || !isSupportedCurrency(value)) {
    fail("invalid-terms")
  }
  return value
}

function assertRequestId(requestId: string): void {
  if (!UUID_PATTERN.test(requestId) || requestId.length > 38) {
    fail("invalid-terms")
  }
}

function intervalUnit(
  recurrenceInterval: PayPalBillingCatalogTerms["recurrenceInterval"],
): "MONTH" | "YEAR" {
  if (recurrenceInterval === "month") return "MONTH"
  if (recurrenceInterval === "year") return "YEAR"
  fail("invalid-terms")
}

export function buildPayPalBillingProductRequest(
  terms: PayPalBillingCatalogTerms,
): PayPalBillingProductRequest {
  const productName = requiredProductName(terms.productName)
  amountValue(terms.chargedAmountMinor)
  requiredCurrency(terms.chargedCurrency)
  intervalUnit(terms.recurrenceInterval)
  return {
    name: productName,
    description: productName,
    type: "SERVICE",
    category: "CHARITY",
  }
}

export function buildPayPalBillingPlanRequest(
  productId: string,
  terms: PayPalBillingCatalogTerms,
): PayPalBillingPlanRequest {
  if (!PAYPAL_PRODUCT_ID_PATTERN.test(productId)) fail("invalid-terms")
  const productName = requiredProductName(terms.productName)
  const chargedCurrency = requiredCurrency(terms.chargedCurrency)
  return {
    product_id: productId,
    name: productName,
    description: productName,
    status: "ACTIVE",
    billing_cycles: [
      {
        frequency: {
          interval_unit: intervalUnit(terms.recurrenceInterval),
          interval_count: 1,
        },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: {
            value: amountValue(terms.chargedAmountMinor),
            currency_code: chargedCurrency,
          },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      payment_failure_threshold: 3,
    },
  }
}

async function readProviderResponse(response: Response): Promise<unknown> {
  const body = await response.text()
  if (Buffer.byteLength(body, "utf8") > MAXIMUM_PROVIDER_RESPONSE_BYTES) {
    fail("invalid-provider-response")
  }
  if (!response.ok) {
    if (response.status === 404 || response.status === 410) {
      fail("provider-not-found")
    }
    if (response.status >= 400 && response.status < 500) {
      fail("provider-rejected")
    }
    fail("provider-settlement-unknown")
  }
  let parsed: unknown
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    fail("invalid-provider-response")
  }
  return parsed
}

function parseProduct(
  value: unknown,
  terms: PayPalBillingCatalogTerms,
): ProvisionedPayPalProduct {
  if (
    !isRecord(value) ||
    value.name !== terms.productName ||
    value.description !== terms.productName ||
    value.type !== "SERVICE" ||
    value.category !== "CHARITY"
  ) {
    fail("invalid-provider-response")
  }
  const productId = value.id
  if (
    typeof productId !== "string" ||
    !PAYPAL_PRODUCT_ID_PATTERN.test(productId)
  ) {
    fail("invalid-provider-response")
  }
  return { productId }
}

function parsePlan(
  value: unknown,
  productId: string,
  terms: PayPalBillingCatalogTerms,
): ProvisionedPayPalPlan {
  if (
    !isRecord(value) ||
    value.product_id !== productId ||
    value.name !== terms.productName ||
    value.status !== "ACTIVE" ||
    value.description !== terms.productName ||
    !Array.isArray(value.billing_cycles) ||
    value.billing_cycles.length !== 1 ||
    !isRecord(value.payment_preferences) ||
    value.payment_preferences.auto_bill_outstanding !== true ||
    value.payment_preferences.payment_failure_threshold !== 3
  ) {
    fail("invalid-provider-response")
  }
  const planId = value.id
  const cycle = value.billing_cycles[0]
  if (
    typeof planId !== "string" ||
    !PAYPAL_PLAN_ID_PATTERN.test(planId) ||
    !isRecord(cycle) ||
    cycle.tenure_type !== "REGULAR" ||
    cycle.sequence !== 1 ||
    cycle.total_cycles !== 0 ||
    !isRecord(cycle.frequency) ||
    cycle.frequency.interval_unit !== intervalUnit(terms.recurrenceInterval) ||
    cycle.frequency.interval_count !== 1 ||
    !isRecord(cycle.pricing_scheme) ||
    !isRecord(cycle.pricing_scheme.fixed_price) ||
    cycle.pricing_scheme.fixed_price.value !==
      amountValue(terms.chargedAmountMinor) ||
    cycle.pricing_scheme.fixed_price.currency_code !== terms.chargedCurrency
  ) {
    fail("invalid-provider-response")
  }
  return { productId, planId }
}

export async function createPayPalBillingProduct(
  requestId: string,
  terms: PayPalBillingCatalogTerms,
  fetcher: PayPalBillingCatalogFetch = paypalFetch,
): Promise<ProvisionedPayPalProduct> {
  assertRequestId(requestId)
  const response = await fetcher("/v1/catalogs/products", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Prefer: "return=representation",
      "PayPal-Request-Id": requestId,
    },
    body: JSON.stringify(buildPayPalBillingProductRequest(terms)),
  })
  return parseProduct(await readProviderResponse(response), terms)
}

export async function createPayPalBillingPlan(
  requestId: string,
  productId: string,
  terms: PayPalBillingCatalogTerms,
  fetcher: PayPalBillingCatalogFetch = paypalFetch,
): Promise<ProvisionedPayPalPlan> {
  assertRequestId(requestId)
  const response = await fetcher("/v1/billing/plans", {
    method: "POST",
    headers: {
      Accept: "application/json",
      Prefer: "return=representation",
      "PayPal-Request-Id": requestId,
    },
    body: JSON.stringify(buildPayPalBillingPlanRequest(productId, terms)),
  })
  return parsePlan(await readProviderResponse(response), productId, terms)
}

export async function verifyPayPalBillingPlan(
  planId: string,
  productId: string,
  terms: PayPalBillingCatalogTerms,
  fetcher: PayPalBillingCatalogFetch = paypalFetch,
): Promise<ProvisionedPayPalPlan> {
  if (!PAYPAL_PLAN_ID_PATTERN.test(planId)) fail("invalid-terms")
  const response = await fetcher(`/v1/billing/plans/${planId}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  })
  const parsed = parsePlan(
    await readProviderResponse(response),
    productId,
    terms,
  )
  if (parsed.planId !== planId) fail("invalid-provider-response")
  return parsed
}
