import "server-only"

import { NextResponse } from "next/server"

import { ADVOCATE_INVITATION_MAXIMUM_REQUEST_BODY_LENGTH } from "@/lib/advocates/invitations/material"
import {
  type CheckoutRequestEnvironment,
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"

export const ADVOCATE_INVITATION_JSON_RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
} as const)

export function advocateInvitationJsonResponse(
  body: Record<string, unknown>,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: ADVOCATE_INVITATION_JSON_RESPONSE_HEADERS,
  })
}

export function resolveTrustedAdvocateInvitationOrigin(options: {
  rawHost: string | null
  environment?: CheckoutRequestEnvironment
}): string | null {
  const environment = options.environment ?? process.env
  const origin = resolveTrustedPrimaryRequestOrigin({
    rawHost: options.rawHost,
    environment,
  })
  if (origin === "https://creatorshare.com") return origin
  if (origin === null || environment.NODE_ENV === "production") return null

  const parsed = new URL(origin)
  return parsed.protocol === "http:" &&
    (parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]")
    ? origin
    : null
}

export function isTrustedAdvocateInvitationJsonRequest(
  request: Request,
  expectedPath: string,
): boolean {
  const expectedOrigin = resolveTrustedAdvocateInvitationOrigin({
    rawHost: request.headers.get("host"),
  })
  let requestUrl: URL
  try {
    requestUrl = new URL(request.url)
  } catch {
    return false
  }
  return (
    expectedOrigin !== null &&
    !request.url.includes("#") &&
    requestUrl.pathname === expectedPath &&
    requestUrl.search === "" &&
    isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  )
}

export async function readBoundedAdvocateInvitationBody(
  request: Request,
): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d{1,10}$/.test(contentLength) ||
      Number(contentLength) > ADVOCATE_INVITATION_MAXIMUM_REQUEST_BODY_LENGTH)
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
      if (totalBytes > ADVOCATE_INVITATION_MAXIMUM_REQUEST_BODY_LENGTH) {
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
