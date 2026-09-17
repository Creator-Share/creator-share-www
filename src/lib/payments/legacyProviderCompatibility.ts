import "server-only"

import { normalizeSponsorEmailV1 } from "@/lib/sponsorships/crypto"

const STRIPE_SESSION_ID_PATTERN = /^cs_(?:test|live)_[A-Za-z0-9]{16,255}$/
const PAYPAL_SUBSCRIPTION_ID_PATTERN = /^I-[A-Z0-9-]{8,62}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/
const CURRENCY_PATTERN = /^[A-Z]{3}$/

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
} as const

export interface LegacyProviderLookupUser {
  id: string
  email: string | null | undefined
  emailConfirmedAt: string | null | undefined
}

export interface LegacyStripeLookupDependencies {
  getAuthenticatedUser(): Promise<LegacyProviderLookupUser | null>
  retrieveSession(sessionId: string, region: string | null): Promise<unknown>
}

export interface LegacyPayPalLookupDependencies {
  getAuthenticatedUser(): Promise<LegacyProviderLookupUser | null>
  loadOwnedSubscription(options: {
    subscriptionId: string
  }): Promise<unknown | null>
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function json(body: JsonRecord, status = 200): Response {
  return Response.json(body, { status, headers: RESPONSE_HEADERS })
}

function oneQueryValue(
  params: URLSearchParams,
  key: string,
): string | null | undefined {
  const values = params.getAll(key)
  if (values.length === 0) return undefined
  return values.length === 1 ? values[0] : null
}

function boundedText(
  value: unknown,
  maximumLength: number,
  fallback: string,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value !== value.trim() ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return fallback
  }
  return value
}

function optionalNonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function optionalCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null
  const currency = value.toUpperCase()
  return CURRENCY_PATTERN.test(currency) ? currency : null
}

function confirmedUser(
  user: LegacyProviderLookupUser | null,
): user is LegacyProviderLookupUser & { email: string } {
  return Boolean(user?.id && user.email && user.emailConfirmedAt)
}

function normalizedEmailsMatch(left: string, right: string): boolean {
  try {
    return normalizeSponsorEmailV1(left) === normalizeSponsorEmailV1(right)
  } catch {
    return false
  }
}

function stripeSessionEmail(session: JsonRecord): string | null {
  const customerDetails = session.customer_details
  if (isRecord(customerDetails) && typeof customerDetails.email === "string") {
    return customerDetails.email
  }

  const customer = session.customer
  return isRecord(customer) && typeof customer.email === "string"
    ? customer.email
    : null
}

function safeStripeStatus(
  value: unknown,
): "open" | "complete" | "expired" | "processing" {
  return value === "open" || value === "complete" || value === "expired"
    ? value
    : "processing"
}

function safeStripePaymentStatus(
  value: unknown,
): "paid" | "unpaid" | "no_payment_required" | "processing" {
  return value === "paid" ||
    value === "unpaid" ||
    value === "no_payment_required"
    ? value
    : "processing"
}

function safeStripeChildMetadata(value: unknown) {
  const metadata = isRecord(value) ? value : {}
  return {
    childName: boundedText(
      metadata.childName,
      160,
      "your sponsored beneficiary",
    ),
    childLocation: boundedText(metadata.childLocation, 300, ""),
  }
}

export function genericLegacyStripeSessionResponse() {
  return {
    session: {
      status: "processing" as const,
      metadata: {
        childName: "your sponsored beneficiary",
        childLocation: "",
      },
    },
    status: "processing" as const,
    personalized: false,
  }
}

export function genericLegacyStripeSuccessResponse() {
  return {
    payment_status: "processing" as const,
    status: "processing" as const,
    personalized: false,
  }
}

export function genericLegacyPayPalVerifyResponse() {
  return {
    subscription: {
      status: "processing" as const,
      beneficiaries: null,
    },
    paypal_order: null,
    personalized: false,
  }
}

export function genericLegacyPayPalSessionResponse() {
  return {
    session: {
      status: "processing" as const,
      metadata: {
        type: "sponsorship",
        childName: "your sponsored child",
        childLocation: "",
        amount: "",
        paymentType: "unknown",
      },
    },
    status: "processing" as const,
    personalized: false,
  }
}

function personalizedStripeSessionResponse(session: JsonRecord) {
  const status = safeStripeStatus(session.status)
  return {
    session: {
      status,
      metadata: safeStripeChildMetadata(session.metadata),
    },
    status,
    personalized: true,
  }
}

function personalizedStripeSuccessResponse(session: JsonRecord) {
  return {
    amount_total: optionalNonnegativeInteger(session.amount_total),
    currency: optionalCurrency(session.currency),
    payment_status: safeStripePaymentStatus(session.payment_status),
    status: safeStripeStatus(session.status),
    metadata: safeStripeChildMetadata(session.metadata),
    personalized: true,
  }
}

function safeBeneficiary(value: unknown): {
  name: string
  location_str: string
} | null {
  const candidate = Array.isArray(value) ? value[0] : value
  if (!isRecord(candidate)) return null
  return {
    name: boundedText(candidate.name, 160, "your sponsored beneficiary"),
    location_str: boundedText(candidate.location_str, 300, ""),
  }
}

function personalizedPayPalSubscriptionResponse(
  value: unknown,
): JsonRecord | null {
  if (!isRecord(value)) return null

  const status = boundedText(value.status, 40, "processing")
  const interval = boundedText(value.interval, 20, "month")
  return {
    subscription: {
      status,
      amount: optionalNonnegativeInteger(value.amount),
      interval,
      charged_amount: optionalNonnegativeInteger(value.charged_amount),
      charged_currency: optionalCurrency(value.charged_currency),
      beneficiaries: safeBeneficiary(value.beneficiaries),
    },
    paypal_order: null,
    personalized: true,
  }
}

async function authenticatedStripeSession(
  request: Request,
  queryKey: "id" | "session_id",
  dependencies: LegacyStripeLookupDependencies,
): Promise<JsonRecord | null> {
  let url: URL
  try {
    url = new URL(request.url)
  } catch {
    return null
  }

  const sessionId = oneQueryValue(url.searchParams, queryKey)
  if (
    sessionId === undefined ||
    sessionId === null ||
    !STRIPE_SESSION_ID_PATTERN.test(sessionId)
  ) {
    return null
  }

  let user: LegacyProviderLookupUser | null
  try {
    user = await dependencies.getAuthenticatedUser()
  } catch {
    return null
  }
  if (!confirmedUser(user)) return null

  let session: unknown
  try {
    session = await dependencies.retrieveSession(
      sessionId,
      oneQueryValue(url.searchParams, "region") ?? null,
    )
  } catch {
    return null
  }
  if (!isRecord(session)) return null

  const providerEmail = stripeSessionEmail(session)
  if (!providerEmail || !normalizedEmailsMatch(user.email, providerEmail)) {
    return null
  }
  return session
}

export function createLegacyStripeSessionHandler(
  dependencies: LegacyStripeLookupDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authenticatedStripeSession(
      request,
      "id",
      dependencies,
    )
    return json(
      session
        ? personalizedStripeSessionResponse(session)
        : genericLegacyStripeSessionResponse(),
    )
  }
}

export function createLegacyStripeSuccessHandler(
  dependencies: LegacyStripeLookupDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    const session = await authenticatedStripeSession(
      request,
      "session_id",
      dependencies,
    )
    return json(
      session
        ? personalizedStripeSuccessResponse(session)
        : genericLegacyStripeSuccessResponse(),
    )
  }
}

export function createLegacyPayPalVerifyHandler(
  dependencies: LegacyPayPalLookupDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return json(genericLegacyPayPalVerifyResponse())
    }

    const subscriptionId = oneQueryValue(url.searchParams, "sponsorship_id")
    if (
      subscriptionId === undefined ||
      subscriptionId === null ||
      !PAYPAL_SUBSCRIPTION_ID_PATTERN.test(subscriptionId)
    ) {
      return json(genericLegacyPayPalVerifyResponse())
    }

    let user: LegacyProviderLookupUser | null
    try {
      user = await dependencies.getAuthenticatedUser()
    } catch {
      return json(genericLegacyPayPalVerifyResponse())
    }
    if (!confirmedUser(user)) {
      return json(genericLegacyPayPalVerifyResponse())
    }

    let subscription: unknown | null
    try {
      subscription = await dependencies.loadOwnedSubscription({
        subscriptionId,
      })
    } catch {
      return json(genericLegacyPayPalVerifyResponse())
    }

    return json(
      personalizedPayPalSubscriptionResponse(subscription) ??
        genericLegacyPayPalVerifyResponse(),
    )
  }
}

export function createLegacyPayPalSessionHandler() {
  return async function GET(request: Request): Promise<Response> {
    void request
    return json(genericLegacyPayPalSessionResponse())
  }
}
