import "server-only"

import { createHash } from "node:crypto"

import { resolveSponsorshipCheckoutHost } from "@/lib/sponsorships/checkout/stripeCheckout"
import {
  paypalCheckoutReturnUrls,
  stripeCheckoutReturnUrls,
  type ProviderCheckoutReturnUrls,
} from "@/lib/sponsorships/checkout/providerReturnUrls"
import { STRIPE_API_VERSION } from "@/lib/stripe/config"

import type {
  PayPalPublicationPaymentCanaryConfig,
  PublicationPaymentCanaryConfig,
  StripePublicationPaymentCanaryConfig,
} from "./config"
import {
  isRecord,
  retryAfterSeconds,
  type FetchImplementation,
} from "./providerHttp"
import { DomainProvisioningError } from "./types"
import { isUuid, sanitizeEvidenceString } from "./validation"

const STRIPE_CHECKOUT_SESSION_URL =
  "https://api.stripe.com/v1/checkout/sessions"
const PAYPAL_TOKEN_URL = "https://api-m.paypal.com/v1/oauth2/token"
const PAYPAL_SUBSCRIPTION_URL =
  "https://api-m.paypal.com/v1/billing/subscriptions"
const MAX_CANARY_RESPONSE_BYTES = 64_000
const STRIPE_SESSION_ID_PATTERN = /^cs_live_[A-Za-z0-9]+$/
const PAYPAL_SUBSCRIPTION_ID_PATTERN = /^I-[A-Z0-9]{10,32}$/
const PAYPAL_BILLING_APPROVAL_TOKEN_PATTERN = /^BA-[A-Z0-9]{10,32}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export interface PublicationPaymentCanaryInput {
  advocateHostname: string
  canaryAttemptId: string
}

export interface PublicationPaymentCanaryDependencies {
  fetchImplementation?: FetchImplementation
  now?: () => Date
}

interface PublicationPaymentCanaryEvidenceBase {
  schema_version: 1
  provider: PublicationPaymentCanaryConfig["provider"]
  provider_resource_id: string
  provider_status:
    "checkout_session_expired_unpaid" | "subscription_approval_pending"
  provider_created_at: string
  provider_return_urls_sha256: string
  outbound_request_id_sha256: string
  create_http_status: number
  financial_charge_attempted: false
  provider_capture_attempted: false
  sponsorship_state_created: false
  webhook_delivery_verified: false
  verified: true
  verified_at: string
  provider_credential_request_id?: string
  provider_create_request_id?: string
}

export interface StripePublicationPaymentCanaryEvidence extends PublicationPaymentCanaryEvidenceBase {
  provider: StripePublicationPaymentCanaryConfig["provider"]
  provider_status: "checkout_session_expired_unpaid"
  create_provider_status: "open" | "expired"
  cleanup_request_id_sha256: string
  cleanup_http_status: 200 | null
  cleanup_performed: boolean
  provider_cleanup_request_id?: string
}

export interface PayPalPublicationPaymentCanaryEvidence extends PublicationPaymentCanaryEvidenceBase {
  provider: "paypal"
  provider_status: "subscription_approval_pending"
  create_http_status: 200 | 201
}

export type PublicationPaymentCanaryEvidence =
  | StripePublicationPaymentCanaryEvidence
  | PayPalPublicationPaymentCanaryEvidence

interface CanaryJsonResponse {
  payload: unknown
  status: number
  providerRequestId?: string
}

interface StripeSessionFacts {
  id: string
  providerCreatedAt: string
  status: "open" | "expired"
}

interface PayPalSubscriptionFacts {
  id: string
  providerCreatedAt: string
}

function canaryError(options: {
  provider: PublicationPaymentCanaryConfig["provider"]
  kind:
    | "invalid_input"
    | "invalid_response"
    | "network_error"
    | "rejected"
    | "transient_error"
  retryable: boolean
  response?: Response
}): DomainProvisioningError {
  return new DomainProvisioningError({
    code: `${options.provider}_publication_canary_${options.kind}`,
    retryable: options.retryable,
    ...(options.response
      ? {
          evidence: { http_status: options.response.status },
          retryAfterSeconds: retryAfterSeconds(options.response),
        }
      : {}),
  })
}

function invalidInput(
  provider: PublicationPaymentCanaryConfig["provider"],
): never {
  throw canaryError({
    provider,
    kind: "invalid_input",
    retryable: false,
  })
}

function invalidResponse(
  provider: PublicationPaymentCanaryConfig["provider"],
  response: Response,
  retryable = true,
): never {
  throw canaryError({
    provider,
    kind: "invalid_response",
    retryable,
    response,
  })
}

function sha256(value: string): string {
  const digest = createHash("sha256").update(value, "utf8").digest("hex")
  if (!SHA256_PATTERN.test(digest)) throw new Error("Invalid SHA-256 digest")
  return digest
}

function returnUrlsSha256(returnUrls: ProviderCheckoutReturnUrls): string {
  return sha256(
    JSON.stringify({
      cancel_url: returnUrls.cancelUrl,
      success_url: returnUrls.successUrl,
    }),
  )
}

function exactAdvocateCheckoutBaseUrl(
  provider: PublicationPaymentCanaryConfig["provider"],
  input: PublicationPaymentCanaryInput,
): string {
  if (
    !isUuid(input.canaryAttemptId) ||
    input.canaryAttemptId !== input.canaryAttemptId.toLowerCase()
  ) {
    invalidInput(provider)
  }

  let host: ReturnType<typeof resolveSponsorshipCheckoutHost>
  try {
    host = resolveSponsorshipCheckoutHost(input.advocateHostname, {
      allowLocalhostDevelopment: false,
    })
  } catch {
    invalidInput(provider)
  }

  if (
    host.source !== "advocate_domain" ||
    host.advocateHostname !== input.advocateHostname ||
    host.checkoutBaseUrl !== `https://${input.advocateHostname}`
  ) {
    invalidInput(provider)
  }
  return host.checkoutBaseUrl
}

function providerRequestId(
  provider: PublicationPaymentCanaryConfig["provider"],
  response: Response,
): string | undefined {
  const headerNames =
    provider === "paypal" ? ["paypal-debug-id"] : ["request-id", "x-request-id"]

  for (const headerName of headerNames) {
    const candidate = sanitizeEvidenceString(response.headers.get(headerName))
    if (candidate) return candidate
  }
  return undefined
}

async function readBoundedJson(
  provider: PublicationPaymentCanaryConfig["provider"],
  response: Response,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    invalidResponse(provider, response)
  }

  const contentLength = response.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^[0-9]+$/.test(contentLength) ||
      Number(contentLength) > MAX_CANARY_RESPONSE_BYTES)
  ) {
    invalidResponse(provider, response)
  }

  let body: string
  try {
    body = await response.text()
  } catch {
    invalidResponse(provider, response)
  }

  if (
    body.length < 1 ||
    new TextEncoder().encode(body).byteLength > MAX_CANARY_RESPONSE_BYTES
  ) {
    invalidResponse(provider, response)
  }

  try {
    return JSON.parse(body) as unknown
  } catch {
    invalidResponse(provider, response)
  }
}

async function fetchCanaryJson(options: {
  provider: PublicationPaymentCanaryConfig["provider"]
  fetchImplementation: FetchImplementation
  url: string
  init: RequestInit
  timeoutMs: number
  expectedStatuses: readonly number[]
}): Promise<CanaryJsonResponse> {
  let response: Response
  try {
    response = await options.fetchImplementation(options.url, {
      ...options.init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch {
    throw canaryError({
      provider: options.provider,
      kind: "network_error",
      retryable: true,
    })
  }

  if (!options.expectedStatuses.includes(response.status)) {
    try {
      await response.body?.cancel()
    } catch {
      // Provider error bodies are deliberately never parsed or propagated.
    }
    const retryable = response.status === 429 || response.status >= 500
    throw canaryError({
      provider: options.provider,
      kind: retryable ? "transient_error" : "rejected",
      retryable,
      response,
    })
  }

  const requestId = providerRequestId(options.provider, response)
  return {
    payload: await readBoundedJson(options.provider, response),
    status: response.status,
    ...(requestId ? { providerRequestId: requestId } : {}),
  }
}

function stripeIdempotencyKey(
  provider: StripePublicationPaymentCanaryConfig["provider"],
  canaryAttemptId: string,
  phase: "create" | "expire",
): string {
  return `advocate-publication:${provider}:${canaryAttemptId}:${phase}`
}

function parseStripeSession(options: {
  provider: StripePublicationPaymentCanaryConfig["provider"]
  response: CanaryJsonResponse
  expectedStatuses: readonly ("open" | "expired")[]
  expectedId?: string
  expectedProviderCreatedAt?: string
}): StripeSessionFacts {
  const value = options.response.payload
  if (
    !isRecord(value) ||
    value.object !== "checkout.session" ||
    value.livemode !== true ||
    value.mode !== "subscription" ||
    (value.status !== "open" && value.status !== "expired") ||
    !options.expectedStatuses.includes(value.status) ||
    value.payment_status !== "unpaid" ||
    value.subscription !== null ||
    typeof value.id !== "string" ||
    value.id.length > 255 ||
    !STRIPE_SESSION_ID_PATTERN.test(value.id) ||
    (options.expectedId !== undefined && value.id !== options.expectedId) ||
    typeof value.created !== "number" ||
    !Number.isSafeInteger(value.created) ||
    value.created < 1 ||
    !Number.isSafeInteger(value.created * 1000)
  ) {
    invalidResponse(
      options.provider,
      new Response(null, { status: options.response.status }),
      value === null || !isRecord(value) || value.livemode !== false,
    )
  }
  const providerCreatedAt = new Date(value.created * 1000).toISOString()
  if (
    options.expectedProviderCreatedAt !== undefined &&
    providerCreatedAt !== options.expectedProviderCreatedAt
  ) {
    invalidResponse(
      options.provider,
      new Response(null, { status: options.response.status }),
    )
  }
  return { id: value.id, providerCreatedAt, status: value.status }
}

function verifiedAt(
  provider: PublicationPaymentCanaryConfig["provider"],
  now: () => Date,
): string {
  let value: Date
  try {
    value = now()
  } catch {
    invalidInput(provider)
  }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    invalidInput(provider)
  }
  return value.toISOString()
}

export async function runStripePublicationPaymentCanary(
  config: StripePublicationPaymentCanaryConfig,
  input: PublicationPaymentCanaryInput,
  dependencies: PublicationPaymentCanaryDependencies = {},
): Promise<StripePublicationPaymentCanaryEvidence> {
  const checkoutBaseUrl = exactAdvocateCheckoutBaseUrl(config.provider, input)
  const returnUrls = stripeCheckoutReturnUrls(checkoutBaseUrl)
  const createIdempotencyKey = stripeIdempotencyKey(
    config.provider,
    input.canaryAttemptId,
    "create",
  )
  const cleanupIdempotencyKey = stripeIdempotencyKey(
    config.provider,
    input.canaryAttemptId,
    "expire",
  )
  const fetchImplementation = dependencies.fetchImplementation ?? fetch

  const body = new URLSearchParams()
  body.set("mode", "subscription")
  body.set("line_items[0][price]", config.recurringPriceId)
  body.set("line_items[0][quantity]", "1")
  body.set("success_url", returnUrls.successUrl)
  body.set("cancel_url", returnUrls.cancelUrl)

  const created = await fetchCanaryJson({
    provider: config.provider,
    fetchImplementation,
    url: STRIPE_CHECKOUT_SESSION_URL,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": createIdempotencyKey,
        "Stripe-Version": STRIPE_API_VERSION,
      },
      body: body.toString(),
    },
    timeoutMs: config.requestTimeoutMs,
    expectedStatuses: [200],
  })
  const session = parseStripeSession({
    provider: config.provider,
    response: created,
    expectedStatuses: ["open", "expired"],
  })

  let cleanup: CanaryJsonResponse | null = null
  if (session.status === "open") {
    cleanup = await fetchCanaryJson({
      provider: config.provider,
      fetchImplementation,
      url: `${STRIPE_CHECKOUT_SESSION_URL}/${encodeURIComponent(session.id)}/expire`,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${config.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": cleanupIdempotencyKey,
          "Stripe-Version": STRIPE_API_VERSION,
        },
      },
      timeoutMs: config.requestTimeoutMs,
      expectedStatuses: [200],
    })
    parseStripeSession({
      provider: config.provider,
      response: cleanup,
      expectedStatuses: ["expired"],
      expectedId: session.id,
      expectedProviderCreatedAt: session.providerCreatedAt,
    })
  }

  return {
    schema_version: 1,
    provider: config.provider,
    provider_resource_id: session.id,
    provider_status: "checkout_session_expired_unpaid",
    create_provider_status: session.status,
    provider_created_at: session.providerCreatedAt,
    provider_return_urls_sha256: returnUrlsSha256(returnUrls),
    outbound_request_id_sha256: sha256(createIdempotencyKey),
    cleanup_request_id_sha256: sha256(cleanupIdempotencyKey),
    create_http_status: 200,
    cleanup_http_status: cleanup === null ? null : 200,
    cleanup_performed: cleanup !== null,
    financial_charge_attempted: false,
    provider_capture_attempted: false,
    sponsorship_state_created: false,
    webhook_delivery_verified: false,
    verified: true,
    verified_at: verifiedAt(
      config.provider,
      dependencies.now ?? (() => new Date()),
    ),
    ...(created.providerRequestId
      ? { provider_create_request_id: created.providerRequestId }
      : {}),
    ...(cleanup?.providerRequestId
      ? { provider_cleanup_request_id: cleanup.providerRequestId }
      : {}),
  }
}

function parsePayPalAccessToken(response: CanaryJsonResponse): string {
  const value = response.payload
  if (
    !isRecord(value) ||
    typeof value.access_token !== "string" ||
    value.access_token.length < 1 ||
    value.access_token.length > 4096 ||
    typeof value.token_type !== "string" ||
    value.token_type.toLowerCase() !== "bearer" ||
    typeof value.expires_in !== "number" ||
    !Number.isSafeInteger(value.expires_in) ||
    value.expires_in < 1
  ) {
    invalidResponse("paypal", new Response(null, { status: response.status }))
  }
  return value.access_token
}

function assertPayPalApproveLink(
  value: Record<string, unknown>,
  responseStatus: number,
): void {
  if (!Array.isArray(value.links)) {
    invalidResponse("paypal", new Response(null, { status: responseStatus }))
  }
  const approveLinks = value.links.filter(
    (link) =>
      isRecord(link) &&
      link.rel === "approve" &&
      (link.method === undefined || link.method === "GET"),
  )
  if (approveLinks.length !== 1 || typeof approveLinks[0].href !== "string") {
    invalidResponse("paypal", new Response(null, { status: responseStatus }))
  }

  let approveUrl: URL
  try {
    approveUrl = new URL(approveLinks[0].href)
  } catch {
    invalidResponse("paypal", new Response(null, { status: responseStatus }))
  }
  if (
    approveLinks[0].href.length > 4096 ||
    approveUrl.protocol !== "https:" ||
    approveUrl.hostname !== "www.paypal.com" ||
    approveUrl.username !== "" ||
    approveUrl.password !== "" ||
    approveUrl.pathname !== "/webapps/billing/subscriptions" ||
    !PAYPAL_BILLING_APPROVAL_TOKEN_PATTERN.test(
      approveUrl.searchParams.get("ba_token") ?? "",
    )
  ) {
    invalidResponse("paypal", new Response(null, { status: responseStatus }))
  }
}

function parsePayPalCreatedSubscription(
  response: CanaryJsonResponse,
  expectedPlanId: string,
  expectedCustomId: string,
): PayPalSubscriptionFacts {
  const value = response.payload
  if (
    !isRecord(value) ||
    value.status !== "APPROVAL_PENDING" ||
    value.plan_id !== expectedPlanId ||
    value.custom_id !== expectedCustomId ||
    value.plan_overridden !== false ||
    value.subscriber !== undefined ||
    value.billing_info !== undefined ||
    typeof value.id !== "string" ||
    !PAYPAL_SUBSCRIPTION_ID_PATTERN.test(value.id) ||
    typeof value.create_time !== "string" ||
    value.create_time.length > 64 ||
    !Number.isFinite(Date.parse(value.create_time))
  ) {
    invalidResponse("paypal", new Response(null, { status: response.status }))
  }

  assertPayPalApproveLink(value, response.status)
  return {
    id: value.id,
    providerCreatedAt: new Date(value.create_time).toISOString(),
  }
}

export async function runPayPalPublicationPaymentCanary(
  config: PayPalPublicationPaymentCanaryConfig,
  input: PublicationPaymentCanaryInput,
  dependencies: PublicationPaymentCanaryDependencies = {},
): Promise<PayPalPublicationPaymentCanaryEvidence> {
  const checkoutBaseUrl = exactAdvocateCheckoutBaseUrl(config.provider, input)
  const returnUrls = paypalCheckoutReturnUrls(checkoutBaseUrl)
  const fetchImplementation = dependencies.fetchImplementation ?? fetch
  const credentials = Buffer.from(
    `${config.clientId}:${config.clientSecret}`,
    "utf8",
  ).toString("base64")

  const credential = await fetchCanaryJson({
    provider: "paypal",
    fetchImplementation,
    url: PAYPAL_TOKEN_URL,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    },
    timeoutMs: config.requestTimeoutMs,
    expectedStatuses: [200],
  })
  const accessToken = parsePayPalAccessToken(credential)
  const requestId = input.canaryAttemptId

  const subscription = await fetchCanaryJson({
    provider: "paypal",
    fetchImplementation,
    url: PAYPAL_SUBSCRIPTION_URL,
    init: {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": requestId,
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        plan_id: config.recurringPlanId,
        custom_id: input.canaryAttemptId,
        application_context: {
          brand_name: "Creator Share",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          return_url: returnUrls.successUrl,
          cancel_url: returnUrls.cancelUrl,
        },
      }),
    },
    timeoutMs: config.requestTimeoutMs,
    expectedStatuses: [200, 201],
  })
  const subscriptionFacts = parsePayPalCreatedSubscription(
    subscription,
    config.recurringPlanId,
    input.canaryAttemptId,
  )

  return {
    schema_version: 1,
    provider: "paypal",
    provider_resource_id: subscriptionFacts.id,
    provider_status: "subscription_approval_pending",
    provider_created_at: subscriptionFacts.providerCreatedAt,
    provider_return_urls_sha256: returnUrlsSha256(returnUrls),
    outbound_request_id_sha256: sha256(requestId),
    create_http_status: subscription.status === 200 ? 200 : 201,
    financial_charge_attempted: false,
    provider_capture_attempted: false,
    sponsorship_state_created: false,
    webhook_delivery_verified: false,
    verified: true,
    verified_at: verifiedAt("paypal", dependencies.now ?? (() => new Date())),
    ...(credential.providerRequestId
      ? { provider_credential_request_id: credential.providerRequestId }
      : {}),
    ...(subscription.providerRequestId
      ? { provider_create_request_id: subscription.providerRequestId }
      : {}),
  }
}

export async function runPublicationPaymentCanary(
  config: PublicationPaymentCanaryConfig,
  input: PublicationPaymentCanaryInput,
  dependencies: PublicationPaymentCanaryDependencies = {},
): Promise<PublicationPaymentCanaryEvidence> {
  return config.provider === "paypal"
    ? runPayPalPublicationPaymentCanary(config, input, dependencies)
    : runStripePublicationPaymentCanary(config, input, dependencies)
}
