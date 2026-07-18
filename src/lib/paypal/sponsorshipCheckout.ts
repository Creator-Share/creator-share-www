import "server-only"

import { getPayPalApiUrl, paypalFetch } from "@/lib/paypal/client"
import type { MaterializedPayPalProviderRequest } from "@/lib/sponsorships/checkout/paypalProviderRequest"

const PAYPAL_ORDER_ID_PATTERN = /^[A-Z0-9]{17}$/
const PAYPAL_SUBSCRIPTION_ID_PATTERN = /^I-[A-Z0-9]{10,32}$/
const PAYPAL_CAPTURE_ID_PATTERN = /^[A-Z0-9]{10,32}$/
const MAXIMUM_PROVIDER_RESPONSE_BYTES = 256 * 1024

export interface PayPalOrderCreatePayload {
  intent: "CAPTURE"
  purchase_units: [
    {
      reference_id: string
      custom_id: string
      description: string
      amount: {
        currency_code: string
        value: string
      }
    },
  ]
  application_context: {
    brand_name: "Creator Share"
    shipping_preference: "NO_SHIPPING"
    user_action: "PAY_NOW"
  }
}

export interface PayPalSubscriptionCreatePayload {
  plan_id: string
  custom_id: string
  subscriber: {
    email_address: string
  }
  application_context: {
    brand_name: "Creator Share"
    shipping_preference: "NO_SHIPPING"
    user_action: "SUBSCRIBE_NOW"
    return_url: string
    cancel_url: string
  }
}

export type CreatedPayPalProviderObject =
  | {
      providerObjectType: "order"
      providerObjectId: string
      approvalUrl: null
    }
  | {
      providerObjectType: "billing_subscription"
      providerObjectId: string
      approvalUrl: string
    }

export interface CapturedPayPalOrder {
  orderId: string
  captureId: string
  status: "COMPLETED"
  chargedAmountMinor: number
  chargedCurrency: string
  occurredAt: string
  providerPayload: unknown
}

export type PayPalCheckoutFetch = (
  path: string,
  init?: RequestInit,
) => Promise<Response>

export interface PayPalSponsorshipCheckoutDependencies {
  fetch: PayPalCheckoutFetch
  apiUrl: string
}

export class PayPalSponsorshipCheckoutError extends Error {
  readonly code:
    "invalid-request" | "invalid-provider-response" | "provider-rejected"

  constructor(code: PayPalSponsorshipCheckoutError["code"]) {
    super("PayPal sponsorship checkout failed")
    this.name = "PayPalSponsorshipCheckoutError"
    this.code = code
  }
}

function fail(code: PayPalSponsorshipCheckoutError["code"]): never {
  throw new PayPalSponsorshipCheckoutError(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function moneyValue(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    fail("invalid-request")
  }
  return `${Math.floor(amountMinor / 100)}.${String(amountMinor % 100).padStart(2, "0")}`
}

function successUrl(baseUrl: string): string {
  return `${baseUrl}/payments/success?provider=paypal`
}

function cancelUrl(baseUrl: string): string {
  return `${baseUrl}/payments/failed?provider=paypal`
}

export function buildPayPalOrderCreatePayload(
  request: MaterializedPayPalProviderRequest,
): PayPalOrderCreatePayload {
  if (request.paymentMode !== "one_time" || request.paypalPlanId !== null) {
    fail("invalid-request")
  }
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: request.sponsorshipIntentId,
        custom_id: request.paymentAttemptId,
        description: request.productName,
        amount: {
          currency_code: request.chargedCurrency,
          value: moneyValue(request.chargedAmountMinor),
        },
      },
    ],
    application_context: {
      brand_name: "Creator Share",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
    },
  }
}

export function buildPayPalSubscriptionCreatePayload(
  request: MaterializedPayPalProviderRequest,
): PayPalSubscriptionCreatePayload {
  if (
    request.paymentMode !== "recurring" ||
    !request.paypalPlanId ||
    (request.recurrenceInterval !== "month" &&
      request.recurrenceInterval !== "year")
  ) {
    fail("invalid-request")
  }
  return {
    plan_id: request.paypalPlanId,
    custom_id: request.paymentAttemptId,
    subscriber: { email_address: request.customerEmail },
    application_context: {
      brand_name: "Creator Share",
      shipping_preference: "NO_SHIPPING",
      user_action: "SUBSCRIBE_NOW",
      return_url: successUrl(request.checkoutBaseUrl),
      cancel_url: cancelUrl(request.checkoutBaseUrl),
    },
  }
}

function expectedApprovalHostname(apiUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(apiUrl)
  } catch {
    fail("invalid-request")
  }
  if (parsed.origin === "https://api-m.paypal.com") return "www.paypal.com"
  if (parsed.origin === "https://api-m.sandbox.paypal.com") {
    return "www.sandbox.paypal.com"
  }
  fail("invalid-request")
}

function trustedApprovalUrl(value: unknown, apiUrl: string): string {
  if (typeof value !== "string" || value.length > 4096) {
    fail("invalid-provider-response")
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    fail("invalid-provider-response")
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== expectedApprovalHostname(apiUrl) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    fail("invalid-provider-response")
  }
  return parsed.toString()
}

async function parseResponse(response: Response): Promise<unknown> {
  const body = await response.text()
  if (Buffer.byteLength(body, "utf8") > MAXIMUM_PROVIDER_RESPONSE_BYTES) {
    fail("invalid-provider-response")
  }
  let parsed: unknown
  try {
    parsed = body ? JSON.parse(body) : null
  } catch {
    fail("invalid-provider-response")
  }
  if (!response.ok) fail("provider-rejected")
  return parsed
}

function requiredString(value: unknown, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    fail("invalid-provider-response")
  }
  return value
}

function parseCreatedOrder(value: unknown): CreatedPayPalProviderObject {
  if (!isRecord(value) || value.status !== "CREATED") {
    fail("invalid-provider-response")
  }
  const id = requiredString(value.id, 32)
  if (!PAYPAL_ORDER_ID_PATTERN.test(id)) fail("invalid-provider-response")
  return {
    providerObjectType: "order",
    providerObjectId: id,
    approvalUrl: null,
  }
}

function parseCreatedSubscription(
  value: unknown,
  apiUrl: string,
): CreatedPayPalProviderObject {
  if (
    !isRecord(value) ||
    value.status !== "APPROVAL_PENDING" ||
    !Array.isArray(value.links)
  ) {
    fail("invalid-provider-response")
  }
  const id = requiredString(value.id, 34)
  if (!PAYPAL_SUBSCRIPTION_ID_PATTERN.test(id)) {
    fail("invalid-provider-response")
  }
  const approvalLinks = value.links.filter(
    (link) =>
      isRecord(link) &&
      link.rel === "approve" &&
      (link.method === undefined || link.method === "GET"),
  )
  if (approvalLinks.length !== 1) fail("invalid-provider-response")
  return {
    providerObjectType: "billing_subscription",
    providerObjectId: id,
    approvalUrl: trustedApprovalUrl(approvalLinks[0].href, apiUrl),
  }
}

export async function createPayPalSponsorshipProviderObject(
  request: MaterializedPayPalProviderRequest,
  dependencies: PayPalSponsorshipCheckoutDependencies = {
    fetch: paypalFetch,
    apiUrl: getPayPalApiUrl(),
  },
): Promise<CreatedPayPalProviderObject> {
  const recurring = request.paymentMode === "recurring"
  const response = await dependencies.fetch(
    recurring ? "/v1/billing/subscriptions" : "/v2/checkout/orders",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Prefer: "return=representation",
        "PayPal-Request-Id": request.idempotencyKey,
      },
      body: JSON.stringify(
        recurring
          ? buildPayPalSubscriptionCreatePayload(request)
          : buildPayPalOrderCreatePayload(request),
      ),
    },
  )
  const parsed = await parseResponse(response)
  return recurring
    ? parseCreatedSubscription(parsed, dependencies.apiUrl)
    : parseCreatedOrder(parsed)
}

function parseAmountMinor(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(value)) {
    fail("invalid-provider-response")
  }
  const [major, minor] = value.split(".")
  const parsed = Number(major) * 100 + Number(minor)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    fail("invalid-provider-response")
  }
  return parsed
}

function parseCaptureResponse(
  value: unknown,
  request: MaterializedPayPalProviderRequest,
  expectedOrderId: string,
): CapturedPayPalOrder {
  if (
    !isRecord(value) ||
    value.id !== expectedOrderId ||
    value.status !== "COMPLETED" ||
    !Array.isArray(value.purchase_units) ||
    value.purchase_units.length !== 1
  ) {
    fail("invalid-provider-response")
  }
  const purchaseUnit = value.purchase_units[0]
  if (
    !isRecord(purchaseUnit) ||
    !isRecord(purchaseUnit.payments) ||
    !Array.isArray(purchaseUnit.payments.captures) ||
    purchaseUnit.payments.captures.length !== 1
  ) {
    fail("invalid-provider-response")
  }
  const capture = purchaseUnit.payments.captures[0]
  if (
    !isRecord(capture) ||
    capture.status !== "COMPLETED" ||
    capture.final_capture !== true ||
    !isRecord(capture.amount)
  ) {
    fail("invalid-provider-response")
  }
  const responseReferenceId = purchaseUnit.reference_id
  const purchaseUnitCustomId = purchaseUnit.custom_id
  const captureCustomId = capture.custom_id
  if (
    (responseReferenceId !== undefined &&
      responseReferenceId !== request.sponsorshipIntentId) ||
    (purchaseUnitCustomId !== undefined &&
      purchaseUnitCustomId !== request.paymentAttemptId) ||
    (captureCustomId !== undefined &&
      captureCustomId !== request.paymentAttemptId) ||
    (purchaseUnitCustomId === undefined && captureCustomId === undefined)
  ) {
    fail("invalid-provider-response")
  }
  const captureId = requiredString(capture.id, 32)
  const chargedCurrency = requiredString(capture.amount.currency_code, 3)
  const chargedAmountMinor = parseAmountMinor(capture.amount.value)
  const occurredAt = requiredString(capture.create_time, 64)
  if (
    !PAYPAL_CAPTURE_ID_PATTERN.test(captureId) ||
    chargedCurrency !== request.chargedCurrency ||
    chargedAmountMinor !== request.chargedAmountMinor ||
    !Number.isFinite(Date.parse(occurredAt))
  ) {
    fail("invalid-provider-response")
  }
  return {
    orderId: expectedOrderId,
    captureId,
    status: "COMPLETED",
    chargedAmountMinor,
    chargedCurrency,
    occurredAt: new Date(occurredAt).toISOString(),
    providerPayload: value,
  }
}

export async function capturePayPalSponsorshipOrder(
  orderId: string,
  request: MaterializedPayPalProviderRequest,
  dependencies: Pick<PayPalSponsorshipCheckoutDependencies, "fetch"> = {
    fetch: paypalFetch,
  },
): Promise<CapturedPayPalOrder> {
  if (
    request.paymentMode !== "one_time" ||
    !PAYPAL_ORDER_ID_PATTERN.test(orderId)
  ) {
    fail("invalid-request")
  }
  const response = await dependencies.fetch(
    `/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Prefer: "return=representation",
        "PayPal-Request-Id": request.paymentAttemptId,
      },
    },
  )
  return parseCaptureResponse(await parseResponse(response), request, orderId)
}
