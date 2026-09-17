import "server-only"

import { randomUUID } from "node:crypto"
import { readRequestForensics } from "@/lib/requestForensics"

export interface AdvocatePortalMutationRequestContext {
  requestId: string
  traceId: string
  sessionId: null
  clientIp: string | null
  userAgent: string | null
}

export function advocatePortalMutationRequestContext(
  request: Request,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AdvocatePortalMutationRequestContext {
  const forensics = readRequestForensics(request.headers, environment)
  return Object.freeze({
    requestId: randomUUID(),
    ...forensics,
    traceId: forensics.traceId ?? randomUUID(),
    sessionId: null,
  })
}
