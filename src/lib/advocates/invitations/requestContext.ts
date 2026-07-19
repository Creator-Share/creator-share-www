import "server-only"

import { randomUUID } from "node:crypto"

import type { AdvocateInvitationAuditContext } from "@/lib/advocates/invitations/administration"

function boundedHeader(
  request: Request,
  name: string,
  maximumLength: number,
): string | null {
  const value = request.headers.get(name)?.trim()
  return value && !/[\u0000-\u001f\u007f]/.test(value)
    ? value.slice(0, maximumLength)
    : null
}

export function advocateInvitationRequestContext(
  request: Request,
): AdvocateInvitationAuditContext {
  return Object.freeze({
    requestId: randomUUID(),
    traceId:
      boundedHeader(request, "x-vercel-id", 255) ??
      boundedHeader(request, "cf-ray", 255) ??
      boundedHeader(request, "traceparent", 255) ??
      boundedHeader(request, "x-trace-id", 255),
    sessionId: null,
    clientIp:
      boundedHeader(request, "cf-connecting-ip", 256) ??
      boundedHeader(request, "x-vercel-forwarded-for", 256) ??
      boundedHeader(request, "x-forwarded-for", 256) ??
      boundedHeader(request, "x-real-ip", 256),
    userAgent: boundedHeader(request, "user-agent", 1024),
  })
}
