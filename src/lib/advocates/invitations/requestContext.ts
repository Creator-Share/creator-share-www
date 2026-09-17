import "server-only"

import { readRequestForensics } from "@/lib/requestForensics"
import { randomUUID } from "node:crypto"

import type { AdvocateInvitationAuditContext } from "@/lib/advocates/invitations/administration"

type RequestContextEnvironment = Readonly<Record<string, string | undefined>>

export function advocateInvitationRequestContext(
  request: Request,
  environment: RequestContextEnvironment = process.env,
): AdvocateInvitationAuditContext {
  return Object.freeze({
    requestId: randomUUID(),
    ...readRequestForensics(request.headers, environment),
    sessionId: null,
  })
}
