import "server-only"

import { isIP } from "node:net"
import { randomUUID } from "node:crypto"

import type { AdvocateInvitationAuditContext } from "@/lib/advocates/invitations/administration"

type RequestContextEnvironment = Readonly<Record<string, string | undefined>>

function boundedHeader(
  request: Request,
  name: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(name)?.trim()
  return value &&
    Buffer.byteLength(value, "utf8") <= maximumLength &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    ? value
    : null
}

function trustedVercelTrace(
  request: Request,
  environment: RequestContextEnvironment,
): string | null {
  return environment.VERCEL === "1"
    ? boundedHeader(request, "x-vercel-id", 255)
    : null
}

function trustedVercelClientIp(
  request: Request,
  environment: RequestContextEnvironment,
): string | null {
  if (environment.VERCEL !== "1") return null
  const value = boundedHeader(request, "x-vercel-forwarded-for", 256)
  if (value === null || value.includes(",") || isIP(value) === 0) return null
  return value.toLowerCase()
}

export function advocateInvitationRequestContext(
  request: Request,
  environment: RequestContextEnvironment = process.env,
): AdvocateInvitationAuditContext {
  return Object.freeze({
    requestId: randomUUID(),
    traceId: trustedVercelTrace(request, environment),
    sessionId: null,
    clientIp: trustedVercelClientIp(request, environment),
    userAgent: boundedHeader(request, "user-agent", 1024),
  })
}
