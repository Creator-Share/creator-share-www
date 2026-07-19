import "server-only"

import { isIP } from "node:net"

import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export interface CreatorShareAdvocateControlForensicContext {
  clientIp: string | null
  userAgent: string | null
}

function boundedHeader(
  request: Request,
  name: string,
  maximumBytes: number,
): string | null {
  const value = request.headers.get(name)?.trim()
  if (!value || CONTROL_CHARACTER_PATTERN.test(value)) return null
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= maximumBytes) return value
  for (let end = maximumBytes; end > 0; end -= 1) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        encoded.slice(0, end),
      )
    } catch {
      // Continue to the previous complete UTF-8 code point.
    }
  }
  return null
}

export function isCreatorShareAdvocateControlPathId(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function isTrustedCreatorShareAdvocateControlRequest(
  request: Request,
): boolean {
  const expectedOrigin = resolveTrustedPrimaryRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  return (
    expectedOrigin !== null &&
    isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  )
}

export function creatorShareAdvocateControlTraceId(
  request: Request,
  operationId: string,
): string {
  const value = request.headers.get("x-vercel-id")?.trim()
  if (value && value.length <= 255 && !CONTROL_CHARACTER_PATTERN.test(value)) {
    return value
  }
  return `creator-share-advocate-control:${operationId}`
}

export function creatorShareAdvocateControlForensicContext(
  request: Request,
): CreatorShareAdvocateControlForensicContext {
  const vercelForwardedFor = boundedHeader(
    request,
    "x-vercel-forwarded-for",
    256,
  )
  return Object.freeze({
    clientIp:
      vercelForwardedFor !== null && isIP(vercelForwardedFor) !== 0
        ? vercelForwardedFor
        : null,
    userAgent: boundedHeader(request, "user-agent", 1_024),
  })
}
