import { NextResponse } from "next/server"

import {
  getSponsorClaimCanonicalOrigin,
  SPONSOR_ACCOUNT_EMAIL_CONFIRMATION_PATH,
} from "@/lib/sponsorships/accountClaim"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import {
  normalizeAuthenticatedSponsorEmail,
  readBoundedSponsorManagementBody,
} from "@/lib/sponsorships/management/passwordlessAccess"
import {
  createSponsorPasswordlessDeliverySignals,
  reserveSponsorPasswordlessDelivery,
  sponsorPasswordlessDeliveryContext,
} from "@/lib/sponsorships/management/passwordlessRateLimit"
import { CREATOR_SHARE_ACCOUNT_ONBOARDING_PATH } from "@/lib/sponsorships/management/sponsorEmailConfirmation"
import { createStatelessSponsorEmailAuthClient } from "@/lib/sponsorships/management/statelessAuth"
import { validatePassword } from "@/utils/passwordValidation"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAXIMUM_REGISTRATION_BODY_BYTES = 8_192
const MAXIMUM_REGISTRATION_NAME_CHARACTERS = 100
const MAXIMUM_REGISTRATION_PASSWORD_CHARACTERS = 256
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

function response(body: Record<string, string>, status: number) {
  return NextResponse.json(body, { status, headers: RESPONSE_HEADERS })
}

function checkEmailResponse() {
  return response({ status: "check-email" }, 202)
}

function normalizeRegistrationName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized.length >= 1 &&
    normalized.length <= MAXIMUM_REGISTRATION_NAME_CHARACTERS &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(normalized)
    ? normalized
    : null
}

export async function POST(request: Request) {
  let canonicalOrigin: string
  try {
    canonicalOrigin = getSponsorClaimCanonicalOrigin()
  } catch {
    return response({ error: "unavailable" }, 503)
  }

  const requestOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    requestOrigin !== canonicalOrigin ||
    !isTrustedCheckoutJsonRequest(request.headers, canonicalOrigin)
  ) {
    return response({ error: "invalid-request" }, 400)
  }

  const serialized = await readBoundedSponsorManagementBody(
    request,
    MAXIMUM_REGISTRATION_BODY_BYTES,
  )
  let body: unknown
  try {
    body = serialized === null ? null : JSON.parse(serialized)
  } catch {
    body = null
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return response({ error: "invalid-request" }, 400)
  }

  const candidate = body as Record<string, unknown>
  const bodyKeys = Object.keys(candidate).sort()
  const email = normalizeAuthenticatedSponsorEmail(candidate.email)
  const firstName = normalizeRegistrationName(candidate.first_name)
  const lastName = normalizeRegistrationName(candidate.last_name)
  const password = candidate.password
  if (
    bodyKeys.length !== 4 ||
    bodyKeys[0] !== "email" ||
    bodyKeys[1] !== "first_name" ||
    bodyKeys[2] !== "last_name" ||
    bodyKeys[3] !== "password" ||
    email === null ||
    firstName === null ||
    lastName === null ||
    typeof password !== "string" ||
    password.length > MAXIMUM_REGISTRATION_PASSWORD_CHARACTERS ||
    !validatePassword(password).isValid
  ) {
    return response({ error: "invalid-request" }, 400)
  }

  try {
    const signals = createSponsorPasswordlessDeliverySignals({
      email,
      headers: request.headers,
    })
    const allowed = await reserveSponsorPasswordlessDelivery({
      flow: "registration",
      signals,
      context: sponsorPasswordlessDeliveryContext(request),
    })
    if (!allowed) return checkEmailResponse()

    const confirmationUrl = new URL(
      SPONSOR_ACCOUNT_EMAIL_CONFIRMATION_PATH,
      canonicalOrigin,
    )
    confirmationUrl.searchParams.set(
      "next",
      CREATOR_SHARE_ACCOUNT_ONBOARDING_PATH,
    )

    await createStatelessSponsorEmailAuthClient().auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName },
        emailRedirectTo: confirmationUrl.toString(),
      },
    })
  } catch {
    // Existing accounts, delivery denial, and provider failure stay uniform.
  }

  return checkEmailResponse()
}
