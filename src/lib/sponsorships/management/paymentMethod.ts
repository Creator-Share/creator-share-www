import "server-only"

import {
  getSponsorClaimCanonicalOrigin,
  SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH,
} from "@/lib/sponsorships/accountClaim"
import { PAYPAL_MANAGE_URL } from "@/lib/payments/portals"
import { getStripeClient } from "@/lib/stripe/config"
import type { StripeRegion } from "@/lib/stripe/region"

export const MAXIMUM_PAYMENT_METHOD_MANAGEMENT_BODY_BYTES = 128
export const PAYMENT_METHOD_PROVIDER_TIMEOUT_MILLISECONDS = 15_000
export const STRIPE_PAYMENT_METHOD_MANAGEMENT_LABEL =
  "Update default payment method in Stripe."
export const PAYPAL_PAYMENT_METHOD_MANAGEMENT_LABEL =
  "Manage automatic payments in PayPal."

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const STRIPE_SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{8,251}$/
const STRIPE_CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{8,251}$/
const STRIPE_PORTAL_CONFIGURATION_ID_PATTERN = /^bpc_[A-Za-z0-9]{8,251}$/
const PAYPAL_SUBSCRIPTION_ID_PATTERN = /^I-[A-Z0-9-]{8,62}$/
const STRIPE_BILLING_PORTAL_ORIGIN = "https://billing.stripe.com"
const SPONSOR_PAYMENT_MANAGEMENT_PRODUCTION_RETURN_URL =
  "https://creatorshare.com/app"
const SUPPORTED_STRIPE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "past_due",
  "trialing",
])

const AUTHORIZATION_ROW_KEYS = ["authorized"] as const
const RESOLUTION_ROW_KEYS = [
  "payment_provider",
  "provider_account_scope",
  "provider_customer_id",
  "provider_subscription_id",
] as const

export type PaymentMethodManagementErrorCode =
  | "invalid-request"
  | "unauthorized"
  | "forbidden"
  | "recent-verification-required"
  | "unavailable"

export class PaymentMethodManagementError extends Error {
  readonly code: PaymentMethodManagementErrorCode
  readonly httpStatus: number

  constructor(code: PaymentMethodManagementErrorCode, httpStatus: number) {
    super(code)
    this.name = "PaymentMethodManagementError"
    this.code = code
    this.httpStatus = httpStatus
  }
}

export interface PaymentMethodManagementRequest {
  subscriptionId: string
}

export interface SafePaymentMethodManagementDestination {
  url: string
  label: string
}

interface DatabaseError {
  code?: unknown
  message?: unknown
}

interface RpcResult {
  data: unknown
  error: DatabaseError | null
}

export interface PaymentMethodManagementRpcClient {
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<RpcResult>
}

interface StripeSubscriptionProjection {
  id: string
  customer: string | { id: string } | null
  status: string
  collectionMethod: string
  hasDefaultPaymentMethodOverride: boolean
  hasDefaultSourceOverride: boolean
}

interface StripePortalSessionProjection {
  url: string | null
}

export interface StripePaymentMethodOperations {
  retrieveSubscription(
    providerSubscriptionId: string,
  ): Promise<StripeSubscriptionProjection>
  createPaymentMethodPortalSession(input: {
    customerId: string
    configurationId: string
    returnUrl: string
  }): Promise<StripePortalSessionProjection>
}

export interface PaymentMethodManagementDependencies {
  authenticatedClient: PaymentMethodManagementRpcClient
  serviceClient: PaymentMethodManagementRpcClient
  stripeForRegion(region: StripeRegion): StripePaymentMethodOperations
  portalConfigurationId(region: StripeRegion): string
  returnUrl: string
}

interface ResolvedPaymentMethodManagement {
  provider: "STRIPE" | "PAYPAL"
  providerAccountScope: "stripe_us" | "stripe_uk" | "paypal"
  providerCustomerId: string | null
  providerSubscriptionId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  return (
    Object.keys(value).sort().join("\0") === [...expectedKeys].sort().join("\0")
  )
}

function oneExactRow(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    !hasExactKeys(value[0], expectedKeys)
  ) {
    throw new PaymentMethodManagementError("unavailable", 503)
  }
  return value[0]
}

function requiredBoundedString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = row[key]
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    throw new PaymentMethodManagementError("unavailable", 503)
  }
  return value
}

function optionalBoundedString(
  row: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string | null {
  if (row[key] === null) return null
  return requiredBoundedString(row, key, maximumLength)
}

function databaseFailure(error: DatabaseError | null): never {
  const code = typeof error?.code === "string" ? error.code : null
  const message = typeof error?.message === "string" ? error.message : ""

  if (code === "42501" && message.startsWith("recent-verification-required")) {
    throw new PaymentMethodManagementError("recent-verification-required", 428)
  }
  if (code === "28000") {
    throw new PaymentMethodManagementError("unauthorized", 401)
  }
  if (code === "42501") {
    throw new PaymentMethodManagementError("forbidden", 403)
  }
  if (code === "22023" || code === "22P02") {
    throw new PaymentMethodManagementError("invalid-request", 400)
  }
  throw new PaymentMethodManagementError("unavailable", 503)
}

export function parsePaymentMethodManagementBody(
  serializedBody: string,
): PaymentMethodManagementRequest | null {
  if (
    typeof serializedBody !== "string" ||
    Buffer.byteLength(serializedBody, "utf8") >
      MAXIMUM_PAYMENT_METHOD_MANAGEMENT_BODY_BYTES
  ) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serializedBody)
  } catch {
    return null
  }

  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ["subscriptionId"]) ||
    typeof parsed.subscriptionId !== "string"
  ) {
    return null
  }

  const subscriptionId = parsed.subscriptionId.toLowerCase()
  return UUID_PATTERN.test(subscriptionId) ? { subscriptionId } : null
}

function parseAuthorization(value: unknown): void {
  const row = oneExactRow(value, AUTHORIZATION_ROW_KEYS)
  if (row.authorized !== true) {
    throw new PaymentMethodManagementError("forbidden", 403)
  }
}

function parseResolution(value: unknown): ResolvedPaymentMethodManagement {
  const row = oneExactRow(value, RESOLUTION_ROW_KEYS)
  const provider = requiredBoundedString(row, "payment_provider", 16)
  const providerAccountScope = requiredBoundedString(
    row,
    "provider_account_scope",
    16,
  )
  const providerCustomerId = optionalBoundedString(
    row,
    "provider_customer_id",
    255,
  )
  const providerSubscriptionId = requiredBoundedString(
    row,
    "provider_subscription_id",
    255,
  )

  if (provider === "STRIPE") {
    if (
      (providerAccountScope !== "stripe_us" &&
        providerAccountScope !== "stripe_uk") ||
      !STRIPE_SUBSCRIPTION_ID_PATTERN.test(providerSubscriptionId) ||
      providerCustomerId === null ||
      !STRIPE_CUSTOMER_ID_PATTERN.test(providerCustomerId)
    ) {
      throw new PaymentMethodManagementError("unavailable", 503)
    }
    return {
      provider,
      providerAccountScope,
      providerCustomerId,
      providerSubscriptionId,
    }
  }

  if (
    provider === "PAYPAL" &&
    providerAccountScope === "paypal" &&
    PAYPAL_SUBSCRIPTION_ID_PATTERN.test(providerSubscriptionId)
  ) {
    return {
      provider,
      providerAccountScope,
      providerCustomerId,
      providerSubscriptionId,
    }
  }

  throw new PaymentMethodManagementError("unavailable", 503)
}

function stripeRegionForScope(
  scope: ResolvedPaymentMethodManagement["providerAccountScope"],
): StripeRegion {
  if (scope === "stripe_us") return "us"
  if (scope === "stripe_uk") return "uk"
  throw new PaymentMethodManagementError("unavailable", 503)
}

export function requireStripeBillingPortalUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4096 ||
    value !== value.trim() ||
    /[\r\n\0]/.test(value)
  ) {
    throw new PaymentMethodManagementError("unavailable", 503)
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PaymentMethodManagementError("unavailable", 503)
  }

  if (
    url.origin !== STRIPE_BILLING_PORTAL_ORIGIN ||
    url.protocol !== "https:" ||
    url.hostname !== "billing.stripe.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new PaymentMethodManagementError("unavailable", 503)
  }
  return value
}

export function getStripeBillingPortalConfigurationId(
  region: StripeRegion,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value =
    region === "us"
      ? environment.STRIPE_BILLING_PORTAL_CONFIGURATION_ID_US
      : environment.STRIPE_BILLING_PORTAL_CONFIGURATION_ID_UK
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !STRIPE_PORTAL_CONFIGURATION_ID_PATTERN.test(value)
  ) {
    throw new PaymentMethodManagementError("unavailable", 503)
  }
  return value
}

export function getSponsorPaymentManagementReturnUrl(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (environment.NODE_ENV === "production") {
    return SPONSOR_PAYMENT_MANAGEMENT_PRODUCTION_RETURN_URL
  }

  let origin: string
  try {
    origin = getSponsorClaimCanonicalOrigin(environment)
  } catch {
    throw new PaymentMethodManagementError("unavailable", 503)
  }
  return new URL(SPONSOR_ACCOUNT_MANAGEMENT_PAGE_PATH, origin).toString()
}

function createStripePaymentMethodOperations(
  region: StripeRegion,
): StripePaymentMethodOperations {
  const stripe = getStripeClient(region)
  return {
    async retrieveSubscription(providerSubscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(
        providerSubscriptionId,
        {
          maxNetworkRetries: 0,
          timeout: PAYMENT_METHOD_PROVIDER_TIMEOUT_MILLISECONDS,
        },
      )
      return {
        id: subscription.id,
        customer:
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer &&
                !("deleted" in subscription.customer) &&
                typeof subscription.customer.id === "string"
              ? subscription.customer.id
              : null,
        status: subscription.status,
        collectionMethod: subscription.collection_method,
        hasDefaultPaymentMethodOverride:
          subscription.default_payment_method !== null,
        hasDefaultSourceOverride: subscription.default_source !== null,
      }
    },
    async createPaymentMethodPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create(
        {
          customer: input.customerId,
          configuration: input.configurationId,
          return_url: input.returnUrl,
          flow_data: {
            type: "payment_method_update",
            after_completion: {
              type: "redirect",
              redirect: { return_url: input.returnUrl },
            },
          },
        },
        {
          maxNetworkRetries: 0,
          timeout: PAYMENT_METHOD_PROVIDER_TIMEOUT_MILLISECONDS,
        },
      )
      return { url: session.url }
    },
  }
}

export async function createSponsorPaymentMethodDestination(
  accountId: string,
  subscriptionId: string,
  dependencies: PaymentMethodManagementDependencies,
): Promise<SafePaymentMethodManagementDestination> {
  if (!UUID_PATTERN.test(accountId) || !UUID_PATTERN.test(subscriptionId)) {
    throw new PaymentMethodManagementError("invalid-request", 400)
  }

  const authorization = await dependencies.authenticatedClient.rpc(
    "authorize_sponsor_subscription_payment_management",
    { target_subscription_id: subscriptionId },
  )
  if (authorization.error) databaseFailure(authorization.error)
  parseAuthorization(authorization.data)

  const resolution = await dependencies.serviceClient.rpc(
    "resolve_owned_subscription_payment_management",
    {
      target_account_id: accountId,
      target_subscription_id: subscriptionId,
    },
  )
  if (resolution.error) databaseFailure(resolution.error)
  const resolved = parseResolution(resolution.data)

  if (resolved.provider === "PAYPAL") {
    return {
      url: PAYPAL_MANAGE_URL,
      label: PAYPAL_PAYMENT_METHOD_MANAGEMENT_LABEL,
    }
  }

  const region = stripeRegionForScope(resolved.providerAccountScope)
  const stripe = dependencies.stripeForRegion(region)
  let liveSubscription: StripeSubscriptionProjection
  try {
    liveSubscription = await stripe.retrieveSubscription(
      resolved.providerSubscriptionId,
    )
  } catch {
    throw new PaymentMethodManagementError("unavailable", 503)
  }

  const liveCustomerId =
    typeof liveSubscription.customer === "string"
      ? liveSubscription.customer
      : liveSubscription.customer?.id
  if (
    liveSubscription.id !== resolved.providerSubscriptionId ||
    liveCustomerId !== resolved.providerCustomerId ||
    liveSubscription.collectionMethod !== "charge_automatically" ||
    !SUPPORTED_STRIPE_SUBSCRIPTION_STATUSES.has(liveSubscription.status) ||
    liveSubscription.hasDefaultPaymentMethodOverride !== false ||
    liveSubscription.hasDefaultSourceOverride !== false
  ) {
    throw new PaymentMethodManagementError("unavailable", 503)
  }

  let configurationId: string
  let portalSession: StripePortalSessionProjection
  try {
    configurationId = dependencies.portalConfigurationId(region)
    portalSession = await stripe.createPaymentMethodPortalSession({
      customerId: resolved.providerCustomerId,
      configurationId,
      returnUrl: dependencies.returnUrl,
    })
  } catch (error) {
    if (error instanceof PaymentMethodManagementError) throw error
    throw new PaymentMethodManagementError("unavailable", 503)
  }

  return {
    url: requireStripeBillingPortalUrl(portalSession.url),
    label: STRIPE_PAYMENT_METHOD_MANAGEMENT_LABEL,
  }
}

export async function createSponsorPaymentMethodDestinationFromRuntime(options: {
  accountId: string
  subscriptionId: string
  authenticatedClient: PaymentMethodManagementRpcClient
  serviceClient: PaymentMethodManagementRpcClient
}): Promise<SafePaymentMethodManagementDestination> {
  return createSponsorPaymentMethodDestination(
    options.accountId,
    options.subscriptionId,
    {
      authenticatedClient: options.authenticatedClient,
      serviceClient: options.serviceClient,
      stripeForRegion: createStripePaymentMethodOperations,
      portalConfigurationId: (region) =>
        getStripeBillingPortalConfigurationId(region),
      returnUrl: getSponsorPaymentManagementReturnUrl(),
    },
  )
}
