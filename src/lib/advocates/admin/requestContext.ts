import "server-only"

import { randomUUID } from "node:crypto"
import { isIP } from "node:net"

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/

export interface AdvocatePortalMutationRequestContext {
  requestId: string
  traceId: string
  sessionId: null
  clientIp: string | null
  userAgent: string | null
}

function boundedHeader(
  request: Request,
  name: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(name)?.trim()
  return value && !CONTROL_CHARACTER_PATTERN.test(value)
    ? value.slice(0, maximumLength)
    : null
}

function trustedVercelClientIp(request: Request): string | null {
  // The final Vercel ingress overwrites this header. Cloudflare is DNS only for
  // the MVP, so accepting its origin header here would create a spoofable audit
  // field unless the application also authenticated a Cloudflare proxy hop.
  const value = boundedHeader(request, "x-vercel-forwarded-for", 256)
  return value !== null && isIP(value) !== 0 ? value : null
}

export function advocatePortalMutationRequestContext(
  request: Request,
): AdvocatePortalMutationRequestContext {
  return Object.freeze({
    requestId: randomUUID(),
    traceId: boundedHeader(request, "x-vercel-id", 255) ?? randomUUID(),
    sessionId: null,
    clientIp: trustedVercelClientIp(request),
    userAgent: boundedHeader(request, "user-agent", 1_024),
  })
}
