import "server-only"

import { readRequestForensics } from "@/lib/requestForensics"

import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedPrimaryRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export interface CreatorShareAdvocateControlForensicContext {
  clientIp: string | null
  userAgent: string | null
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
  return readRequestForensics(request.headers).traceId ??
    `creator-share-advocate-control:${operationId}`
}

export function creatorShareAdvocateControlForensicContext(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CreatorShareAdvocateControlForensicContext {
  const { clientIp, userAgent } = readRequestForensics(request.headers, environment)
  return Object.freeze({ clientIp, userAgent })
}
