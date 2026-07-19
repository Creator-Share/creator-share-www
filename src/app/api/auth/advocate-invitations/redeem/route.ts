import { NextResponse } from "next/server"

import {
  ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
  createAdvocateAttributionIdentityCookieValue,
  getAdvocateAttributionIdentityCookieOptions,
} from "@/lib/advocates/attributionIdentityCookie"
import {
  parseAdvocateInvitationRedeemBody,
  ADVOCATE_INVITATION_REDEEM_PATH,
} from "@/lib/advocates/invitations/material"
import {
  AdvocateInvitationRedemptionError,
  redeemAdvocateInvitation,
} from "@/lib/advocates/invitations/redemption"
import { advocateInvitationRequestContext } from "@/lib/advocates/invitations/requestContext"
import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAXIMUM_REDEEM_BODY_BYTES = 2_048

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
    },
  })
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d{1,10}$/.test(contentLength) ||
      Number(contentLength) > MAXIMUM_REDEEM_BODY_BYTES)
  ) {
    return null
  }
  if (request.body === null) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAXIMUM_REDEEM_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    )
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function classifyFailure(error: unknown): { status: number; code: string } {
  if (!(error instanceof AdvocateInvitationRedemptionError)) {
    return { status: 503, code: "redemption_unavailable" }
  }
  if (error.stage === "authentication") {
    return { status: 410, code: "invalid_or_expired" }
  }
  switch (error.postgresCode) {
    case "42501":
    case "28000":
      return { status: 410, code: "invalid_or_expired" }
    case "23505":
    case "55000":
      return { status: 409, code: "membership_conflict" }
    case "40001":
      return { status: 409, code: "redemption_conflict" }
    case "22023":
      return { status: 400, code: "invalid_request" }
    default:
      return { status: 503, code: "redemption_unavailable" }
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const context = advocateInvitationRequestContext(request)
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    request.url.includes("#") ||
    new URL(request.url).pathname !== ADVOCATE_INVITATION_REDEEM_PATH ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ ok: false, code: "invalid_request" }, 400)
  }

  const rawBody = await readBoundedBody(request)
  const material =
    rawBody === null ? null : parseAdvocateInvitationRedeemBody(rawBody)
  if (material === null) {
    return response({ ok: false, code: "invalid_request" }, 400)
  }

  try {
    const result = await redeemAdvocateInvitation({
      client: await createClient(),
      material,
      context,
    })
    const resultResponse = response({ ok: true, redirect: "/portal" }, 200)
    const identitySignal = createAdvocateAttributionIdentityCookieValue({
      authUserId: result.authUserId,
    })
    if (identitySignal) {
      resultResponse.cookies.set(
        ADVOCATE_ATTRIBUTION_IDENTITY_COOKIE_NAME,
        identitySignal,
        getAdvocateAttributionIdentityCookieOptions(
          request.headers.get("host"),
          new URL(request.url).protocol === "https:",
        ),
      )
    }
    return resultResponse
  } catch (error) {
    const failure = classifyFailure(error)
    if (failure.status === 503) {
      console.error("ADVOCATE_INVITATION_REDEMPTION_FAILED", {
        requestId: context.requestId,
        code: failure.code,
      })
    }
    return response({ ok: false, code: failure.code }, failure.status)
  }
}
